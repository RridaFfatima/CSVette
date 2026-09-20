/* ============================================================
   CSVette — data-quality.js
   The quality engine: every rule returns QualityFinding objects
   that power the sidebar badges, Overview attention cards, the
   analysis screens, and the health score. Pure module: no DOM.

   Wording rule: outliers are always "potential" — the engine
   chooses the words, so no view can overstate certainty.
   ============================================================ */

import { isMissing } from "./data-profile.js";
import { matchesType } from "./data-profile.js";

/* ---------- Severity model ---------- */

export const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/* ---------- Main entry ---------- */

/**
 * Run every quality rule against a profiled dataset.
 * @param {object} dataset - the working dataset
 * @param {object} profile - profileDataset() result
 * @returns {object} { findings, health, duplicateRowNumbers, dupIdDetails,
 *                     variantGroups, typeViolations, outlierDetails, missingDetails }
 */
export function analyzeQuality(dataset, profile) {
  const findings = [];

  const missing = findMissingValues(dataset, profile);
  if (missing.finding) findings.push(missing.finding);

  const duplicates = findDuplicateRows(dataset, profile);
  if (duplicates.finding) findings.push(duplicates.finding);

  const dupIds = findDuplicateIdentifiers(dataset, profile);
  if (dupIds.finding) findings.push(dupIds.finding);

  const constants = findConstantColumns(profile);
  if (constants.finding) findings.push(constants.finding);

  const variants = findCategoryInconsistencies(dataset, profile);
  if (variants.finding) findings.push(variants.finding);

  const types = findTypeIssues(dataset, profile);
  if (types.finding) findings.push(types.finding);

  const ids = findIdentifierColumns(profile);
  if (ids.finding) findings.push(ids.finding);

  const outliers = findOutliers(dataset, profile);
  if (outliers.finding) findings.push(outliers.finding);

  // Keep findings ordered by severity for every consumer.
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const health = computeHealth(profile, findings);

  return {
    findings,
    health,
    duplicateRowNumbers: duplicates.rowNumbers,
    duplicateGroups: duplicates.groups,
    dupIdDetails: dupIds.details,
    variantGroups: variants.groups,
    typeViolations: types.details,
    outlierDetails: outliers.details,
    missingDetails: missing.details,
  };
}

/* ---------- Rules ---------- */

function findMissingValues(dataset, profile) {
  const details = []; // { columnId, name, type, missing, missingPct, tokens: {token: count}, sampleRows }
  let totalMissing = 0;
  let worstPct = 0;

  for (const col of dataset.columns) {
    const prof = profile.byColumn[col.id];
    if (!prof || prof.missing === 0) continue;

    const tokens = {};
    const sampleRows = [];
    for (const row of dataset.rows) {
      const raw = String(row[col.id] ?? "").trim();
      if (isMissing(raw)) {
        const token = raw === "" ? "(empty)" : raw.toLowerCase();
        tokens[token] = (tokens[token] ?? 0) + 1;
        if (sampleRows.length < 8) sampleRows.push(row.__rowNum);
      }
    }

    details.push({
      columnId: col.id,
      name: col.name,
      type: prof.type,
      missing: prof.missing,
      missingPct: prof.missingPct,
      tokens,
      sampleRows,
    });

    totalMissing += prof.missing;
    worstPct = Math.max(worstPct, prof.missingPct);
  }

  if (totalMissing === 0) return { finding: null, details };

  const finding = {
    type: "missing-values",
    severity: worstPct > 20 ? "critical" : worstPct > 5 ? "warning" : "info",
    title: "Missing values",
    description: `${totalMissing} missing cell${totalMissing === 1 ? "" : "s"} across ${details.length} column${details.length === 1 ? "" : "s"}`,
    columns: details.map((d) => d.columnId),
    count: totalMissing,
    columnCounts: Object.fromEntries(details.map((d) => [d.columnId, d.missing])),
    sampleRows: details.flatMap((d) => d.sampleRows).slice(0, 5),
    route: "missing",
  };

  return { finding, details };
}

function findDuplicateRows(dataset, profile) {
  const seen = new Map(); // key → first rowNum
  const groups = [];      // { rows: [rowNum], preview: [values] }
  const rowNumbers = [];

  for (const row of dataset.rows) {
    const key = dataset.columns.map((c) => row[c.id] ?? "").join("\u0000");
    if (seen.has(key)) {
      let group = groups.find((g) => g.key === key);
      if (!group) {
        group = { key, rows: [seen.get(key)], preview: dataset.columns.slice(0, 4).map((c) => String(row[c.id] ?? "")) };
        groups.push(group);
      }
      group.rows.push(row.__rowNum);
      rowNumbers.push(row.__rowNum);
    } else {
      seen.set(key, row.__rowNum);
    }
  }

  if (rowNumbers.length === 0) return { finding: null, rowNumbers, groups };

  const pct = profile.rowCount > 0 ? ((rowNumbers.length / profile.rowCount) * 100).toFixed(1) : "0";
  const finding = {
    type: "duplicate-rows",
    severity: "warning",
    title: "Duplicate rows",
    description: `${rowNumbers.length} exact duplicate row${rowNumbers.length === 1 ? "" : "s"} (${pct}% of all rows) in ${groups.length} group${groups.length === 1 ? "" : "s"}`,
    columns: [],
    count: rowNumbers.length,
    columnCounts: {},
    sampleRows: rowNumbers.slice(0, 5),
    route: "duplicates",
  };

  return { finding, rowNumbers, groups };
}

function findDuplicateIdentifiers(dataset, profile) {
  const details = []; // { columnId, name, repeats: [{value, count, rows}] }

  for (const col of dataset.columns) {
    const prof = profile.byColumn[col.id];
    if (!prof || prof.type !== "identifier") continue;

    const occurrences = new Map(); // value → [rowNum]
    for (const row of dataset.rows) {
      const v = String(row[col.id] ?? "").trim();
      if (isMissing(v)) continue;
      if (!occurrences.has(v)) occurrences.set(v, []);
      occurrences.get(v).push(row.__rowNum);
    }

    const repeats = [...occurrences.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([value, rows]) => ({ value, count: rows.length, rows }))
      .sort((a, b) => b.count - a.count);

    if (repeats.length > 0) {
      details.push({ columnId: col.id, name: col.name, repeats });
    }
  }

  const extraOccurrences = details.reduce(
    (n, d) => n + d.repeats.reduce((m, r) => m + (r.count - 1), 0),
    0
  );

  if (extraOccurrences === 0) return { finding: null, details };

  const finding = {
    type: "duplicate-identifiers",
    severity: "warning",
    title: "Duplicate identifiers",
    description:
      `${extraOccurrences} repeated identifier value${extraOccurrences === 1 ? "" : "s"} in ` +
      details.map((d) => `"${d.name}"`).join(", ") +
      " — IDs are usually expected to be unique",
    columns: details.map((d) => d.columnId),
    count: extraOccurrences,
    columnCounts: Object.fromEntries(
      details.map((d) => [d.columnId, d.repeats.reduce((m, r) => m + (r.count - 1), 0)])
    ),
    sampleRows: details.flatMap((d) => d.repeats.flatMap((r) => r.rows)).slice(0, 5),
    route: "identifiers",
  };

  return { finding, details };
}

function findConstantColumns(profile) {
  const columns = Object.values(profile.byColumn).filter(
    (p) => p.isConstant && p.missing < p.total
  );
  if (columns.length === 0) return { finding: null };

  return {
    finding: {
      type: "constant-columns",
      severity: "info",
      title: "Constant columns",
      description: `${columns.length} column${columns.length === 1 ? "" : "s"} where every value is identical: ${columns.map((c) => `"${c.name}"`).join(", ")}`,
      columns: columns.map((c) => c.columnId),
      count: columns.length,
      columnCounts: Object.fromEntries(columns.map((c) => [c.columnId, 1])),
      sampleRows: [],
      route: "consistency",
    },
  };
}

/* --- Category inconsistencies -------------------------------------
   Two signals, both reported as "possible":
   1. Same normalized key, different raw spellings (case/punctuation).
   2. Abbreviations: one key is a prefix (≥3 chars) of another.     */

function normalizeCategory(value) {
  return String(value).trim().toLowerCase().replace(/[\s.\-_]+/g, "");
}

function findCategoryInconsistencies(dataset, profile) {
  const groups = []; // { columnId, name, clusters: [{ canonical, variants: [{value, count}] }] }

  for (const col of dataset.columns) {
    const prof = profile.byColumn[col.id];
    if (!prof) continue;
    if (!["categorical", "string"].includes(prof.type)) continue;
    if (prof.isConstant) continue;

    const keyMap = new Map(); // normalized key → Map(raw → count)
    for (const row of dataset.rows) {
      const raw = String(row[col.id] ?? "").trim();
      if (isMissing(raw) || raw === "") continue;
      const key = normalizeCategory(raw);
      if (key.length === 0) continue;
      if (!keyMap.has(key)) keyMap.set(key, new Map());
      const variants = keyMap.get(key);
      variants.set(raw, (variants.get(raw) ?? 0) + 1);
    }

    // Union keys where one is a prefix of another (abbreviation signal).
    const keys = [...keyMap.keys()];
    const merged = new Map(keys.map((k) => [k, k])); // key → representative key
    for (const a of keys) {
      if (a.length < 3) continue;
      for (const b of keys) {
        if (a === b || b.length < 3) continue;
        if (b.startsWith(a) && a !== b) {
          merged.set(b, merged.get(a) ?? a); // b joins a's group
        }
      }
    }

    const clusters = new Map(); // representative → Map(raw → count)
    for (const [key, variants] of keyMap) {
      const rep = merged.get(key) ?? key;
      if (!clusters.has(rep)) clusters.set(rep, new Map());
      const target = clusters.get(rep);
      for (const [raw, count] of variants) {
        target.set(raw, (target.get(raw) ?? 0) + count);
      }
    }

    const columnClusters = [];
    for (const variants of clusters.values()) {
      if (variants.size < 2) continue; // one spelling → nothing to flag
      const list = [...variants.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      columnClusters.push({ canonical: list[0].value, variants: list });
    }

    if (columnClusters.length > 0) {
      groups.push({ columnId: col.id, name: col.name, clusters: columnClusters });
    }
  }

  const affectedCells = groups.reduce(
    (n, g) =>
      n +
      g.clusters.reduce(
        (m, cl) => m + cl.variants.slice(1).reduce((s, v) => s + v.count, 0),
        0
      ),
    0
  );

  if (groups.length === 0) return { finding: null, groups };

  const finding = {
    type: "category-inconsistency",
    severity: "warning",
    title: "Category inconsistencies",
    description:
      `${affectedCells} cell${affectedCells === 1 ? "" : "s"} in ${groups.length} column${groups.length === 1 ? "" : "s"} ` +
      `may use inconsistent spellings (e.g. "Pakistan / pakistan / PAKISTAN"). Differences are flagged, not judged.`,
    columns: groups.map((g) => g.columnId),
    count: affectedCells,
    columnCounts: Object.fromEntries(
      groups.map((g) => [
        g.columnId,
        g.clusters.reduce((m, cl) => m + cl.variants.slice(1).reduce((s, v) => s + v.count, 0), 0),
      ])
    ),
    sampleRows: [],
    route: "consistency",
  };

  return { finding, groups };
}

function findTypeIssues(dataset, profile) {
  const details = []; // { columnId, name, inferredType, violations: [{value, rowNum}] }

  for (const col of dataset.columns) {
    const prof = profile.byColumn[col.id];
    if (!prof) continue;
    // string/identifier/empty columns accept any text — nothing to violate.
    if (["string", "identifier", "empty"].includes(prof.type)) continue;

    const violations = [];
    for (const row of dataset.rows) {
      const raw = String(row[col.id] ?? "").trim();
      if (isMissing(raw)) continue; // missing is reported separately
      if (!matchesType(prof.type, raw)) {
        violations.push({ value: raw, rowNum: row.__rowNum });
        if (violations.length >= 20) break; // cap for display; count stays approximate
      }
    }

    if (violations.length > 0) {
      details.push({
        columnId: col.id,
        name: col.name,
        inferredType: prof.type,
        violations,
        truncated: violations.length >= 20,
      });
    }
  }

  if (details.length === 0) return { finding: null, details };

  const total = details.reduce((n, d) => n + d.violations.length, 0);
  const finding = {
    type: "type-issues",
    severity: "warning",
    title: "Type issues",
    description: `${total} value${total === 1 ? "" : "s"} don't fit their column's inferred type in ${details.length} column${details.length === 1 ? "" : "s"} (e.g. "twenty-two" in an age column)`,
    columns: details.map((d) => d.columnId),
    count: total,
    columnCounts: Object.fromEntries(details.map((d) => [d.columnId, d.violations.length])),
    sampleRows: details.flatMap((d) => d.violations.map((v) => v.rowNum)).slice(0, 5),
    route: "types",
  };

  return { finding, details };
}

function findIdentifierColumns(profile) {
  const columns = Object.values(profile.byColumn).filter((p) => p.type === "identifier");
  if (columns.length === 0) return { finding: null };

  const evidence = columns
    .map((c) => `"${c.name}" (${c.uniquePct.toFixed(0)}% unique)`)
    .join(", ");

  return {
    finding: {
      type: "identifier-columns",
      severity: "info",
      title: "Identifier columns",
      description:
        `${columns.length} column${columns.length === 1 ? "" : "s"} look like identifiers: ${evidence}. ` +
        "IDs are labels, not measurements — CSVette excludes them from statistics, outliers, and correlations.",
      columns: columns.map((c) => c.columnId),
      count: columns.length,
      columnCounts: Object.fromEntries(columns.map((c) => [c.columnId, 1])),
      sampleRows: [],
      route: "identifiers",
    },
  };
}

function findOutliers(dataset, profile) {
  const details = []; // { columnId, name, q1, q3, lower, upper, outliers: [{value, rowNum}] }

  for (const col of dataset.columns) {
    const prof = profile.byColumn[col.id];
    if (!prof || !prof.stats) continue; // only numeric non-identifier columns have stats
    if (!["integer", "float"].includes(prof.type)) continue;

    const { q1, q3, iqr } = prof.stats;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;

    const outliers = [];
    for (const row of dataset.rows) {
      const raw = String(row[col.id] ?? "").trim();
      if (isMissing(raw)) continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      if (num < lower || num > upper) {
        outliers.push({ value: num, rowNum: row.__rowNum });
      }
    }

    if (outliers.length > 0) {
      details.push({ columnId: col.id, name: col.name, q1, q3, iqr, lower, upper, outliers });
    }
  }

  if (details.length === 0) return { finding: null, details };

  const total = details.reduce((n, d) => n + d.outliers.length, 0);
  const finding = {
    type: "outliers",
    severity: "info",
    title: "Potential outliers",
    description:
      `${total} potential outlier${total === 1 ? "" : "s"} in ${details.length} column${details.length === 1 ? "" : "s"} ` +
      `(IQR method). Unusual values are worth reviewing — not necessarily errors.`,
    columns: details.map((d) => d.columnId),
    count: total,
    columnCounts: Object.fromEntries(details.map((d) => [d.columnId, d.outliers.length])),
    sampleRows: details.flatMap((d) => d.outliers.map((o) => o.rowNum)).slice(0, 5),
    route: "outliers",
  };

  return { finding, details };
}

/* ---------- Health score (all four dimensions) ---------- */

/**
 * Start at 100 per dimension; subtract transparent penalties.
 * Weights: Completeness 30 · Uniqueness 20 · Consistency 25 · Validity 25.
 * A dimension with nothing to measure keeps its full points.
 */
export function computeHealth(profile, findings = []) {
  const byType = Object.fromEntries(findings.map((f) => [f.type, f]));

  const completeness = profile.totalCells > 0
    ? 100 * (1 - profile.missingCells / profile.totalCells)
    : 100;

  const uniqueness = profile.rowCount > 0
    ? 100 * (1 - profile.duplicateRows / profile.rowCount)
    : 100;

  // Consistency: category-inconsistency −8/column, type issues −6/column.
  const catCols = byType["category-inconsistency"]?.columns.length ?? 0;
  const typeCols = byType["type-issues"]?.columns.length ?? 0;
  const conPenalty = Math.min(25, catCols * 8 + typeCols * 6);
  const consistency = 100 - conPenalty;

  // Validity: outliers −3/column, constant −4/column, duplicate IDs −6/column.
  const outlierCols = byType["outliers"]?.columns.length ?? 0;
  const constCols = byType["constant-columns"]?.columns.length ?? 0;
  const dupIdCols = byType["duplicate-identifiers"]?.columns.length ?? 0;
  const valPenalty = Math.min(25, outlierCols * 3 + constCols * 4 + dupIdCols * 6);
  const validity = 100 - valPenalty;

  const score = Math.round(
    (30 * completeness + 20 * uniqueness + 25 * consistency + 25 * validity) / 100
  );
  const band = score >= 85 ? "good" : score >= 50 ? "fair" : "poor";

  const pct = (v) => Math.round(v * 10) / 10;
  const weightedPoints = (v, w) => Math.round(((v * w) / 100) * 10) / 10;

  return {
    score,
    band,
    dimensions: {
      completeness: {
        value: pct(completeness),
        weight: 30,
        evaluated: true,
        detail: `${profile.missingCells} of ${profile.totalCells} cells missing`,
      },
      uniqueness: {
        value: pct(uniqueness),
        weight: 20,
        evaluated: true,
        detail: profile.duplicateRows > 0
          ? `${profile.duplicateRows} duplicate row(s) of ${profile.rowCount}`
          : "No duplicate rows",
      },
      consistency: {
        value: pct(consistency),
        weight: 25,
        evaluated: true,
        detail: conPenalty === 0
          ? "No category or type inconsistencies found"
          : `−${conPenalty} points: inconsistent categories (−8/column) and type issues (−6/column)`,
      },
      validity: {
        value: pct(validity),
        weight: 25,
        evaluated: true,
        detail: valPenalty === 0
          ? "No validity issues found"
          : `−${valPenalty} points: outliers (−3/column), constant columns (−4/column), duplicate IDs (−6/column)`,
      },
    },
    // Weighted points per dimension — the "Points" column must read against
    // its "/ max" (e.g. completeness 98% × weight 30 → 29.4 of 30).
    breakdown: [
      { rule: "Completeness", weight: 30, points: weightedPoints(completeness, 30), max: 30, reason: byType["missing-values"]?.description ?? "No missing values" },
      { rule: "Uniqueness", weight: 20, points: weightedPoints(uniqueness, 20), max: 20, reason: byType["duplicate-rows"]?.description ?? "No exact duplicate rows" },
      { rule: "Consistency", weight: 25, points: weightedPoints(consistency, 25), max: 25, reason: byType["category-inconsistency"]?.description ?? (byType["type-issues"]?.description ?? "Consistent categories and types") },
      { rule: "Validity", weight: 25, points: weightedPoints(validity, 25), max: 25, reason: byType["outliers"]?.description ?? (byType["constant-columns"]?.description ?? "Values within expected ranges") },
    ],
  };
}
