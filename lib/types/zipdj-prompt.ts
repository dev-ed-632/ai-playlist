export type ZipdjPromptMode = 'semantic_only' | 'web_then_match';

export interface ZipdjParsedPrompt {
  mode: ZipdjPromptMode;
  embedding_narrative: string;
  web_query: string | null;
  requested_count: number;
}
