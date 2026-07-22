// fixtures/body-hash/uses-number-isfinite.ts
export function guardNumber(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  return true;
}
