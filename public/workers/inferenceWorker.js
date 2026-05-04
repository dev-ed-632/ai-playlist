// public/workers/inferenceWorker.js
//
// Single worker loads TF + WASM ONCE, then runs all 5 models sequentially.
// Previously: 5 workers × (TF init + WASM heap + model load) = ~5 min
// Now:        1 worker  × (TF init + WASM heap) + 5 model loads = ~20 sec

importScripts('/tf.min.3.5.0.js');
importScripts('/essentia.js-model.umd.js');
importScripts('/tf-backend-wasm-3.5.0.js');

const MODEL_NAMES = ['mood_happy', 'mood_sad', 'mood_relaxed', 'mood_aggressive', 'danceability'];

// Which index in [v0, v1] is the positive class — from inference.js modelTagOrder
const MODEL_TAG_ORDER = {
    mood_happy:      [true,  false],
    mood_sad:        [false, true],
    mood_relaxed:    [false, true],
    mood_aggressive: [true,  false],
    danceability:    [true,  false],
};

const models = {};
let ready = false;

// Exact copy of twoValuesAverage from inference.js
function twoValuesAverage(arrayOfArrays) {
    let firstValues = [], secondValues = [];
    arrayOfArrays.forEach(([a, b]) => { firstValues.push(a); secondValues.push(b); });
    return [
        firstValues.reduce((s, v)  => s + v, 0) / firstValues.length,
        secondValues.reduce((s, v) => s + v, 0) / secondValues.length,
    ];
}

async function init() {
    // Init TF WASM once — all 5 models share this single backend
    tf.wasm.setWasmPaths({
        'tfjs-backend-wasm.wasm':               '/tfjs-backend-wasm.wasm',
        'tfjs-backend-wasm-simd.wasm':          '/tfjs-backend-wasm-simd.wasm',
        'tfjs-backend-wasm-threaded-simd.wasm': '/tfjs-backend-wasm-threaded-simd.wasm',
    });
    await tf.setBackend('wasm');
    await tf.ready();
    console.info('[inferenceWorker] TF WASM ready:', tf.getBackend());

    // Load all 5 models sequentially — parallel loading thrashes the WASM heap
    for (const name of MODEL_NAMES) {
        const m = new EssentiaModel.TensorflowMusiCNN(
            tf, `/models/${name}-musicnn-msd-2/model.json`
        );
        await m.initialize();

        // Warm-up dry run
        const fake = {
            melSpectrum:  Array.from({ length: 187 }, () => new Array(96).fill(0)),
            frameSize: 187, melBandsSize: 96, patchSize: 187,
        };
        await m.predict(fake, true);
        models[name] = m;
        console.info(`[inferenceWorker] ${name} ready`);
        // Report each model ready so the UI can show progress if desired
        self.postMessage({ modelReady: name });
    }

    ready = true;
    self.postMessage({ ready: true });
}

async function runAll(features) {
    const results = {};
    for (const name of MODEL_NAMES) {
        const preds      = await models[name].predict(features, true);
        const [avg0, avg1] = twoValuesAverage(preds);
        results[name]    = MODEL_TAG_ORDER[name][0] ? avg0 : avg1;
    }
    self.postMessage({ predictions: results });
}

self.onmessage = function (msg) {
    if (msg.data.init) {
        init().catch(function (err) {
            self.postMessage({ error: String(err && err.message ? err.message : err) });
        });
    } else if (msg.data.features && ready) runAll(msg.data.features);
    else if (msg.data.features && !ready) self.postMessage({ error: 'Worker not ready yet' });
};