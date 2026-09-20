/* ============================================================
   CSVette — chart-recs.js
   Deterministic chart recommendations from the existing profile.
   Simple rules, no ML: the inferred column types decide what is
   worth charting, and every recommendation says WHY it fits.
   ============================================================ */

/**
 * Build a ranked list of recommended chart configurations.
 * Each item: { type, xId, yId?, agg?, label, why } — all fields the
 * manual builder understands, so a recommendation is directly runnable.
 *
 * Rules (documented for maintainers):
 *   numeric column            → histogram, then box plot
 *   categorical/bool column   → bar of most-common values
 *   categorical + numeric     → aggregated bar (mean)
 *   date + numeric            → line over time (mean)
 *   two numeric columns       → scatter of the pair
 * Columns are ordered by profile quality (low missingness first) and
 * the list is capped so the screen stays scannable.
 */
export function recommendCharts(profile, { max = 6 } = {}) {
  const cols = Object.values(profile.byColumn);
  const byUsability = (a, b) => a.missingPct - b.missingPct;

  const numeric = cols
    .filter((c) => c.type === "integer" || c.type === "float")
    .sort(byUsability);
  const groupable = cols
    .filter((c) => c.type === "categorical" || c.type === "boolean" || (c.type === "string" && c.unique <= 20))
    .sort(byUsability);
  const dates = cols.filter((c) => c.type === "date").sort(byUsability);

  const recs = [];

  for (const c of numeric.slice(0, 3)) {
    recs.push({
      type: "histogram", xId: c.columnId,
      label: `Distribution of ${c.name}`,
      why: `${c.name} is numeric — a histogram shows how its values spread and where they clump.`,
    });
    if ((c.stats?.count ?? 0) >= 4) {
      recs.push({
        type: "box", xId: c.columnId,
        label: `Spread of ${c.name}`,
        why: `A box plot summarizes ${c.name} with quartiles and flags potential outliers.`,
      });
    }
  }

  for (const c of groupable.slice(0, 2)) {
    recs.push({
      type: "bar", xId: c.columnId,
      label: `Most common ${c.name} values`,
      why: `${c.name} repeats across rows (${c.unique} distinct values) — a bar chart compares the categories.`,
    });
    const num = numeric[0];
    if (num && num.columnId !== c.columnId) {
      recs.push({
        type: "agg-bar", xId: c.columnId, yId: num.columnId, agg: "mean",
        label: `Average ${num.name} by ${c.name}`,
        why: `Grouping ${num.name} by ${c.name} compares the categories numerically.`,
      });
    }
  }

  const date = dates[0];
  const numForLine = numeric.find((c) => c.columnId !== date?.columnId);
  if (date && numForLine) {
    recs.push({
      type: "line", xId: date.columnId, yId: numForLine.columnId, agg: "mean",
      label: `${numForLine.name} over time`,
      why: `${date.name} is a real date column — a line chart shows how ${numForLine.name} moves across it.`,
    });
  }

  if (numeric.length >= 2) {
    const [a, b] = numeric;
    recs.push({
      type: "scatter", xId: a.columnId, yId: b.columnId,
      label: `${a.name} vs ${b.name}`,
      why: `Two numeric columns — a scatter plot shows whether ${a.name} and ${b.name} move together.`,
    });
  }

  return recs.slice(0, max);
}
