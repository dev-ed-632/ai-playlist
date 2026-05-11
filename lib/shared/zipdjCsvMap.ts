import { parseZipdjDateInput } from '@/lib/shared/zipdjDateParse';

export interface ZipdjMappedCsvRow {
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

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '');
}

function pick(byNorm: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = byNorm[k];
    if (v != null && v !== '') return v;
  }
  return '';
}

/** Map one CSV/TSV row (keys = raw header names) to DB fields. */
export function mapZipdjCsvRecord(rec: Record<string, string>): ZipdjMappedCsvRow | null {
  const keys = Object.keys(rec);
  const byNorm: Record<string, string> = {};
  for (const k of keys) {
    byNorm[normHeader(k)] = rec[k]?.trim() ?? '';
  }
  const track_id = pick(byNorm, 'track_id', 'trackid');
  const release_name = pick(byNorm, 'release_name', 'releasename');
  if (!track_id || !release_name) return null;

  const trackCreatedRaw = pick(
    byNorm,
    'track_created_date',
    'trackcreateddate',
    'track_date'
  );
  const releaseCreatedRaw = pick(
    byNorm,
    'release_created_date',
    'releasecreateddate',
    'release_date'
  );

  const trackUrl = pick(byNorm, 'track_url', 'trackurl');
  const releaseId = pick(byNorm, 'release_id', 'releaseid');
  const labelName = pick(byNorm, 'label_name', 'labelname');
  const labelId = pick(byNorm, 'label_id', 'labelid');
  const artistsName = pick(byNorm, 'artists_name', 'artists', 'artist');
  const genre = pick(byNorm, 'genre');
  const tags = pick(byNorm, 'tags');

  return {
    track_id,
    track_name: pick(byNorm, 'track_name', 'trackname'),
    track_url: trackUrl ? trackUrl : null,
    release_name,
    release_id: releaseId ? releaseId : null,
    label_name: labelName ? labelName : null,
    label_id: labelId ? labelId : null,
    artists_name: artistsName ? artistsName : null,
    genre: genre ? genre : null,
    tags: tags ? tags : null,
    track_created_date: parseZipdjDateInput(trackCreatedRaw),
    release_created_date: parseZipdjDateInput(releaseCreatedRaw),
  };
}
