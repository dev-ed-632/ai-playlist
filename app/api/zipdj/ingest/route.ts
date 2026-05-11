import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { embedTextToVectorLiteral } from '@/lib/server/embedder';
import { buildZipdjEmbeddingText } from '@/lib/server/zipdjEmbedding';
import { parseZipdjDateInput } from '@/lib/shared/zipdjDateParse';

interface ZipdjIngestBody {
  track_id?: unknown;
  track_name?: unknown;
  track_url?: unknown;
  release_name?: unknown;
  release_id?: unknown;
  label_name?: unknown;
  label_id?: unknown;
  artists_name?: unknown;
  genre?: unknown;
  tags?: unknown;
  track_created_date?: unknown;
  release_created_date?: unknown;
}

function trimOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function trimOrEmpty(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim();
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validate(body: ZipdjIngestBody) {
  const track_id = trimOrNull(body.track_id);
  const release_name = trimOrNull(body.release_name);
  if (!track_id) throw new ValidationError('track_id is required');
  if (!release_name) throw new ValidationError('release_name is required');

  return {
    track_id,
    track_name: trimOrEmpty(body.track_name),
    track_url: trimOrNull(body.track_url),
    release_name,
    release_id: trimOrNull(body.release_id),
    label_name: trimOrNull(body.label_name),
    label_id: trimOrNull(body.label_id),
    artists_name: trimOrNull(body.artists_name),
    genre: trimOrNull(body.genre),
    tags: trimOrNull(body.tags),
    track_created_date: parseZipdjDateInput(body.track_created_date),
    release_created_date: parseZipdjDateInput(body.release_created_date),
  };
}

export async function POST(req: Request) {
  let row: ReturnType<typeof validate>;
  try {
    const body: ZipdjIngestBody = await req.json();
    row = validate(body);
  } catch (err: unknown) {
    const isValidation = err instanceof ValidationError;
    return NextResponse.json(
      { error: isValidation ? err.message : 'Invalid request body' },
      { status: 400 }
    );
  }

  let vectorLiteral: string;
  try {
    vectorLiteral = await embedTextToVectorLiteral(
      buildZipdjEmbeddingText({
        release_name: row.release_name,
        track_name: row.track_name,
        artists_name: row.artists_name,
        genre: row.genre,
        tags: row.tags,
        label_name: row.label_name,
        label_id: row.label_id,
        release_id: row.release_id,
        track_created_date: row.track_created_date,
        release_created_date: row.release_created_date,
      })
    );
  } catch (err) {
    console.error('[ZipDJ ingest] Embedding failed:', err);
    return NextResponse.json({ error: 'Failed to generate embedding' }, { status: 500 });
  }

  const sql = `
    INSERT INTO zipdj_tracks_ai (
      track_id, track_name, track_url, release_name, release_id,
      label_name, label_id, artists_name, genre, tags,
      track_created_date, release_created_date, embedding
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector)
    ON CONFLICT (track_id) DO UPDATE SET
      track_name = EXCLUDED.track_name,
      track_url = EXCLUDED.track_url,
      release_name = EXCLUDED.release_name,
      release_id = EXCLUDED.release_id,
      label_name = EXCLUDED.label_name,
      label_id = EXCLUDED.label_id,
      artists_name = EXCLUDED.artists_name,
      genre = EXCLUDED.genre,
      tags = EXCLUDED.tags,
      track_created_date = EXCLUDED.track_created_date,
      release_created_date = EXCLUDED.release_created_date,
      embedding = EXCLUDED.embedding
    RETURNING track_id, (xmax = 0) AS inserted
  `;

  const params = [
    row.track_id,
    row.track_name || '',
    row.track_url,
    row.release_name,
    row.release_id,
    row.label_name,
    row.label_id,
    row.artists_name,
    row.genre,
    row.tags,
    row.track_created_date,
    row.release_created_date,
    vectorLiteral,
  ];

  try {
    const result = await query(sql, params);
    const r = result.rows[0] as { track_id: string; inserted: boolean };
    return NextResponse.json({
      success: true,
      trackId: r.track_id,
      inserted: r.inserted,
      message: r.inserted ? 'ZipDJ track ingested' : 'ZipDJ track updated',
    });
  } catch (err: unknown) {
    console.error('[ZipDJ ingest] DB error:', err);
    const e = err as { code?: string };
    if (e.code === '42P01') {
      return NextResponse.json(
        {
          error:
            'Table zipdj_tracks_ai missing. Run migrations/002_zipdj_tracks_ai.sql against your database.',
        },
        { status: 500 }
      );
    }
    if (e.code === '42703') {
      return NextResponse.json(
        {
          error:
            'zipdj_tracks_ai schema out of date. Run migrations/003_zipdj_tracks_ai_dates.sql (adds track_created_date / release_created_date).',
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'Failed to save ZipDJ track' }, { status: 500 });
  }
}
