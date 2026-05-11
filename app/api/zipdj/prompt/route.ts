import { NextResponse } from 'next/server';
import { embedTextToVectorLiteral } from '@/lib/server/embedder';
import { parseZipdjPrompt } from '@/lib/llm/parseZipdjPrompt';
import { runZipdjWebSearchWithAiSdk } from '@/lib/server/zipdjAiSdkWebSearch';
import { vectorSearchZipdj, type ZipdjRow } from '@/lib/server/matchZipdjCatalog';
import { matchWebTrackTitlesToZipdjCatalog } from '@/lib/server/zipdjWebCatalogMatch';
import { computeTemporalContext } from '@/lib/server/zipdjTemporalContext';

export const maxDuration = 120;

function serializeTrack(
  r: ZipdjRow,
  source: 'web' | 'vector',
  vecDist?: number
) {
  return {
    trackId: r.track_id,
    releaseName: r.release_name,
    trackName: r.track_name,
    trackUrl: r.track_url,
    artistsName: r.artists_name,
    genre: r.genre,
    tags: r.tags,
    labelName: r.label_name,
    labelId: r.label_id,
    releaseId: r.release_id,
    trackCreatedDate: r.track_created_date,
    releaseCreatedDate: r.release_created_date,
    source,
    vecDist: vecDist != null ? Number(vecDist.toFixed(6)) : undefined,
  };
}

const WEB_OVERFETCH = 3;
const WEB_FETCH_CAP = 150;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const parsed = await parseZipdjPrompt(prompt);
    const queryVector = await embedTextToVectorLiteral(parsed.embedding_narrative);
    const cap = parsed.requested_count;
    const poolSize = Math.min(Math.max(cap * 4, cap), 200);

    let notice: string | undefined;
    /** Legacy field: always null (Tavily removed). */
    const tavilyResponse: null = null;
    let webExtractedCandidates: { title: string; artist: string | null }[] | null = null;
    let aiSdkWeb: {
      output: { tracks: { title: string; artist: string | null }[]; rationale: string };
      sources: unknown;
      text: string;
      stepCount: number;
    } | null = null;

    const vectorHits = await vectorSearchZipdj(queryVector, poolSize);

    if (parsed.mode === 'semantic_only') {
      const sliced = vectorHits.slice(0, cap);
      return NextResponse.json({
        parsed,
        tracks: sliced.map((r) => serializeTrack(r, 'vector', r.vec_dist)),
        message:
          sliced.length === 0
            ? 'No rows in zipdj_tracks_ai. Ingest a CSV first.'
            : undefined,
        tavilyResponse,
        webExtractedCandidates: null,
        aiSdkWeb: null,
      });
    }

    let webPairs: { row: ZipdjRow; vecDist: number }[] = [];

    try {
      const q = parsed.web_query?.trim();
      if (!q) {
        notice = 'No web query from router; using catalog similarity only.';
      } else {
        const webFetchCount = Math.min(cap * WEB_OVERFETCH, WEB_FETCH_CAP);
        const temporalContext = computeTemporalContext(prompt);
        const ai = await runZipdjWebSearchWithAiSdk({
          originalPrompt: prompt,
          webQuery: q,
          maxTracks: webFetchCount,
          temporalContext,
        });
        aiSdkWeb = {
          output: ai.output,
          sources: ai.sources,
          text: ai.text,
          stepCount: ai.stepCount,
        };
        webExtractedCandidates = ai.output.tracks.map((t) => ({
          title: t.title,
          artist: t.artist,
        }));

        const titles = ai.output.tracks;
        if (titles.length > 0) {
          webPairs = await matchWebTrackTitlesToZipdjCatalog(
            titles.map((t) => ({ title: t.title, artist: t.artist })),
            cap
          );
        }
      }
    } catch (e) {
      console.error('[zipdj/prompt] AI SDK web pipeline:', e);
      notice =
        e instanceof Error
          ? `Web search (OpenAI Responses + AI SDK) failed: ${e.message}. Showing catalog matches only.`
          : 'Web search failed; showing catalog matches only.';
    }

    const merged: ReturnType<typeof serializeTrack>[] = [];
    const seen = new Set<string>();

    for (const { row: r, vecDist } of webPairs) {
      if (merged.length >= cap) break;
      if (seen.has(r.track_id)) continue;
      seen.add(r.track_id);
      merged.push(serializeTrack(r, 'web', vecDist));
    }

    for (const r of vectorHits) {
      if (merged.length >= cap) break;
      if (seen.has(r.track_id)) continue;
      seen.add(r.track_id);
      merged.push(serializeTrack(r, 'vector', r.vec_dist));
    }

    return NextResponse.json({
      parsed,
      tracks: merged,
      message: notice,
      tavilyResponse,
      webExtractedCandidates,
      aiSdkWeb,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'ZipDJ prompt failed';
    console.error('[zipdj/prompt]', e);
    if (msg.includes('OPENAI_API_KEY')) {
      return NextResponse.json({ error: msg }, { status: 501 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
