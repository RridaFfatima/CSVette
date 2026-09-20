/* ============================================================
   CSVette — insights.js
   Milestone 8: transparent, deterministic insights over data
   that has ALREADY been analyzed. This module computes almost
   nothing itself — it reads the profile (data-profile.js), the
   quality engine's findings/detail tables, and reuses
   computeCorrelations() from chart-data.js (the SAME Pearson
   implementation the Correlations screen uses — no second
   algorithm). It never touches the DOM, so it is unit-testable
   in Node; views decide how insight objects are rendered.

   LANGUAGE RULE (§3): descriptions use observational phrasing
   only — "associated with", "correlated with", "contains",
   "ranges", "accounts for". Causal verbs (causes, drives,
   predicts, proves) are never generated.

   PRECISION RULE (§18): correlations are shown to 2 decimals,
   percentages to whole numbers, statistics to at most 1 decimal.

   All thresholds are documented constants below.
   ============================================================ */

import { computeCorrelations } from "./chart-data.js";

/* ---------- Documented thresholds (§5, §6, §7, §9, §11) ---------- */

export const THRESHOLDS = {
  /** Report a column's missingness only above this share of its rows. */
  MISSING_SHARE: 0.10,
  /** …and never for fewer than this many affected cells (avoids "1 of 500" noise). */
  MISSING_MIN_CELLS: 3,
  /** At least this many exact duplicate rows before a duplicates insight appears. */
  DUPLICATES_MIN: 2,
  /** A category dominating its column at or above this share is "concentrated". */
  CONCENTRATION_SHARE: 0.70,
  /** Columns with more unique values than this are high-cardinality. */
  HIGH_CARDINALITY: 50,
  /** |r| at or above this is a "strong" association (§9). */
  CORRELATION_STRONG: 0.7,
  /** |r| at or above this (below strong) is a "moderate" association. */
  CORRELATION_MODERATE: 0.5,
  /** Minimum paired observations before any correlation is mentioned. */
  CORRELATION_MIN_N: 10,
  /** A column with at least this many potential outliers is flagged. */
  OUTLIER_MIN_COUNT: 2,
  /** …or this share of usable values (whichever is met first). */
  OUTLIER_MIN_SHARE: 0.05,
  /** mean − median at least this many stdDevs apart suggests asymmetry. */
  ASYMMETRY_STDDEV: 0.5,
  /** Coefficient of variation at or above this is "high variability". */
  CV_HIGH: 1.0,
  /** How many insights the Overview shows at most (§4). */
  MAX_INSIGHTS: 6,
};

/* ---------- small helpers ---------- */

const round1 = (n) => Math.round(n * 10) / 10;
const pct0 = (n) => `${Math.round(n * 100)}%`;

/** Metadata for each insight type — route used by the "view →" links (§14). */
const SOURCE = {
  missingness: { label: "Missing-value analysis", route: "missing" },
  duplicates: { label: "Duplicate-row analysis", route: "duplicates" },
  concentration: { label: "Category distribution", route: "table" },
  cardinality: { label: "Column profile", route: "stats" },
  distribution: { label: "Numeric statistics", route: "stats" },
  outliers: { label: "IQR outlier analysis", route: "outliers" },
  correlation: { label: "Correlation analysis", route: "correlations" },
  quality: { label: "Data-quality engine", route: "health" },
};

/**
 * Build one insight object (§25 shape).
 * Private — views receive finished objects only.
 */
function insight(type, severity, title, description, metadata = {}) {
  return {
    type,
    severity, // "info" | "warning" | "critical" — same vocabulary as the quality engine (§12)
    title,
    description,
    source: SOURCE[type]?.label ?? type,
    route: SOURCE[type]?.route ?? "stats",
    metadata,
  };
}

/* ---------- insight generators ---------- */

function missingnessInsights(profile) {
  const out = [];
  for (const col of Object.values(profile.byColumn)) {
    const share = col.total > 0 ? col.missing / col.total : 0;
    if (col.missing >= THRESHOLDS.MISSING_MIN_CELLS && share >= THRESHOLDS.MISSING_SHARE) {
      out.push(insight(
        "missingness",
        share > 0.25 ? "warning" : "info",
        `${col.name} has missing values`,
        `${col.name} is missing in ${pct0(share)} of rows (${col.missing} of ${col.total}).`,
        { columnId: col.columnId, missing: col.missing, total: col.total, share: round1(share * 100) / 100 },
      ));
    }
  }
  return out;
}

function duplicatesInsight(profile) {
  if ((profile.duplicateRows ?? 0) < THRESHOLDS.DUPLICATES_MIN) return [];
  return [insight(
    "duplicates",
    "warning",
    "Duplicate rows present",
    `${profile.duplicateRows} rows are exact duplicates of an earlier row — worth reviewing in the duplicates view.`,
    { count: profile.duplicateRows },
  )];
}

function concentrationInsights(profile) {
  const out = [];
  for (const col of Object.values(profile.byColumn)) {
    if (!["categorical", "string", "boolean"].includes(col.type)) continue;
    if (col.isConstant) continue;
    const present = col.total - col.missing;
    if (present <= 0 || !col.mode) continue;
    // Frequency of the modal value comes from the profile's own topValues.
    const top = (col.topValues ?? []).find((t) => t.value === col.mode);
    if (!top) continue;
    const share = top.count / present;
    if (share >= THRESHOLDS.CONCENTRATION_SHARE && col.unique > 1) {
      out.push(insight(
        "concentration",
        "info",
        `${col.name} is highly concentrated`,
        `${col.name} contains ${col.unique} distinct values, but "${col.mode}" accounts for ${pct0(share)} of non-missing rows.`,
        { columnId: col.columnId, mode: col.mode, share: round1(share * 100) / 100, unique: col.unique },
      ));
    }
    if (col.unique > THRESHOLDS.HIGH_CARDINALITY) {
      out.push(insight(
        "cardinality",
        "info",
        `${col.name} has high cardinality`,
        `${col.name} contains ${col.unique} distinct values across ${present} rows — few repeats, so it behaves like a label rather than a category.`,
        { columnId: col.columnId, unique: col.unique },
      ));
    }
  }
  return out;
}

function distributionInsights(profile) {
  const out = [];
  for (const col of Object.values(profile.byColumn)) {
    const s = col.stats;
    if (!s || s.count < 5) continue; // §19: no distribution claims on tiny samples

    // Range / spread summary for the most variable column is added by the
    // prioritizer; per-column we flag asymmetry and high variability.
    if (s.stdDev > 0) {
      const gap = Math.abs(s.mean - s.median) / s.stdDev;
      if (gap >= THRESHOLDS.ASYMMETRY_STDDEV) {
        const dir = s.mean > s.median ? "above" : "below";
        out.push(insight(
          "distribution",
          "info",
          `${col.name} is asymmetric`,
          `The mean of ${col.name} (${round1(s.mean)}) sits noticeably ${dir} the median (${round1(s.median)}) — a heuristic hint that the values lean to one side, worth a look at the histogram.`,
          { columnId: col.columnId, mean: round1(s.mean), median: round1(s.median) },
        ));
      }
      const cv = s.stdDev / Math.abs(s.mean);
      if (Math.abs(s.mean) > 0 && cv >= THRESHOLDS.CV_HIGH) {
        out.push(insight(
          "distribution",
          "info",
          `${col.name} varies widely`,
          `${col.name} has a standard deviation (${round1(s.stdDev)}) larger than its mean (${round1(s.mean)}) — values spread across a wide range (min ${round1(s.min)}, max ${round1(s.max)}).`,
          { columnId: col.columnId, cv: round1(cv) },
        ));
      }
    }
  }
  return out;
}

function outlierInsights(quality, profile) {
  const out = [];
  for (const d of quality.outlierDetails ?? []) {
    const prof = profile.byColumn[d.columnId];
    const usable = prof?.stats?.count ?? 0;
    const share = usable > 0 ? d.outliers.length / usable : 0;
    if (d.outliers.length >= THRESHOLDS.OUTLIER_MIN_COUNT || share >= THRESHOLDS.OUTLIER_MIN_SHARE) {
      out.push(insight(
        "outliers",
        "info",
        `${d.name} has potential outliers`,
        `${d.name} contains ${d.outliers.length} potential outlier${d.outliers.length === 1 ? "" : "s"} out of ${usable} usable values (IQR rule, fences ${round1(d.lower)}–${round1(d.upper)}). Unusual — not necessarily errors.`,
        { columnId: d.columnId, count: d.outliers.length, usable, share: round1(share * 100) / 100 },
      ));
    }
  }
  return out;
}

function correlationInsights(rows, profile) {
  const out = [];
  const { columns, matrix } = computeCorrelations(rows, profile);
  const seen = new Set();
  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const cell = matrix[i][j];
      if (cell.r === null) continue; // engine says unavailable — never invent a number (§9)
      if (cell.n < THRESHOLDS.CORRELATION_MIN_N) continue; // §19
      const abs = Math.abs(cell.r);
      if (abs < THRESHOLDS.CORRELATION_MODERATE) continue;
      const key = [columns[i].id, columns[j].id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const strength = abs >= THRESHOLDS.CORRELATION_STRONG ? "strong" : "moderate";
      const dir = cell.r > 0 ? "positive" : "negative";
      out.push(insight(
        "correlation",
        "info",
        `${columns[i].name} and ${columns[j].name} move together`,
        `${columns[i].name} and ${columns[j].name} show a ${strength} ${dir} association (r = ${cell.r.toFixed(2)}, n = ${cell.n}). Correlation is not causation.`,
        { xId: columns[i].id, yId: columns[j].id, r: round1(cell.r * 100) / 100, n: cell.n, strength },
      ));
    }
  }
  return out;
}

/**
 * One concise quality summary derived ONLY from the existing findings
 * (§12): names the largest concern by the engine's own severity order,
 * or reports an all-clear. No second classification system.
 */
function qualityInsight(profile, quality) {
  const findings = quality.findings ?? [];
  if (findings.length === 0) {
    return insight("quality", "info", "No quality findings",
      "No major quality findings were detected — the dataset passed the completeness, uniqueness, consistency and validity checks.");
  }
  const order = { critical: 0, warning: 1, info: 2 };
  const worst = [...findings].sort((a, b) =>
    (order[a.severity] ?? 3) - (order[b.severity] ?? 3) || (b.count ?? 0) - (a.count ?? 0))[0];
  return insight(
    "quality",
    worst.severity === "critical" ? "critical" : worst.severity === "warning" ? "warning" : "info",
    "Main quality concern",
    `The dataset's main quality concern is ${worst.title.toLowerCase()}: ${worst.description}`,
    { findingType: worst.type },
  );
}

/* ---------- prioritization (§5, documented order) ---------- */

const PRIORITY = {
  quality: 0,        // 1. the engine's own worst finding, framed
  missingness: 1,    // 2. substantial missingness
  duplicates: 2,     // 3. duplicate problems (kept for completeness)
  outliers: 3,       // 4. meaningful potential outliers
  correlation: 4,    // 5. strong numeric association
  concentration: 5,  // 6. strong category concentration
  distribution: 6,   // 7. useful distribution observation
  cardinality: 7,
};

/** Secondary sort inside a priority: bigger effect first. */
function impact(i) {
  switch (i.type) {
    case "missingness": return i.metadata.share ?? 0;
    case "outliers": return i.metadata.share ?? 0;
    case "correlation": return Math.abs(i.metadata.r ?? 0);
    case "concentration": return i.metadata.share ?? 0;
    case "distribution": return i.metadata.cv ?? 0;
    default: return 0;
  }
}

/**
 * Generate the Overview insight list: deduplicated, ordered by the
 * documented priority, capped at THRESHOLDS.MAX_INSIGHTS.
 *
 * @param {object} working - current working dataset
 * @param {object} profile - profileDataset(working)
 * @param {object} quality - analyzeQuality(working, profile) result
 * @returns {Array} insight objects (possibly empty — §20)
 */
export function generateInsights(working, profile, quality) {
  if (!working || !profile) return [];

  const all = [
    qualityInsight(profile, quality ?? { findings: [] }),
    ...missingnessInsights(profile),
    ...duplicatesInsight(profile),
    ...outlierInsights(quality ?? {}, profile),
    ...correlationInsights(working.rows, profile),
    ...concentrationInsights(profile),
    ...distributionInsights(profile),
  ];

  // Deduplicate by type+title, then order deterministically.
  const seen = new Set();
  const unique = all.filter((i) => {
    const key = `${i.type}:${i.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) =>
    (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9) || impact(b) - impact(a));

  return unique.slice(0, THRESHOLDS.MAX_INSIGHTS);
}
