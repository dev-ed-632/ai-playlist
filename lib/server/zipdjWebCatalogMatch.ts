import { embedTextsBatchToVectorLiterals } from '@/lib/server/embedder';
import { buildZipdjEmbeddingText } from '@/lib/server/zipdjEmbedding';
import {
  pickBestZipdjNeighborForWebCandidate,
  vectorSearchZipdj,
  zipdjWebCandidateLexicalScore,
  type ZipdjRow,
} from '@/lib/server/matchZipdjCatalog';

/** Same embedding layout as CSV ingest so NN search matches catalog space. */
export function zipdjWebCandidateToEmbedQuery(title: string, artist: string | null): string {
  return buildZipdjEmbeddingText({
    release_name: title.trim(),
    track_name: '',
    artists_name: artist?.trim() || null,
    genre: null,
    tags: null,
    label_name: null,
    label_id: null,
    release_id: null,
    track_created_date: null,
    release_created_date: null,
  });
}

/** Newer catalog rows win ties after vector distance. */
export function zipdjCatalogRecencyTs(row: ZipdjRow): number {
  const s = row.release_created_date || row.track_created_date;
  if (!s?.trim()) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** Wider pool than 1-NN — correct row is often not the single closest cosine when query text drifts. */
export const ZIPDJ_WEB_VECTOR_NEIGHBOR_K = 28;
export const ZIPDJ_WEB_VECTOR_SEARCH_CONCURRENCY = 12;

export type ZipdjWebVectorHit = ZipdjRow & { vec_dist: number; web_lex: number };

export async function batchZipdjWebCandidateVectorHits(
  items: { title: string; artist: string | null; vector: string }[]
): Promise<ZipdjWebVectorHit[]> {
  const out: ZipdjWebVectorHit[] = [];
  for (let i = 0; i < items.length; i += ZIPDJ_WEB_VECTOR_SEARCH_CONCURRENCY) {
    const slice = items.slice(i, i + ZIPDJ_WEB_VECTOR_SEARCH_CONCURRENCY);
    const batch = await Promise.all(
      slice.map((it) => vectorSearchZipdj(it.vector, ZIPDJ_WEB_VECTOR_NEIGHBOR_K))
    );
    for (let j = 0; j < slice.length; j++) {
      const { title, artist } = slice[j]!;
      const near = batch[j]!;
      const hit = pickBestZipdjNeighborForWebCandidate(title, artist, near);
      if (hit) {
        out.push({
          ...hit,
          web_lex: zipdjWebCandidateLexicalScore(title, artist, hit),
        });
      }
    }
  }
  return out;
}

/** Dedupe by track_id, then rank by lexical title/artist lock-in, then distance, then recency. */
export function rankZipdjWebCatalogHits(
  hits: ZipdjWebVectorHit[],
  take: number
): { row: ZipdjRow; vecDist: number }[] {
  const best = new Map<string, ZipdjWebVectorHit>();
  for (const h of hits) {
    const cur = best.get(h.track_id);
    if (!cur) best.set(h.track_id, h);
    else if (h.web_lex > cur.web_lex) best.set(h.track_id, h);
    else if (h.web_lex === cur.web_lex && h.vec_dist < cur.vec_dist) best.set(h.track_id, h);
  }
  const ranked = [...best.values()].sort((a, b) => {
    if (b.web_lex !== a.web_lex) return b.web_lex - a.web_lex;
    if (a.vec_dist !== b.vec_dist) return a.vec_dist - b.vec_dist;
    return zipdjCatalogRecencyTs(b) - zipdjCatalogRecencyTs(a);
  });
  return ranked.slice(0, take).map((h) => {
    const { vec_dist: vecDist, web_lex, ...row } = h;
    void web_lex;
    return { row: row as ZipdjRow, vecDist };
  });
}

/** Embed chart lines and run batched vector + lexical neighbor pick (used by prompt + now-playing). */
export async function matchWebTrackTitlesToZipdjCatalog(
  titles: { title: string; artist: string | null }[],
  take: number
): Promise<{ row: ZipdjRow; vecDist: number }[]> {
  if (titles.length === 0) return [];
  const embedTexts = titles.map((t) => zipdjWebCandidateToEmbedQuery(t.title, t.artist));
  const vectors = await embedTextsBatchToVectorLiterals(embedTexts);
  const items = titles.map((t, idx) => ({
    title: t.title,
    artist: t.artist,
    vector: vectors[idx]!,
  }));
  const rawHits = await batchZipdjWebCandidateVectorHits(items);
  return rankZipdjWebCatalogHits(rawHits, take);
}
