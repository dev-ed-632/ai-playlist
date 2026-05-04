/**
 * Browser-only audio decode + Essentia BPM/key + worker feature extraction.
 * Used by upload page and bulk CSV (File or ArrayBuffer from proxied URL).
 */

export type ExtractedAudioFeatures = {
  bpm: number;
  key: string;
  danceability: number;
  aggressiveness: number;
  mood_happy: number;
  mood_relaxed: number;
  mood_sad: number;
  engagement: number;
  approachability: number;
};

function monomix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels > 1) {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    return L.map((s, i) => 0.5 * (s + R[i]));
  }
  return buffer.getChannelData(0).slice();
}

function downsampleArray(audioIn: Float32Array, srIn: number, srOut: number): Float32Array {
  if (srIn === srOut) return audioIn;
  const ratio = srIn / srOut;
  const newLength = Math.round(audioIn.length / ratio);
  const result = new Float32Array(newLength);
  let offsetOut = 0,
    offsetIn = 0;
  while (offsetOut < newLength) {
    const nextIn = Math.round((offsetOut + 1) * ratio);
    let accum = 0,
      count = 0;
    for (let i = offsetIn; i < nextIn && i < audioIn.length; i++) {
      accum += audioIn[i];
      count++;
    }
    result[offsetOut++] = accum / count;
    offsetIn = nextIn;
  }
  return result;
}

function shortenAudio(audioIn: Float32Array, keepRatio: number, trim: boolean): Float32Array {
  if (keepRatio < 0.15) keepRatio = 0.15;
  else if (keepRatio > 0.66) keepRatio = 0.66;
  let slice = audioIn;
  if (trim) {
    const d = Math.floor(0.1 * audioIn.length);
    slice = audioIn.subarray(d, audioIn.length - d);
  }
  const patchSamples = 187 * 256;
  const ratioLen = Math.ceil(slice.length * keepRatio);
  const numPatches = Math.ceil(ratioLen / patchSamples);
  const skipSize = Math.floor((slice.length - ratioLen) / Math.max(numPatches - 1, 1));
  const out = new Float32Array(numPatches * patchSamples);
  let writePos = 0,
    start = 0;
  for (let i = 0; i < numPatches; i++) {
    out.set(slice.subarray(start, start + patchSamples), writePos);
    writePos += patchSamples;
    start += patchSamples + skipSize;
  }
  return out;
}

async function decodeToMono16kPatches(arrayBuffer: ArrayBuffer): Promise<{
  audioForNN: Float32Array;
  audioForBpmKey: Float32Array;
}> {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  await ctx.close();
  const mono = monomix(decoded);
  const at16k = downsampleArray(mono, decoded.sampleRate, 16000);
  const audioForNN = shortenAudio(at16k, 0.15, true);
  const half = 15 * 16000;
  const centre = Math.floor(at16k.length / 2);
  const audioForBpmKey = at16k.subarray(
    Math.max(0, centre - half),
    Math.min(at16k.length, centre + half)
  );
  return { audioForNN, audioForBpmKey };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

let _ess: any = null;
/** Single-flight Essentia init (bulk CSV runs several decodes in parallel). */
let _essLoadPromise: Promise<any> | null = null;

async function resolveEssentiaWasmModule(): Promise<any> {
  const w = window as unknown as { EssentiaWASM?: unknown };
  const raw = w.EssentiaWASM;
  if (raw == null) {
    throw new Error('EssentiaWASM missing after loading essentia-wasm.web.js');
  }
  let mod: any =
    typeof raw === 'function' ? await (raw as () => unknown)() : await Promise.resolve(raw);
  if (mod != null && typeof (mod as Promise<unknown>).then === 'function') {
    mod = await mod;
  }
  if (mod == null || typeof mod.EssentiaJS !== 'function') {
    throw new Error('Essentia WASM module did not expose EssentiaJS');
  }
  return mod;
}

async function getEssentia() {
  if (_ess) return _ess;
  if (!_essLoadPromise) {
    _essLoadPromise = (async () => {
      await loadScript('/essentia-wasm.web.js');
      await loadScript('/essentia.js-core.js');
      const wasm = await resolveEssentiaWasmModule();
      const ess = new wasm.EssentiaJS(false);
      ess.arrayToVector = wasm.arrayToVector;
      _ess = ess;
      return ess;
    })().catch((e) => {
      _essLoadPromise = null;
      _ess = null;
      throw e;
    });
  }
  return _essLoadPromise;
}

let featureWorker: Worker | null = null;
let inferenceWorker: Worker | null = null;
/** In-flight worker bootstrap; cleared on failure so callers can retry. */
let workersInitPromise: Promise<void> | null = null;

let onFeatDone: ((f: any) => void) | null = null;
let onFeatError: ((e: string) => void) | null = null;
let onPredDone: ((r: Record<string, number>) => void) | null = null;
let onPredError: ((e: string) => void) | null = null;

function terminateWorkers() {
  try {
    featureWorker?.terminate();
  } catch {
    /* ignore */
  }
  try {
    inferenceWorker?.terminate();
  } catch {
    /* ignore */
  }
  featureWorker = null;
  inferenceWorker = null;
}

const WORKER_INIT_TIMEOUT_MS = 240_000;

export function initAudioWorkers(): Promise<void> {
  if (workersInitPromise) return workersInitPromise;

  workersInitPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      workersInitPromise = null;
      terminateWorkers();
      reject(new Error(msg));
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve();
    };

    const timeoutId = setTimeout(() => {
      fail(
        `Worker init timed out after ${WORKER_INIT_TIMEOUT_MS / 1000}s. Check that /workers/, /models/, and WASM assets load (Network tab).`
      );
    }, WORKER_INIT_TIMEOUT_MS);

    try {
      featureWorker = new Worker('/workers/featureWorker.js');
      featureWorker.onmessage = ({ data }) => {
        if (data.features) onFeatDone?.(data.features);
        else if (data.error) onFeatError?.(data.error);
      };
      featureWorker.onerror = (e) => fail(`featureWorker: ${e.message}`);

      inferenceWorker = new Worker('/workers/inferenceWorker.js');
      inferenceWorker.onmessage = ({ data }) => {
        if (data.ready) {
          ok();
        } else if (data.predictions) {
          onPredDone?.(data.predictions);
        } else if (data.error) {
          if (!settled) {
            fail(String(data.error));
          } else {
            onPredError?.(data.error);
          }
        } else if (data.modelReady) {
          console.info(`model ready: ${data.modelReady}`);
        }
      };
      inferenceWorker.onerror = (e) => {
        fail(`inferenceWorker: ${e.message}`);
      };
      inferenceWorker.postMessage({ init: true });
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Failed to start workers');
    }
  });

  return workersInitPromise;
}

function computeFeatures(audio: Float32Array): Promise<any> {
  return new Promise((resolve, reject) => {
    onFeatDone = resolve;
    onFeatError = reject;
    const w = featureWorker;
    if (!w) {
      reject(new Error('Feature worker not ready'));
      return;
    }
    w.postMessage({ audio: audio.buffer }, [audio.buffer]);
  });
}

function runInference(features: any): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    onPredDone = resolve;
    onPredError = reject;
    inferenceWorker!.postMessage({ features });
  });
}

/** Full pipeline: decode PCM → Essentia BPM/key → ONNX mood features. */
export async function extractFeaturesFromArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<ExtractedAudioFeatures> {
  const { audioForNN, audioForBpmKey } = await decodeToMono16kPatches(arrayBuffer);

  const ess = await getEssentia();
  const vec = ess.arrayToVector(audioForBpmKey);

  let bpm = 120;
  try {
    bpm =
      Math.round(
        ess.PercivalBpmEstimator(vec, 1024, 2048, 128, 128, 210, 50, 16000).bpm
      ) || 120;
  } catch (e) {
    console.warn('[BPM]', e);
  }

  let key = 'Unknown';
  try {
    const k = ess.KeyExtractor(
      vec,
      true,
      4096,
      4096,
      12,
      3500,
      60,
      25,
      0.2,
      'bgate',
      16000,
      0.0001,
      440,
      'cosine',
      'hann'
    );
    key = `${k.key} ${k.scale}`;
  } catch (e) {
    console.warn('[Key]', e);
  }

  vec.delete();

  await initAudioWorkers();
  const features = await computeFeatures(audioForNN);
  const mood = await runInference(features);

  const {
    danceability,
    mood_aggressive: aggressiveness,
    mood_happy,
    mood_relaxed,
    mood_sad,
  } = mood;

  return {
    bpm,
    key,
    danceability,
    aggressiveness,
    mood_happy,
    mood_relaxed,
    mood_sad,
    engagement: Math.min(1, (aggressiveness + mood_happy + danceability) / 3),
    approachability: Math.min(
      1,
      (mood_happy + danceability + (1 - aggressiveness)) / 3
    ),
  };
}

export async function extractFeaturesFromFile(file: File): Promise<ExtractedAudioFeatures> {
  const buf = await file.arrayBuffer();
  return extractFeaturesFromArrayBuffer(buf);
}

/** YouTube / no-audio URL: neutral scalars; embedding comes from text at ingest. */
export function neutralFeaturesForMetadataOnly(): ExtractedAudioFeatures {
  return {
    bpm: 120,
    key: 'Unknown',
    danceability: 0.55,
    aggressiveness: 0.45,
    mood_happy: 0.55,
    mood_relaxed: 0.45,
    mood_sad: 0.25,
    engagement: 0.55,
    approachability: 0.65,
  };
}
