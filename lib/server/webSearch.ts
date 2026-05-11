export interface WebSearchSnippet {
  title: string;
  url: string;
  content: string;
}

export interface WebSearchResult {
  query: string;
  snippets: WebSearchSnippet[];
  /** Full JSON body from Tavily (for debugging / UI transparency). */
  rawResponse: unknown;
}

/**
 * Tavily search API — set TAVILY_API_KEY in .env
 * https://docs.tavily.com/documentation/api-reference/endpoint/search
 */
export async function tavilySearch(query: string): Promise<WebSearchResult> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not configured');
  }

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      max_results: 12,
      include_answer: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Tavily search failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
    [key: string]: unknown;
  };

  const results = data.results ?? [];
  const snippets: WebSearchSnippet[] = results.map((r) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    content: String(r.content ?? ''),
  }));

  return { query, snippets, rawResponse: data };
}

export function snippetsToBlob(r: WebSearchResult): string {
  return r.snippets
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.content}`)
    .join('\n\n')
    .slice(0, 14000);
}
