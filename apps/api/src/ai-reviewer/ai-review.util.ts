/**
 * Pure helpers for the batched AI review pipeline.
 *
 * The AI review used to send every file in one giant prompt — the single
 * largest contributor to scan latency (~79% of total). These helpers split the
 * files into directory-grouped batches that are reviewed concurrently and then
 * merged back into one result, turning one long serial call into several short
 * parallel ones. Everything here is deterministic and side-effect free so it can
 * be unit/property tested without a live model.
 */
import type { AIReviewResult } from "@slopshield/shared";

export interface ReviewFile {
  path: string;
  content: string;
  language: string;
  isFrontend: boolean;
  isBackend: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A provider review result, optionally annotated with token usage. */
export type ProviderReviewResult = AIReviewResult & { usage?: TokenUsage };

/**
 * Return the grouping key for a file: its immediate parent directory. Files in
 * the same directory tend to be related, so co-reviewing them gives the model
 * useful local context while keeping each prompt small.
 */
export function dirKey(filePath: string): string {
  const norm = filePath.replaceAll("\\", "/");
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "." : norm.slice(0, idx);
}

/**
 * Split files into batches. Files are grouped by directory first (related files
 * stay together), then each group is chunked to at most `batchSize` files so no
 * single prompt grows unbounded. Order is preserved and deterministic.
 *
 * `batchSize <= 0` is treated as 1 to avoid empty/infinite batches.
 */
export function batchFilesByDirectory<T extends { path: string }>(
  files: T[],
  batchSize: number,
): T[][] {
  const size = batchSize > 0 ? batchSize : 1;
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const key = dirKey(file.path);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(file);
    } else {
      groups.set(key, [file]);
    }
  }

  const batches: T[][] = [];
  for (const bucket of groups.values()) {
    for (let i = 0; i < bucket.length; i += size) {
      batches.push(bucket.slice(i, i + size));
    }
  }
  return batches;
}

/** Order-preserving de-duplication of a string list (trims + drops blanks). */
export function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = (raw ?? "").trim();
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Merge the per-batch review results into a single canonical result.
 *  - findings: concatenated (each is already location-scoped, so no dedupe)
 *  - recommended_tests / refactor_plan: concatenated then de-duplicated
 *  - summary: the non-empty batch summaries joined; batches that actually found
 *    issues lead so the overall summary reflects real findings first.
 */
export function mergeAIReviewResults(results: AIReviewResult[]): AIReviewResult {
  const findings = results.flatMap((r) => r.findings ?? []);
  const recommended_tests = dedupeStrings(
    results.flatMap((r) => r.recommended_tests ?? []),
  );
  const refactor_plan = dedupeStrings(
    results.flatMap((r) => r.refactor_plan ?? []),
  );

  const withFindings = results.filter((r) => (r.findings ?? []).length > 0);
  const ordered = [...withFindings, ...results.filter((r) => !withFindings.includes(r))];
  const summaries = dedupeStrings(ordered.map((r) => r.summary ?? ""));
  const summary = summaries.length > 0 ? summaries.join(" ") : "No issues identified.";

  return { summary, findings, recommended_tests, refactor_plan };
}

/** Sum token usage across batch results (missing usage counts as zero). */
export function sumTokenUsage(usages: (TokenUsage | undefined)[]): TokenUsage {
  return usages.reduce<TokenUsage>(
    (acc, u) => ({
      inputTokens: acc.inputTokens + (u?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (u?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}

/** The empty review used when a batch times out or fails. */
export function emptyReviewResult(): ProviderReviewResult {
  return { summary: "", findings: [], recommended_tests: [], refactor_plan: [] };
}

/**
 * Race a promise against a timeout. On timeout, resolves to `onTimeout()` rather
 * than rejecting, so a single slow batch cannot stall the whole review. The
 * timer is always cleared.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Run `fn` over `items` with a bounded number of concurrent executions. Preserves
 * input order in the returned array. Used to cap how many AI batches hit the
 * provider at once (avoids rate limits while still parallelising).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const max = limit > 0 ? limit : 1;
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(max, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}
