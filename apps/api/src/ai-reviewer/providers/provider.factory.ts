import { AIReviewerProvider } from '../interfaces/ai-reviewer-provider.interface.js';

export function resolveAiProvider(
  raw: string | undefined,
  gemini: AIReviewerProvider,
  ollama: AIReviewerProvider,
  logger?: { warn(msg: string): void },
): AIReviewerProvider {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'ollama') return ollama;
  if (value === 'gemini' || value === '') return gemini;
  try { logger?.warn(`Unrecognized AI_PROVIDER "${raw}"; defaulting to gemini.`); }
  catch { /* never fail selection on a logging error */ }
  return gemini;
}
