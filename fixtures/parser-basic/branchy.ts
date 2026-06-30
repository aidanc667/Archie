export function branchy(x: number): number {
  if (x > 0) {
    return 1;
  } else if (x < 0) {
    return -1;
  }
  for (let i = 0; i < x; i++) {
    if (i === 5) continue;
  }
  return 0;
}
