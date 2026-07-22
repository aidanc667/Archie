// fixtures/body-hash/uses-array-isarray.ts
export function guardArray(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return true;
}
