import OpenAI from 'openai';
import { normalizeParsedFilters, type DjParsedFilters } from '@/lib/llm/dj-filters';
import { openAiTemperatureOptions } from '@/lib/llm/openaiTemperature';

const MODEL = process.env.OPENAI_PROMPT_MODEL || 'gpt-4o-mini';

const SYSTEM = `You are a DJ music librarian assistant. The user describes a gig or playlist need in natural language.
Extract structured filters for searching a catalog of tracks that have BPM, genre, mood features, embeddings, optional label and musical key.

Rules:
- embedding_narrative: 3–6 sentences rich in musical vocabulary, vibe, era, and context — this text will be embedded for semantic search. Include genres, energy, BPM intent, audience, and "clean/radio-friendly" if mentioned.
- genres: short lowercase tokens (e.g. pop, r&b, disco).
- bpm_min / bpm_max: integers or null if not specified.
- energy_low / energy_high: decimals 0–1 (chill → peak). "Medium to high" might be 0.45–0.82.
- require_clean: true only if user explicitly wants clean/radio-friendly/no explicit content.
- prefer_danceable: true if they want dance floor / party energy.
- suggested_artists_include / exclude: notable names only if user mentions them.
- suggested_labels / musical_keys: only if user mentions labels or keys; else [].
- requested_track_count: integer; if user asks for e.g. 60, still return the number they asked for (server clamps 30–50).
- mood_tags: short tags like happy, romantic, nostalgic.

Respond with JSON only, no markdown.`;

export async function parseDjPrompt(userPrompt: string): Promise<DjParsedFilters> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const openai = new OpenAI({ apiKey: key });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    ...openAiTemperatureOptions(0.3),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `User request:\n"""${userPrompt.slice(0, 12000)}"""\n\nReturn JSON with keys:
event_summary (string),
genres (string[]),
bpm_min (number|null),
bpm_max (number|null),
energy_low (number),
energy_high (number),
prefer_danceable (boolean),
mood_tags (string[]),
require_clean (boolean),
suggested_artists_include (string[]),
suggested_artists_exclude (string[]),
suggested_labels (string[]),
musical_keys (string[]),
embedding_narrative (string),
requested_track_count (number)`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error('Empty LLM response');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('LLM returned invalid JSON');
  }

  return normalizeParsedFilters(parsed as Partial<DjParsedFilters>);
}
