// fixtures/body-hash/shorten.ts
export function shortenTitle(title: string, limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`limit must be a positive number, got ${limit}`);
  }
  if (title.length <= limit) return title;
  return title.slice(0, limit) + "...";
}
