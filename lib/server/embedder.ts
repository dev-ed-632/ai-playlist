import { pipeline } from '@xenova/transformers';

let embedderPromise: Promise<any> | null = null;

/**
 * Singleton feature-extraction pipeline (384-d MiniLM) for ingest, search, and playlist APIs.
 */
export function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    ).catch((err) => {
      embedderPromise = null;
      throw err;
    });
  }
  return embedderPromise;
}

/** Embed text to pgvector literal `[f1,f2,...]`. */
export async function embedTextToVectorLiteral(text: string): Promise<string> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const arr = Array.from(output.data as Float32Array);
  return `[${arr.join(',')}]`;
}

const EMBED_DIM = 384;

/** Batch embed (same model); returns one pgvector literal per input string. */
export async function embedTextsBatchToVectorLiterals(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  const data = output.data as Float32Array;
  const out: string[] = [];
  for (let i = 0; i < data.length; i += EMBED_DIM) {
    const slice = data.subarray(i, i + EMBED_DIM);
    out.push(`[${Array.from(slice).join(',')}]`);
  }
  if (out.length !== texts.length) {
    throw new Error(`Embedding batch mismatch: wanted ${texts.length} vectors, got ${out.length}`);
  }
  return out;
}
