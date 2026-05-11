-- ZipDJ catalog: metadata + embeddings (384-d MiniLM, same as tracks)
CREATE TABLE IF NOT EXISTS zipdj_tracks_ai (
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

CREATE INDEX IF NOT EXISTS zipdj_tracks_ai_release_id_idx ON zipdj_tracks_ai (release_id);
CREATE INDEX IF NOT EXISTS zipdj_tracks_ai_genre_idx ON zipdj_tracks_ai (genre);
CREATE INDEX IF NOT EXISTS zipdj_tracks_ai_label_id_idx ON zipdj_tracks_ai (label_id);

CREATE INDEX IF NOT EXISTS zipdj_tracks_ai_embedding_hnsw
  ON zipdj_tracks_ai USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
