// fixtures/body-hash/different-control-flow.ts
// Same rough purpose as truncateForDisplay/shortenTitle (clamp a string to a
// max length) but with genuinely different control flow -- a for loop
// building a result char-by-char instead of an early-return + slice -- to
// confirm the normalization doesn't collapse everything into one hash.
export function clampWithLoop(value: string, cap: number): string {
  let result = "";
  for (let i = 0; i < value.length && i < cap; i++) {
    result += value[i];
  }
  return result;
}
