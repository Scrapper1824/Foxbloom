function parts(v: string): number[] {
  return v.replace(/^v/i, '').split(/[.\-+]/).slice(0, 3).map(function (x) { return parseInt(x, 10) || 0; });
}

/** True when version `a` is newer than `b` ("0.9.0" > "0.8.5"). Only the first three numbers count. */
export function isNewer(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
