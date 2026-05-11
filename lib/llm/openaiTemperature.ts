/**
 * Some OpenAI models (e.g. GPT-5 family, o-series) only accept the default sampler — passing
 * a custom `temperature` returns 400. Omit the field to use the API default.
 */
export function openAiTemperatureOptions(
  preferred: number
): { temperature: number } | Record<string, never> {
  if (process.env.OPENAI_OMIT_TEMPERATURE === '1') {
    return {};
  }
  const model = (process.env.OPENAI_PROMPT_MODEL || 'gpt-4o-mini').trim().toLowerCase();
  if (
    model.startsWith('gpt-5') ||
    model.startsWith('chatgpt-5') ||
    /^o\d/.test(model)
  ) {
    return {};
  }
  return { temperature: preferred };
}
