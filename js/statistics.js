/* ============================================================
   CSVette — statistics.js
   Small, pure numeric helpers used by profiling and views.
   Missing/invalid values are filtered by the caller unless noted.
   ============================================================ */

/** Parse a string to a finite number, or null. No coercion surprises. */
export function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Sum of an array of finite numbers. */
export function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Arithmetic mean of non-empty array; null for empty input. */
export function mean(values) {
  if (values.length === 0) return null;
  return sum(values) / values.length;
}

/** Median (average of the two middle values when even-length). */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sample standard deviation (n − 1); null when fewer than 2 values. */
export function stdDev(values) {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (n - 1));
}

/** p must be in [0, 1]. Linear-interpolation percentile (as in numpy's default). */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/** Count distinct values (primitives). */
export function countUnique(values) {
  return new Set(values).size;
}

/** Mode: most frequent value. Ties → the first to reach the top count. */
export function mode(values) {
  if (values.length === 0) return null;
  const counts = new Map();
  let bestValue = values[0];
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      bestValue = v;
    }
  }
  return { value: bestValue, count: bestCount };
}

/** Frequency table, sorted by count desc. Used for categorical summaries. */
export function frequencies(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}
