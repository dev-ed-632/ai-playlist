-- Clears catalog rows (required when reshaping columns per product rules), then adds date columns.
TRUNCATE TABLE zipdj_tracks_ai;

ALTER TABLE zipdj_tracks_ai ADD COLUMN IF NOT EXISTS track_created_date DATE;
ALTER TABLE zipdj_tracks_ai ADD COLUMN IF NOT EXISTS release_created_date DATE;
