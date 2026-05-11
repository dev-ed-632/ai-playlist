import OpenAI from 'openai';
import { openAiTemperatureOptions } from '@/lib/llm/openaiTemperature';

const MODEL = process.env.OPENAI_PROMPT_MODEL || 'gpt-4o-mini';

export interface WebTrackCandidate {
  title: string;
  artist: string | null;
}

const SYSTEM = `You extract song/release titles and primary artist names from web search snippets about music charts, playlists, or trending tracks.

Rules:
- title should be the song or release name as commonly listed (not remix/mix version unless that is the main listing).
- artist: main credited artist; use null only if truly unknown.
- Return at most 25 candidates in discovery order (most relevant first).
- JSON only.`;

export async function extractZipdjWebCandidates(searchBlob: string): Promise<WebTrackCandidate[]> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const openai = new OpenAI({ apiKey: key });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    ...openAiTemperatureOptions(0.2),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Search results:\n"""${searchBlob.slice(0, 12000)}"""\n\nReturn JSON: {"candidates":[{"title":"string","artist":"string or null"}]}`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) return [];

  const raw = JSON.parse(text) as { candidates?: unknown };
  const list = raw.candidates;
  if (!Array.isArray(list)) return [];

  const out: WebTrackCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) continue;
    const artist =
      typeof o.artist === 'string' && o.artist.trim() ? o.artist.trim() : null;
    out.push({ title, artist });
    if (out.length >= 25) break;
  }
  return out;
}
