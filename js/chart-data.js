/* ============================================================
   CSVette — chart-data.js
   Pure chart-data preparation: turns the working (or filtered)
   dataset into small, render-ready structures. No DOM here —
   views/chart-render.js draws, this module decides WHAT to draw.

   Every function returns the data plus honest metadata (missing
   counts, skipped rows, omitted categories) so the UI never has
   to guess — and never fabricates results.
   ============================================================ */

import { parseNumber, mean, median, percentile } from "./statistics.js";
import { isMissing, parseDate } from "./data-profile.js";

/* ---------- Numeric helpers ---------- */

/**
 * Parse the usable numeric values of one column, keeping their row
 * numbers so charts can stay connected to the Data Table.
 * Missing tokens and non-numeric strings are skipped and counted.
 */
export function numericValues(rows, columnId) {
  const values = [];
  let skipped = 0;
  for (const row of rows) {
    const raw = row[columnId] ?? "";
    if (isMissing(raw)) { skipped++; continue; }
    const n = parseNumber(raw);
    if (n === null) { skipped++; continue; }
    values.push({ value: n, rowNum: row.__rowNum });
  }
  return { values, skipped };
}

/**
 * Freedman–Diaconis bin width with documented fallbacks.
 *   h = 2 · IQR · n^(−1/3)  →  binCount = round(range / h), clamped 5–30.
 * Falls back to Sturges (ceil(log2 n) + 1) when the IQR is 0 —
 * FD degenerates for constant-ish data. Clamps keep tiny datasets
 * readable and huge ones cheap.
 */
export function binCountFor(values) {
  const n = values.length;
  if (n < 2) return 1;
  const iqr = percentile(values, 0.75) - percentile(values, 0.25);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return 1;

  let bins;
  if (iqr > 0) {
    const h = 2 * iqr * Math.cbrt(n);
    bins = Math.round(range / h);
  } else {
    bins = Math.ceil(Math.log2(n)) + 1; // Sturges fallback
  }
  return Math.min(30, Math.max(5, bins));
}

/**
 * Histogram with FD binning. Bins are half-open [x0, x1) except the
 * last, which is closed [x0, x1] so the maximum value is counted.
 */
export function computeHistogram(rows, columnId) {
  const { values, skipped } = numericValues(rows, columnId);
  const nums = values.map((v) => v.value);
  if (nums.length === 0) {
    return { usable: false, reason: "No usable numeric values in this column.", bins: [], skipped, total: rows.length };
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const binCount = binCountFor(nums);
  const width = (max - min) / binCount || 1;

  const bins = Array.from({ length: binCount }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }));
  for (const n of nums) {
    let idx = Math.floor((n - min) / width);
    if (idx >= binCount) idx = binCount - 1; // max value lands in the last bin
    bins[idx].count += 1;
  }

  return { usable: true, bins, skipped, total: rows.length, min, max, binCount };
}

/**
 * Box-plot statistics. Definitions match the Data Quality engine
 * exactly: quartiles via percentile(), fences at 1.5 × IQR.
 * Points outside the fences are *potential* outliers — never errors.
 */
export function computeBoxStats(rows, columnId) {
  const { values, skipped } = numericValues(rows, columnId);
  const nums = values.map((v) => v.value).sort((a, b) => a - b);
  if (nums.length < 4) {
    return { usable: false, reason: "A box plot needs at least 4 usable numeric values.", skipped, total: rows.length };
  }

  const q1 = percentile(nums, 0.25);
  const q3 = percentile(nums, 0.75);
  const iqr = q3 - q1;
  const fenceLow = q1 - 1.5 * iqr;
  const fenceHigh = q3 + 1.5 * iqr;

  const inside = nums.filter((n) => n >= fenceLow && n <= fenceHigh);
  const outliers = values
    .filter((v) => v.value < fenceLow || v.value > fenceHigh)
    .map((v) => ({ value: v.value, rowNum: v.rowNum }));

  return {
    usable: true,
    min: nums[0],
    q1,
    median: median(nums),
    q3,
    max: nums[nums.length - 1],
    iqr,
    whiskerLow: inside.length > 0 ? inside[0] : q1,
    whiskerHigh: inside.length > 0 ? inside[inside.length - 1] : q3,
    outliers,
    n: nums.length,
    skipped,
    total: rows.length,
  };
}

/* ---------- Categorical ---------- */

/**
 * Category frequency counts, sorted by count then label. Applies a
 * top-N limit for high-cardinality columns — the result records what
 * was omitted so the UI can say "Top 12 of 37 categories" instead of
 * silently hiding data.
 */
export function computeCategoryCounts(rows, columnId, { topN = 12 } = {}) {
  const counts = new Map();
  let total = 0;
  for (const row of rows) {
    const raw = String(row[columnId] ?? "").trim();
    if (isMissing(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
    total++;
  }
  if (total === 0) {
    return { usable: false, reason: "This column has no non-empty values to chart.", categories: [], totalCategories: 0, total: rows.length };
  }

  const sorted = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const categories = sorted.slice(0, topN);
  return {
    usable: true,
    categories,
    totalCategories: sorted.length,
    omitted: sorted.length - categories.length,
    omittedCount: sorted.slice(topN).reduce((s, c) => s + c.count, 0),
    total: rows.length,
  };
}

/** Aggregations available for a numeric value column. */
export const AGGREGATIONS = ["mean", "median", "sum", "min", "max", "count"];

/**
 * Per-category aggregate of a numeric column.
 * `count` ignores the value column (category frequency per group).
 * Rows with a missing group or (for non-count aggs) unusable numeric
 * value are skipped and counted — never silently averaged in.
 */
export function computeAggregates(rows, groupId, valueId, agg = "mean") {
  if (!AGGREGATIONS.includes(agg)) {
    return { usable: false, reason: `Unknown aggregation "${agg}".` };
  }
  if (agg !== "count" && !valueId) {
    return { usable: false, reason: "Choose a numeric column to aggregate." };
  }

  const groups = new Map(); // value → { rows: n, nums: [values] }
  let skipped = 0;
  for (const row of rows) {
    const g = String(row[groupId] ?? "").trim();
    if (isMissing(g)) { skipped++; continue; }
    if (!groups.has(g)) groups.set(g, { rows: 0, nums: [] });
    const group = groups.get(g);
    group.rows += 1;
    if (agg !== "count") {
      const raw = row[valueId] ?? "";
      const n = isMissing(raw) ? null : parseNumber(raw);
      if (n === null) { skipped++; continue; }
      group.nums.push(n);
    }
  }
  if (groups.size === 0) {
    return { usable: false, reason: "No non-empty categories to chart.", skipped, total: rows.length };
  }

  const out = [...groups.entries()]
    .filter(([, g]) => agg === "count" || g.nums.length > 0) // a group with no usable values would chart as a fake 0
    .map(([value, g]) => {
      let stat = 0;
      if (agg === "count") {
        stat = g.rows; // number of rows in this category
      } else if (g.nums.length > 0) {
        switch (agg) {
          case "sum": stat = g.nums.reduce((s, n) => s + n, 0); break;
          case "min": stat = Math.min(...g.nums); break;
          case "max": stat = Math.max(...g.nums); break;
          case "mean": stat = mean(g.nums); break;
          case "median": stat = median(g.nums); break;
        }
      }
      return { value, stat, n: agg === "count" ? g.rows : g.nums.length };
    })
    .sort((a, b) => b.stat - a.stat || a.value.localeCompare(b.value));

  const topN = 12;
  const categories2 = out.slice(0, topN);
  return {
    usable: true,
    categories: categories2,
    agg,
    totalCategories: out.length,
    omitted: out.length - categories2.length,
    skipped,
    total: rows.length,
  };
}

/* ---------- Two-variable series ---------- */

/**
 * Scatter pairs: one point per row where BOTH columns are usable
 * numbers. Rows with a missing/invalid member of the pair are skipped
 * (and counted) — plotting a fake value would mislead.
 */
export function computeScatter(rows, xId, yId) {
  const points = [];
  let skipped = 0;
  for (const row of rows) {
    const rx = row[xId] ?? "";
    const ry = row[yId] ?? "";
    const x = isMissing(rx) ? null : parseNumber(rx);
    const y = isMissing(ry) ? null : parseNumber(ry);
    if (x === null || y === null) { skipped++; continue; }
    points.push({ x, y, rowNum: row.__rowNum });
  }
  if (points.length < 2) {
    return { usable: false, reason: "A scatter plot needs at least 2 rows with usable values in both columns.", points, skipped, total: rows.length };
  }
  return { usable: true, points, skipped, total: rows.length };
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Line series over a real date column. Rows sharing a date aggregate
 * into one point (mean/median/sum/…) — duplicate dates are combined,
 * never spliced. Points are sorted chronologically; missing dates are
 * simply absent (the line connects existing observations only).
 */
export function computeLine(rows, dateId, valueId, agg = "mean") {
  const byDay = new Map();
  let skipped = 0;
  for (const row of rows) {
    const d = parseDate(row[dateId] ?? "");
    if (!d) { skipped++; continue; }
    const key = d.getTime();
    if (!byDay.has(key)) byDay.set(key, []);
    const raw = row[valueId] ?? "";
    const n = isMissing(raw) ? null : parseNumber(raw);
    if (n === null) { skipped++; continue; }
    byDay.get(key).push(n);
  }
  if (byDay.size < 2) {
    return { usable: false, reason: "A line chart needs at least 2 distinct dates with usable values.", points: [], skipped, total: rows.length };
  }

  const points = [...byDay.entries()]
    .map(([t, nums]) => ({
      t,
      label: DATE_FMT.format(new Date(t)),
      value: agg === "sum" ? nums.reduce((s, n) => s + n, 0)
        : agg === "median" ? median(nums)
        : mean(nums),
      n: nums.length,
    }))
    .sort((a, b) => a.t - b.t);

  return { usable: true, points, agg, skipped, total: rows.length };
}

/* ---------- Correlations ---------- */

/**
 * Pearson correlation coefficient over paired values.
 * Returns null when it cannot be computed reliably (n < 3, or zero
 * variance in either variable) — callers must not display a number.
 */
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3 || n !== ys.length) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  const r = num / Math.sqrt(dx * dy);
  return Math.max(-1, Math.min(1, r));
}

/**
 * Correlation matrix over all numeric columns (integer/float) with
 * enough usable data. `matrix[i][j]` is { r, n } or { r: null, n }.
 * The diagonal is 1 by definition; perfect-constant columns report
 * r: null (insufficient variation) instead of a fake 0.
 */
export function computeCorrelations(rows, profile) {
  const numericCols = Object.values(profile.byColumn)
    .filter((c) => c.type === "integer" || c.type === "float")
    .map((c) => ({ id: c.columnId, name: c.name }));

  // Per-column value map keyed by original row number. Pairing MUST go
  // through row numbers: skipping missing cells per-column independently
  // would misalign the arrays and produce wrong coefficients.
  const series = numericCols.map((c) => {
    const { values } = numericValues(rows, c.id);
    const byRow = new Map(values.map((v) => [v.rowNum, v.value]));
    return { id: c.id, name: c.name, byRow };
  });

  const matrix = series.map((a) =>
    series.map((b) => {
      if (a === b) return { r: 1, n: a.byRow.size };
      const xs = [], ys = [];
      for (const [rowNum, x] of a.byRow) {
        const y = b.byRow.get(rowNum);
        if (y !== undefined) { xs.push(x); ys.push(y); }
      }
      const r = pearson(xs, ys);
      return { r, n: xs.length };
    }),
  );

  const computable = matrix.some((row, i) => row.some((cell, j) => i !== j && cell.r !== null));
  return {
    columns: series.map((s) => ({ id: s.id, name: s.name })),
    matrix,
    computable,
    reason: computable ? null : "Correlations need at least two numeric columns with variation.",
  };
}
/* ---------- Chart-config validation (§7) ---------- */

/**
 * Validate a chart configuration against the profile BEFORE rendering.
 * Returns an error string or null. This is the gate that makes invalid
 * combinations produce an explanation instead of a broken chart.
 */
export function chartConfigError(config, profile) {
  const has = (id) => id && profile.byColumn[id];
  const typeOf = (id) => profile.byColumn[id]?.type;

  switch (config.type) {
    case "histogram":
      if (!has(config.xId)) return "Choose a column for the histogram.";
      if (!["integer", "float"].includes(typeOf(config.xId))) {
        return "A histogram requires a numeric column with usable values. This column looks like " + typeOf(config.xId) + ".";
      }
      return null;

    case "box":
      if (!has(config.xId)) return "Choose a column for the box plot.";
      if (!["integer", "float"].includes(typeOf(config.xId))) {
        return "A box plot requires a numeric column. This column looks like " + typeOf(config.xId) + ".";
      }
      return null;

    case "bar":
      if (!has(config.xId)) return "Choose a categorical column for the bar chart.";
      return null;

    case "agg-bar":
      if (!has(config.xId)) return "Choose a categorical column to group by.";
      if (!has(config.yId)) return "Choose a numeric column to aggregate.";
      if (!["integer", "float"].includes(typeOf(config.yId))) {
        return "The aggregated column must be numeric — averaging or summing text is meaningless.";
      }
      if (!AGGREGATIONS.includes(config.agg)) return "Choose an aggregation (mean, median, sum…).";
      return null;

    case "scatter":
      if (!has(config.xId) || !has(config.yId)) return "Choose two numeric columns for the scatter plot.";
      if (![config.xId, config.yId].every((id) => ["integer", "float"].includes(typeOf(id)))) {
        return "Both scatter axes must be numeric columns.";
      }
      if (config.xId === config.yId) return "Choose two different columns — a column against itself is always a perfect line.";
      return null;

    case "line":
      if (!has(config.xId)) return "Choose a date column for the line chart.";
      if (typeOf(config.xId) !== "date") return "The line chart needs a real date column — connecting arbitrary labels would pretend they are points in time.";
      if (!has(config.yId)) return "Choose a numeric column to plot over time.";
      if (!["integer", "float"].includes(typeOf(config.yId))) return "The line's value column must be numeric.";
      return null;

    default:
      return "Unknown chart type.";
  }
}
