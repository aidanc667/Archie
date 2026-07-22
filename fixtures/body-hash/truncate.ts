// fixtures/body-hash/truncate.ts
export function truncateForDisplay(text: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    throw new Error(`maxLength must be a positive number, got ${maxLength}`);
  }
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
