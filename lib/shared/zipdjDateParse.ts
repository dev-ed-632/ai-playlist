/**
 * ZipDJ CSV dates: ISO strings, or Unix seconds (10 digits) / milliseconds (13 digits).
 * Returns YYYY-MM-DD for Postgres DATE (UTC calendar day).
 */
export function parseZipdjDateInput(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return unixLikeToIsoDateMs(v > 1e12 ? v : v * 1000);
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  if (/^\d{10}$/.test(s)) {
    return unixLikeToIsoDateMs(Number(s) * 1000);
  }
  if (/^\d{13}$/.test(s)) {
    return unixLikeToIsoDateMs(Number(s));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function unixLikeToIsoDateMs(ms: number): string | null {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
