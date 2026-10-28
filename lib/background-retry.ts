export function backgroundErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause ? `: ${backgroundErrorMessage(error.cause)}` : "";
  return `${error.message}${cause}`;
}

export async function retryBackgroundDatabase<T>(operation: () => Promise<T>, options: {
  attempts?: number; wait?: (ms: number) => Promise<void>;
} = {}): Promise<T> {
  const attempts = options.attempts ?? 5;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt + 1 >= attempts || !/fetch failed|timeout|timed out|ECONNRESET|EAI_AGAIN|socket|other side closed|backendError|Internal error encountered|"code":\s*50[234]/i.test(backgroundErrorMessage(error))) throw error;
      await wait(Math.min(30_000, 2000 * 2 ** attempt));
    }
  }
}
