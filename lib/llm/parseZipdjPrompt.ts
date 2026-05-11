import OpenAI from 'openai';
import type { ZipdjParsedPrompt, ZipdjPromptMode } from '@/lib/types/zipdj-prompt';
import { openAiTemperatureOptions } from '@/lib/llm/openaiTemperature';

const MODEL = process.env.OPENAI_PROMPT_MODEL || 'gpt-4o-mini';

export type { ZipdjParsedPrompt, ZipdjPromptMode };

const SYSTEM = `You are routing music discovery requests for a DJ catalog (ZipDJ metadata only: release titles, mix names, genres, tags).

Decide the mode:
- semantic_only: User describes vibe, mood, genre mix, BPM intent, party context, era — searchable with text embeddings over catalog metadata. No need for live charts or "what is trending now on Spotify/Billboard".
- web_then_match: User explicitly wants current trends, Spotify/top charts, \"best X of 2024\", Billboard-style lists, or other facts that require up-to-date web search. You must also craft web_query: a concise English web search query (no quotes needed) that would return song titles and artists.

Always produce embedding_narrative: 3–6 sentences rich in musical vocabulary, genres, energy, audience, occasion — this text will be embedded for cosine search against the catalog.

requested_count: integer number of tracks the user wants; if unspecified use 15.

Respond with JSON only, no markdown.`;

function clampCount(n: unknown): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 15;
  return Math.max(1, Math.min(50, x));
}

export async function parseZipdjPrompt(userPrompt: string): Promise<ZipdjParsedPrompt> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const openai = new OpenAI({ apiKey: key });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    ...openAiTemperatureOptions(0.25),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `User request:\n"""${userPrompt.slice(0, 12000)}"""\n\nReturn JSON with keys:
mode ("semantic_only" | "web_then_match"),
embedding_narrative (string),
web_query (string or null — required non-null only when mode is web_then_match),
requested_count (number)`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error('Empty LLM response');
  }

  const raw = JSON.parse(text) as Record<string, unknown>;
  let mode: ZipdjPromptMode =
    raw.mode === 'web_then_match' ? 'web_then_match' : 'semantic_only';

  const embedding_narrative =
    typeof raw.embedding_narrative === 'string' ? raw.embedding_narrative.trim() : '';
  if (!embedding_narrative) {
    throw new Error('Invalid router response: embedding_narrative required');
  }

  let web_query: string | null =
    typeof raw.web_query === 'string' && raw.web_query.trim()
      ? raw.web_query.trim()
      : null;

  if (mode === 'web_then_match' && !web_query) {
    web_query = embedding_narrative.slice(0, 240);
  }

  if (mode === 'semantic_only') {
    web_query = null;
  }

  return {
    mode,
    embedding_narrative,
    web_query,
    requested_count: clampCount(raw.requested_count),
  };
}
