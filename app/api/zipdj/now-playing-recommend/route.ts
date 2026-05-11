import { NextResponse } from 'next/server';
import { embedTextToVectorLiteral } from '@/lib/server/embedder';
import { runZipdjWebSearchWithAiSdk } from '@/lib/server/zipdjAiSdkWebSearch';
import { vectorSearchZipdjExcluding, type ZipdjRow } from '@/lib/server/matchZipdjCatalog';
import { matchWebTrackTitlesToZipdjCatalog } from '@/lib/server/zipdjWebCatalogMatch';

export const maxDuration = 120;

const TARGET = 10;
const WEB_CANDIDATES = 20;
const WEB_MATCH_POOL = 32;
const FALLBACK_VECTOR_LIMIT = 48;

type Source = 'web' | 'vector_fallback';

function serializeTrack(r: ZipdjRow, source: Source, vecDist?: number) {
  return {
    trackId: r.track_id,
    releaseName: r.release_name,
    trackName: r.track_name,
    trackUrl: r.track_url,
    artistsName: r.artists_name,
    genre: r.genre,
    labelName: r.label_name,
    trackCreatedDate: r.track_created_date,
    releaseCreatedDate: r.release_created_date,
    source,
    vecDist: vecDist != null ? Number(vecDist.toFixed(6)) : undefined,
  };
}

function buildNowPlayingBlock(args: {
  releaseName: string;
  trackName: string | null;
  artistsName: string | null;
  labelName: string | null;
  genre: string | null;
}): string {
  const lines = [
    `Release: ${args.releaseName.trim() || '(unknown)'}.`,
    args.trackName?.trim() ? `Mix / track line: ${args.trackName.trim()}.` : null,
    args.artistsName?.trim() ? `Artists: ${args.artistsName.trim()}.` : null,
    args.labelName?.trim() ? `Label: ${args.labelName.trim()}.` : null,
    args.genre?.trim() ? `Genre: ${args.genre.trim()}.` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function buildOriginalPrompt(block: string): string {
  return `${block}

The DJ is playing this record right now.

Task: Suggest **${WEB_CANDIDATES} distinct** other records that would work as **strong next selections** in the same set or club night: compatible genre and energy, credible artists, same scene or label ecosystem where it makes sense. Prefer **current** DJ charts, store charts (Beatport / Traxsource style), and reputable playlist pages — not generic all-time lists unless they clearly fit. Order **best-first** (most natural follow-up first). Do **not** repeat the now-playing release or an obvious duplicate of it.`;
}

function buildWebQuery(args: {
  releaseName: string;
  artistsName: string | null;
  genre: string | null;
}): string {
  const g = args.genre?.trim();
  const art = args.artistsName?.trim();
  const rel = args.releaseName.trim();
  const genreBit = g ? `${g} ` : '';
  const artistBit = art ? `${art} ` : '';
  return `DJ play after ${rel} ${artistBit}similar ${genreBit}tracks chart playlist next songs`;
}

function buildSimilarityNarrative(block: string): string {
  return `${block}

Describe and find DJ catalog records that feel like natural neighbors in the same crate: overlapping genre, energy, label culture, and crowd. Prefer tracks that would mix well after this one. Avoid naming the exact now-playing title as a result target.`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const releaseName = typeof body.releaseName === 'string' ? body.releaseName.trim() : '';
    const trackName = typeof body.trackName === 'string' ? body.trackName.trim() : '';
    const artistsName = typeof body.artistsName === 'string' ? body.artistsName.trim() : '';
    const labelName = typeof body.labelName === 'string' ? body.labelName.trim() : '';
    const genre = typeof body.genre === 'string' ? body.genre.trim() : '';
    const excludeTrackId =
      typeof body.excludeTrackId === 'string' && body.excludeTrackId.trim()
        ? body.excludeTrackId.trim()
        : null;

    if (!releaseName && !trackName && !artistsName) {
      return NextResponse.json(
        { error: 'Provide at least one of releaseName, trackName, or artistsName' },
        { status: 400 }
      );
    }

    const block = buildNowPlayingBlock({
      releaseName: releaseName || trackName || 'Unknown',
      trackName: trackName || null,
      artistsName: artistsName || null,
      labelName: labelName || null,
      genre: genre || null,
    });

    const originalPrompt = buildOriginalPrompt(block);
    const webQuery = buildWebQuery({
      releaseName: releaseName || trackName || 'track',
      artistsName: artistsName || null,
      genre: genre || null,
    });

    const seen = new Set<string>();
    if (excludeTrackId) seen.add(excludeTrackId);

    const out: ReturnType<typeof serializeTrack>[] = [];
    let notice: string | undefined;

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (apiKey) {
      try {
        const ai = await runZipdjWebSearchWithAiSdk({
          originalPrompt,
          webQuery,
          maxTracks: WEB_CANDIDATES,
          temporalContext: null,
        });
        const titles = ai.output.tracks;
        if (titles.length > 0) {
          const pairs = await matchWebTrackTitlesToZipdjCatalog(
            titles.map((t) => ({ title: t.title, artist: t.artist })),
            WEB_MATCH_POOL
          );
          for (const { row, vecDist } of pairs) {
            if (out.length >= TARGET) break;
            if (seen.has(row.track_id)) continue;
            seen.add(row.track_id);
            out.push(serializeTrack(row, 'web', vecDist));
          }
        }
      } catch (e) {
        console.error('[zipdj/now-playing-recommend] web pipeline:', e);
        notice =
          e instanceof Error
            ? `Web search failed (${e.message}); filled from catalog similarity.`
            : 'Web search failed; filled from catalog similarity.';
      }
    } else {
      notice = 'OPENAI_API_KEY not set; using catalog similarity only.';
    }

    if (out.length < TARGET) {
      const narrative = buildSimilarityNarrative(block);
      const vec = await embedTextToVectorLiteral(narrative);
      const neighbors = await vectorSearchZipdjExcluding(
        vec,
        FALLBACK_VECTOR_LIMIT,
        excludeTrackId
      );
      for (const r of neighbors) {
        if (out.length >= TARGET) break;
        if (seen.has(r.track_id)) continue;
        seen.add(r.track_id);
        out.push(serializeTrack(r, 'vector_fallback', r.vec_dist));
      }
    }

    return NextResponse.json({
      tracks: out,
      message: notice,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'now-playing recommend failed';
    console.error('[zipdj/now-playing-recommend]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
