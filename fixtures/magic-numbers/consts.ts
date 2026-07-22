// fixtures/magic-numbers/consts.ts
const MAX_RETRIES = 5;
const MIN_TEMP = -40;

export function checkThreshold(x: number): boolean {
  if (x > 42) {
    return true;
  }
  return false;
}

export function checkLowerBound(x: number): boolean {
  return x < -273;
}

interface RunOutput {
  version: 6;
}

export function allowlistedValues(x: number): number {
  if (x === 0) return 0;
  if (x === 1) return 1;
  return -1;
}

export function scheduleThing(fn: () => void): void {
  setTimeout(fn, 3000);
}

function localScope(): number {
  const LOCAL_NOT_MODULE_LEVEL = 99;
  return LOCAL_NOT_MODULE_LEVEL;
}
