-- Enable the vector extension if not already present
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Metadata
    track_name TEXT NOT NULL,
    artist_names TEXT[],
    track_url TEXT,
    genre TEXT,
    bpm INTEGER,

    external_track_id TEXT,
    release_name TEXT,
    label TEXT,
    musical_key TEXT,
    is_explicit BOOLEAN,

    -- Essentia.js Specific Features (Confidence scores 0.0 - 1.0)
    danceability REAL,
    mood_happy REAL,
    mood_sad REAL,
    mood_relaxed REAL,
    aggressiveness REAL,
    engagement REAL,
    approachability REAL,

    -- Combined AI Vector for Similarity Search
    -- 384 dimensions is standard for models like Xenova/all-MiniLM-L6-v2
    embedding vector(384) 
);

CREATE UNIQUE INDEX tracks_external_track_id_key
  ON tracks (external_track_id)
  WHERE external_track_id IS NOT NULL;

CREATE INDEX tracks_genre_idx ON tracks (genre);
CREATE INDEX tracks_label_idx ON tracks (label);
CREATE INDEX tracks_musical_key_idx ON tracks (musical_key);
CREATE INDEX tracks_bpm_idx ON tracks (bpm);

-- Index for high-performance recommendation queries
CREATE INDEX ON tracks USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- ZipDJ catalog (metadata-only ingest; same embedding dimension as tracks)
CREATE TABLE zipdj_tracks_ai (
    track_id TEXT PRIMARY KEY,
    track_name TEXT NOT NULL DEFAULT '',
    track_url TEXT,
    release_name TEXT NOT NULL,
    release_id TEXT,
    label_name TEXT,
    label_id TEXT,
    artists_name TEXT,
    genre TEXT,
    tags TEXT,
    track_created_date DATE,
    release_created_date DATE,
    embedding vector(384) NOT NULL
);

CREATE INDEX zipdj_tracks_ai_release_id_idx ON zipdj_tracks_ai (release_id);
CREATE INDEX zipdj_tracks_ai_genre_idx ON zipdj_tracks_ai (genre);
CREATE INDEX zipdj_tracks_ai_label_id_idx ON zipdj_tracks_ai (label_id);

CREATE INDEX zipdj_tracks_ai_embedding_hnsw
  ON zipdj_tracks_ai USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
