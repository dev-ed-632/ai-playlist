export interface ZipdjTrackFields {
  release_name: string;
  track_name: string;
  artists_name: string | null;
  genre: string | null;
  tags: string | null;
  label_name: string | null;
  label_id: string | null;
  release_id: string | null;
  track_created_date: string | null;
  release_created_date: string | null;
}

/**
 * Embedding text emphasizes release_name as the canonical "song"; track_name is the mix/version.
 */
export function buildZipdjEmbeddingText(t: ZipdjTrackFields): string {
  const lab =
    t.label_name?.trim() || t.label_id?.trim()
      ? `Label: ${[t.label_name?.trim(), t.label_id?.trim()].filter(Boolean).join(' / ')}. `
      : '';
  const relId = t.release_id?.trim() ? `Release ID: ${t.release_id.trim()}. ` : '';
  const artists = t.artists_name?.trim() ? `Artists: ${t.artists_name.trim()}. ` : '';
  const genre = t.genre?.trim() ? `Genre: ${t.genre.trim()}. ` : '';
  const tagStr = t.tags?.trim() ? `Tags: ${t.tags.trim()}. ` : '';
  const mix = t.track_name?.trim() ? `Mix: ${t.track_name.trim()}. ` : '';
  const td = t.track_created_date?.trim() ? `Track date: ${t.track_created_date.trim()}. ` : '';
  const rd = t.release_created_date?.trim() ? `Release date: ${t.release_created_date.trim()}. ` : '';

  return [
    `Release: ${t.release_name.trim()}.`,
    mix,
    td + rd,
    artists,
    relId + lab,
    genre,
    tagStr,
  ]
    .filter(Boolean)
    .join(' ');
}
