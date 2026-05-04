import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { embedTextToVectorLiteral } from '@/lib/server/embedder';

/** Clamp a number to [min, max] and round to `dp` decimal places. */
const clamp = (v: number, min: number, max: number, dp = 4) =>
  parseFloat(Math.max(min, Math.min(max, v)).toFixed(dp));

/** Safe feature extraction with clamping to [0, 1]. */
const feat = (obj: Record<string, any> | undefined, key: string, fallback: number) =>
  clamp(typeof obj?.[key] === 'number' ? obj[key] : fallback, 0, 1);

interface IngestBody {
  track_name?: unknown;
  artist_names?: unknown;
  track_url?: unknown;
  genre?: unknown;
  bpm?: unknown;
  features?: Record<string, any>;
  external_track_id?: unknown;
  release_name?: unknown;
  label?: unknown;
  musical_key?: unknown;
  is_explicit?: unknown;
}

interface ValidatedTrack {
  track_name: string;
  artist_names: string[];
  track_url: string | null;
  genre: string;
  bpm: number;
  danceability: number;
  mood_happy: number;
  mood_sad: number;
  mood_relaxed: number;
  aggressiveness: number;
  engagement: number;
  approachability: number;
  external_track_id: string | null;
  release_name: string | null;
  label: string | null;
  musical_key: string | null;
  is_explicit: boolean | null;
}

function optionalTrimmedString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new ValidationError('Invalid string field');
  const t = v.trim();
  return t ? t : null;
}

function validate(body: IngestBody): ValidatedTrack {
  const {
    track_name,
    artist_names,
    track_url,
    genre,
    bpm,
    features,
    external_track_id,
    release_name,
    label,
    musical_key,
    is_explicit,
  } = body;

  if (typeof track_name !== 'string' || !track_name.trim()) {
    throw new ValidationError('track_name must be a non-empty string');
  }

  let artists: string[];
  if (artist_names === undefined || artist_names === null) {
    artists = ['Unknown'];
  } else if (typeof artist_names === 'string') {
    artists = [artist_names.trim()].filter(Boolean);
  } else if (
    Array.isArray(artist_names) &&
    artist_names.every((a) => typeof a === 'string')
  ) {
    artists = artist_names.map((a) => a.trim()).filter(Boolean);
  } else {
    throw new ValidationError('artist_names must be a string or array of strings');
  }

  const rawBpm = typeof bpm === 'number' ? bpm : 120;
  if (!Number.isFinite(rawBpm)) {
    throw new ValidationError('bpm must be a finite number');
  }

  if (track_url !== undefined && track_url !== null && typeof track_url !== 'string') {
    throw new ValidationError('track_url must be a string when provided');
  }

  const normalizedTrackUrl =
    typeof track_url === 'string' && track_url.trim() ? track_url.trim() : null;

  let explicit: boolean | null = null;
  if (is_explicit !== undefined && is_explicit !== null) {
    if (typeof is_explicit !== 'boolean') {
      throw new ValidationError('is_explicit must be a boolean when provided');
    }
    explicit = is_explicit;
  }

  const ext = optionalTrimmedString(external_track_id);

  return {
    track_name: track_name.trim(),
    artist_names: artists.length ? artists : ['Unknown'],
    track_url: normalizedTrackUrl,
    genre: typeof genre === 'string' ? genre.trim() || 'Unknown' : 'Unknown',
    bpm: clamp(Math.round(rawBpm), 20, 300, 0),
    danceability: feat(features, 'danceability', 0.5),
    mood_happy: feat(features, 'mood_happy', 0.5),
    mood_sad: feat(features, 'mood_sad', 0.2),
    mood_relaxed: feat(features, 'mood_relaxed', 0.5),
    aggressiveness: feat(features, 'aggressiveness', 0.5),
    engagement: feat(features, 'engagement', 0.6),
    approachability: feat(features, 'approachability', 0.7),
    external_track_id: ext,
    release_name: optionalTrimmedString(release_name),
    label: optionalTrimmedString(label),
    musical_key: optionalTrimmedString(musical_key),
    is_explicit: explicit,
  };
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function buildTrackEmbeddingText(t: ValidatedTrack): string {
  const release = t.release_name ? `Release: ${t.release_name}. ` : '';
  const lab = t.label ? `Label: ${t.label}. ` : '';
  const key = t.musical_key ? `Key: ${t.musical_key}. ` : '';
  return [
    `Track: ${t.track_name}.`,
    `Artist: ${t.artist_names.join(', ')}.`,
    release + lab + key,
    `Genre: ${t.genre}.`,
    `BPM: ${t.bpm}.`,
    `Energy: ${t.aggressiveness.toFixed(2)}.`,
    `Danceability: ${t.danceability.toFixed(2)}.`,
    `Mood happy: ${t.mood_happy.toFixed(2)}.`,
    `Mood sad: ${t.mood_sad.toFixed(2)}.`,
    `Mood relaxed: ${t.mood_relaxed.toFixed(2)}.`,
    `Engagement: ${t.engagement.toFixed(2)}.`,
    `Approachability: ${t.approachability.toFixed(2)}.`,
  ].join(' ');
}

export async function POST(req: Request) {
  let track: ValidatedTrack;
  try {
    const body: IngestBody = await req.json();
    track = validate(body);
  } catch (err: any) {
    const isValidation = err instanceof ValidationError;
    return NextResponse.json(
      { error: isValidation ? err.message : 'Invalid request body' },
      { status: 400 }
    );
  }

  let realVector: string;
  try {
    realVector = await embedTextToVectorLiteral(buildTrackEmbeddingText(track));
  } catch (err) {
    console.error('[Ingestion] Embedding failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate track embedding' },
      { status: 500 }
    );
  }

  try {
    /** Upsert by partial unique index on external_track_id (avoids bulk CSV race on same id). */
    const sqlWithExternal = `
      INSERT INTO tracks (
        track_name, artist_names, track_url, genre, bpm,
        danceability, mood_happy, mood_sad, mood_relaxed,
        aggressiveness, engagement, approachability, embedding,
        external_track_id, release_name, label, musical_key, is_explicit
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (external_track_id) WHERE (external_track_id IS NOT NULL)
      DO UPDATE SET
        track_name = EXCLUDED.track_name,
        artist_names = EXCLUDED.artist_names,
        track_url = EXCLUDED.track_url,
        genre = EXCLUDED.genre,
        bpm = EXCLUDED.bpm,
        danceability = EXCLUDED.danceability,
        mood_happy = EXCLUDED.mood_happy,
        mood_sad = EXCLUDED.mood_sad,
        mood_relaxed = EXCLUDED.mood_relaxed,
        aggressiveness = EXCLUDED.aggressiveness,
        engagement = EXCLUDED.engagement,
        approachability = EXCLUDED.approachability,
        embedding = EXCLUDED.embedding,
        release_name = EXCLUDED.release_name,
        label = EXCLUDED.label,
        musical_key = EXCLUDED.musical_key,
        is_explicit = EXCLUDED.is_explicit
      RETURNING id, (xmax = 0) AS inserted
    `;

    const paramsWithExternal = [
      track.track_name,
      track.artist_names,
      track.track_url,
      track.genre,
      track.bpm,
      track.danceability,
      track.mood_happy,
      track.mood_sad,
      track.mood_relaxed,
      track.aggressiveness,
      track.engagement,
      track.approachability,
      realVector,
      track.external_track_id,
      track.release_name,
      track.label,
      track.musical_key,
      track.is_explicit,
    ];

    const sqlLegacy = `
      WITH existing AS (
        SELECT id FROM tracks
        WHERE track_name = $1 AND artist_names[1] = $2
        LIMIT 1
      ),
      updated AS (
        UPDATE tracks SET
          track_url         = $14,
          genre             = $3,
          bpm               = $4,
          danceability      = $5,
          mood_happy        = $6,
          mood_sad          = $7,
          mood_relaxed      = $8,
          aggressiveness    = $9,
          engagement        = $10,
          approachability   = $11,
          embedding         = $12,
          external_track_id = $15,
          release_name      = $16,
          label             = $17,
          musical_key       = $18,
          is_explicit       = $19
        WHERE id = (SELECT id FROM existing)
        RETURNING id, false AS inserted
      ),
      inserted AS (
        INSERT INTO tracks (
          track_name, artist_names, track_url, genre, bpm,
          danceability, mood_happy, mood_sad, mood_relaxed,
          aggressiveness, engagement, approachability, embedding,
          external_track_id, release_name, label, musical_key, is_explicit
        )
        SELECT
          $1, $13, $14, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $15, $16, $17, $18, $19
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id, true AS inserted
      )
      SELECT * FROM updated
      UNION ALL
      SELECT * FROM inserted
    `;

    const paramsLegacy = [
      track.track_name,
      track.artist_names[0],
      track.genre,
      track.bpm,
      track.danceability,
      track.mood_happy,
      track.mood_sad,
      track.mood_relaxed,
      track.aggressiveness,
      track.engagement,
      track.approachability,
      realVector,
      track.artist_names,
      track.track_url,
      track.external_track_id,
      track.release_name,
      track.label,
      track.musical_key,
      track.is_explicit,
    ];

    const result = await query(
      track.external_track_id ? sqlWithExternal : sqlLegacy,
      track.external_track_id ? paramsWithExternal : paramsLegacy
    );
    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      message: row.inserted ? 'Track ingested successfully' : 'Track updated successfully',
      trackId: row.id,
      inserted: row.inserted,
    });
  } catch (err: unknown) {
    console.error('[Ingestion] DB error:', err);
    const e = err as { code?: string; message?: string };
    if (e.code === '42703') {
      return NextResponse.json(
        {
          error:
            'Database schema out of date. Run migrations/001_extend_tracks.sql (see repo).',
        },
        { status: 500 }
      );
    }
    if (e.code === '23505') {
      return NextResponse.json(
        { error: 'Duplicate external_track_id' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to save track' }, { status: 500 });
  }
}
