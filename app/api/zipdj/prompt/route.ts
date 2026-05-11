import { NextResponse } from 'next/server';
import { embedTextToVectorLiteral } from '@/lib/server/embedder';
import { parseZipdjPrompt } from '@/lib/llm/parseZipdjPrompt';
import { tavilySearch, snippetsToBlob } from '@/lib/server/webSearch';
import { extractZipdjWebCandidates } from '@/lib/llm/extractZipdjWebCandidates';
import {
  matchZipdjByCandidate,
  vectorSearchZipdj,
  type ZipdjRow,
} from '@/lib/server/matchZipdjCatalog';

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
    let tavilyResponse: unknown | null = null;
    /** Title/artist pairs OpenAI inferred from Tavily snippet text (before DB matching). */
    let webExtractedCandidates: { title: string; artist: string | null }[] | null = null;

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
        tavilyResponse: null,
        webExtractedCandidates: null,
      });
    }

    const webMatched: ZipdjRow[] = [];
    const usedIds = new Set<string>();

    try {
      const q = parsed.web_query?.trim();
      if (!q) {
        notice = 'No web query from router; using catalog similarity only.';
      } else {
        const web = await tavilySearch(q);
        tavilyResponse = web.rawResponse;
        const blob = snippetsToBlob(web);
        const candidates = await extractZipdjWebCandidates(blob);
        webExtractedCandidates = candidates.map((c) => ({
          title: c.title,
          artist: c.artist,
        }));

        for (const c of candidates) {
          const rows = await matchZipdjByCandidate(c);
          for (const r of rows) {
            if (usedIds.has(r.track_id)) continue;
            usedIds.add(r.track_id);
            webMatched.push(r);
            if (webMatched.length >= cap) break;
          }
          if (webMatched.length >= cap) break;
        }
      }
    } catch (e) {
      console.error('[zipdj/prompt] web pipeline:', e);
      notice =
        e instanceof Error && e.message.includes('TAVILY_API_KEY')
          ? 'Web search is not configured (TAVILY_API_KEY). Showing catalog matches only.'
          : 'Web search failed; showing catalog matches only.';
    }

    const merged: ReturnType<typeof serializeTrack>[] = [];
    const seen = new Set<string>();

    for (const r of webMatched) {
      if (merged.length >= cap) break;
      if (seen.has(r.track_id)) continue;
      seen.add(r.track_id);
      merged.push(serializeTrack(r, 'web'));
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
