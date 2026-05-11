import { query } from '@/lib/db';
import type { WebTrackCandidate } from '@/lib/llm/extractZipdjWebCandidates';

export interface ZipdjRow {
  track_id: string;
  track_name: string;
  track_url: string | null;
  release_name: string;
  release_id: string | null;
  label_name: string | null;
  label_id: string | null;
  artists_name: string | null;
  genre: string | null;
  tags: string | null;
  track_created_date: string | null;
  release_created_date: string | null;
}

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well a catalog row matches a web chart line (title + artist).
 * Used to rerank vector neighbors so the right row wins when pure embedding order is wrong.
 */
export function zipdjWebCandidateLexicalScore(
  title: string,
  artist: string | null,
  row: ZipdjRow
): number {
  const titleNorm = normalizeToken(title);
  if (titleNorm.length < 2) return 0;
  const rel = normalizeToken(row.release_name || '');
  const trk = normalizeToken(row.track_name || '');
  const arts = normalizeToken(row.artists_name || '');

  let s = 0;
  if (rel === titleNorm || trk === titleNorm) s += 100;
  else if (rel.includes(titleNorm) || titleNorm.includes(rel)) s += 45;
  else if (trk.includes(titleNorm) || titleNorm.includes(trk)) s += 35;

  const tw = titleNorm.split(' ').filter((w) => w.length > 1);
  if (tw.length > 1) {
    const relWords = new Set(rel.split(' ').filter(Boolean));
    let overlap = 0;
    for (const w of tw) if (relWords.has(w)) overlap++;
    s += Math.round((12 * overlap) / tw.length);
  }

  const needle = artistNeedle(artist);
  if (needle && arts.includes(needle)) s += 28;

  return s;
}

/**
 * Among top-K vector neighbors for a web candidate, pick the row that best matches title/artist
 * when there is lexical signal; otherwise keep the nearest by `vec_dist`.
 */
export function pickBestZipdjNeighborForWebCandidate(
  title: string,
  artist: string | null,
  neighbors: (ZipdjRow & { vec_dist: number })[]
): (ZipdjRow & { vec_dist: number }) | undefined {
  if (neighbors.length === 0) return undefined;
  const maxLex = Math.max(
    ...neighbors.map((row) => zipdjWebCandidateLexicalScore(title, artist, row))
  );
  if (maxLex <= 0) {
    return neighbors[0];
  }
  const ranked = [...neighbors].sort((a, b) => {
    const la = zipdjWebCandidateLexicalScore(title, artist, a);
    const lb = zipdjWebCandidateLexicalScore(title, artist, b);
    if (lb !== la) return lb - la;
    return a.vec_dist - b.vec_dist;
  });
  return ranked[0];
}

/** First meaningful token from artist string (skip "The"). */
function artistNeedle(artist: string | null): string | null {
  if (!artist) return null;
  const n = normalizeToken(artist);
  if (!n) return null;
  const parts = n.split(' ').filter(Boolean);
  if (!parts.length) return null;
  if (parts[0] === 'the' && parts.length > 1) return parts[1].slice(0, 64);
  return parts[0].slice(0, 64);
}

/**
 * Match catalog rows where release_name or track_name aligns with the external title; optionally require artist token.
 */
export async function matchZipdjByCandidate(c: WebTrackCandidate): Promise<ZipdjRow[]> {
  const titleNorm = normalizeToken(c.title);
  if (titleNorm.length < 2) return [];

  const needle = `%${titleNorm}%`;
  const art = artistNeedle(c.artist);

  if (art) {
    const sql = `
      SELECT track_id, track_name, track_url, release_name, release_id,
             label_name, label_id, artists_name, genre, tags,
             track_created_date::text AS track_created_date,
             release_created_date::text AS release_created_date
      FROM zipdj_tracks_ai
      WHERE (
        lower(release_name) LIKE $1
        OR lower(track_name) LIKE $1
      )
      AND lower(coalesce(artists_name, '')) LIKE $2
      ORDER BY
        CASE WHEN lower(release_name) LIKE $1 THEN 0 ELSE 1 END
      LIMIT 5
    `;
    const { rows } = await query(sql, [needle, `%${art}%`]);
    return rows as ZipdjRow[];
  }

  const sql = `
    SELECT track_id, track_name, track_url, release_name, release_id,
           label_name, label_id, artists_name, genre, tags,
           track_created_date::text AS track_created_date,
           release_created_date::text AS release_created_date
    FROM zipdj_tracks_ai
    WHERE lower(release_name) LIKE $1
       OR lower(track_name) LIKE $1
    ORDER BY
      CASE WHEN lower(release_name) LIKE $1 THEN 0 ELSE 1 END
    LIMIT 5
  `;
  const { rows } = await query(sql, [needle]);
  return rows as ZipdjRow[];
}

export async function vectorSearchZipdj(
  vectorLiteral: string,
  limit: number
): Promise<(ZipdjRow & { vec_dist: number })[]> {
  const sql = `
    SELECT track_id, track_name, track_url, release_name, release_id,
           label_name, label_id, artists_name, genre, tags,
           track_created_date::text AS track_created_date,
           release_created_date::text AS release_created_date,
           (embedding <=> $1::vector) AS vec_dist
    FROM zipdj_tracks_ai
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;
  const { rows } = await query(sql, [vectorLiteral, limit]);
  return rows as (ZipdjRow & { vec_dist: number })[];
}

/** Like `vectorSearchZipdj` but omits one catalog id (e.g. now-playing). */
export async function vectorSearchZipdjExcluding(
  vectorLiteral: string,
  limit: number,
  excludeTrackId: string | null
): Promise<(ZipdjRow & { vec_dist: number })[]> {
  const ex = excludeTrackId?.trim();
  if (!ex) {
    return vectorSearchZipdj(vectorLiteral, limit);
  }
  const sql = `
    SELECT track_id, track_name, track_url, release_name, release_id,
           label_name, label_id, artists_name, genre, tags,
           track_created_date::text AS track_created_date,
           release_created_date::text AS release_created_date,
           (embedding <=> $1::vector) AS vec_dist
    FROM zipdj_tracks_ai
    WHERE track_id <> $2::text
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `;
  const { rows } = await query(sql, [vectorLiteral, ex, limit]);
  return rows as (ZipdjRow & { vec_dist: number })[];
}

/** Optional ILIKE / date bounds on `zipdj_tracks_ai` (release date filter). */
export type ZipdjCatalogFilters = {
  artist: string | null;
  label: string | null;
  genre: string | null;
  releaseDateFrom: string | null;
  releaseDateTo: string | null;
};

const SELECT_ZIPDJ_ROW = `
  SELECT track_id, track_name, track_url, release_name, release_id,
         label_name, label_id, artists_name, genre, tags,
         track_created_date::text AS track_created_date,
         release_created_date::text AS release_created_date
`;

/** WHERE using bind positions $1–$5: artist, label, genre, release_date_from, release_date_to. */
const WHERE_ZIPDJ_FILTERS_P1_5 = `
  ($1::text IS NULL OR COALESCE(artists_name, '') ILIKE '%' || $1 || '%')
  AND ($2::text IS NULL OR COALESCE(label_name, '') ILIKE '%' || $2 || '%')
  AND ($3::text IS NULL OR COALESCE(genre, '') ILIKE '%' || $3 || '%')
  AND ($4::date IS NULL OR release_created_date >= $4)
  AND ($5::date IS NULL OR release_created_date <= $5)
`;

function filterBindArray(f: ZipdjCatalogFilters): [string | null, string | null, string | null, string | null, string | null] {
  return [f.artist, f.label, f.genre, f.releaseDateFrom, f.releaseDateTo];
}

export async function countZipdjFiltered(f: ZipdjCatalogFilters): Promise<number> {
  const sql = `
    SELECT COUNT(*)::int AS c
    FROM zipdj_tracks_ai
    WHERE ${WHERE_ZIPDJ_FILTERS_P1_5}
  `;
  const { rows } = await query(sql, filterBindArray(f));
  const n = rows[0]?.c;
  return typeof n === 'number' ? n : Number(n) || 0;
}

export async function browseZipdjFiltered(
  f: ZipdjCatalogFilters,
  limit: number,
  offset: number
): Promise<ZipdjRow[]> {
  const sql = `
    ${SELECT_ZIPDJ_ROW}
    FROM zipdj_tracks_ai
    WHERE ${WHERE_ZIPDJ_FILTERS_P1_5}
    ORDER BY release_created_date DESC NULLS LAST, track_id ASC
    LIMIT $6 OFFSET $7
  `;
  const { rows } = await query(sql, [...filterBindArray(f), limit, offset]);
  return rows as ZipdjRow[];
}

/** WHERE using $2–$6 for filters; $1 is the query vector literal. */
const WHERE_ZIPDJ_FILTERS_P2_6 = `
  ($2::text IS NULL OR COALESCE(artists_name, '') ILIKE '%' || $2 || '%')
  AND ($3::text IS NULL OR COALESCE(label_name, '') ILIKE '%' || $3 || '%')
  AND ($4::text IS NULL OR COALESCE(genre, '') ILIKE '%' || $4 || '%')
  AND ($5::date IS NULL OR release_created_date >= $5)
  AND ($6::date IS NULL OR release_created_date <= $6)
`;

export async function vectorSearchZipdjFiltered(
  vectorLiteral: string,
  f: ZipdjCatalogFilters,
  limit: number,
  offset: number
): Promise<(ZipdjRow & { vec_dist: number })[]> {
  const sql = `
    SELECT track_id, track_name, track_url, release_name, release_id,
           label_name, label_id, artists_name, genre, tags,
           track_created_date::text AS track_created_date,
           release_created_date::text AS release_created_date,
           (embedding <=> $1::vector) AS vec_dist
    FROM zipdj_tracks_ai
    WHERE ${WHERE_ZIPDJ_FILTERS_P2_6}
    ORDER BY embedding <=> $1::vector
    LIMIT $7 OFFSET $8
  `;
  const { rows } = await query(sql, [vectorLiteral, ...filterBindArray(f), limit, offset]);
  return rows as (ZipdjRow & { vec_dist: number })[];
}
