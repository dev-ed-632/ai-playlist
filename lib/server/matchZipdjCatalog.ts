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
