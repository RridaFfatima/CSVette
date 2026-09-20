/* ============================================================
   CSVette — views/charts.js
   The Charts screen: recommended charts, a manual builder that
   only offers valid combinations, and honest states (no blank
   containers). Charts render from the working dataset or the
   explorer's current filtered view — the scope is always labeled.
   ============================================================ */

import { getState } from "../state.js";
import { explorer, rowPredicate } from "../data-filter.js";
import {
  computeHistogram, computeBoxStats, computeCategoryCounts,
  computeAggregates, computeScatter, computeLine, chartConfigError,
  AGGREGATIONS,
} from "../chart-data.js";
import { recommendCharts } from "../chart-recs.js";
import {
  renderHistogram, renderBox, renderBarChart, renderScatter, renderLine,
} from "./chart-render.js";
import { el } from "../dom.js";

const CHART_TYPES = [
  { value: "histogram", label: "Histogram — one numeric column" },
  { value: "box", label: "Box plot — one numeric column" },
  { value: "bar", label: "Bar chart — category counts" },
  { value: "agg-bar", label: "Bar chart — category + number" },
  { value: "scatter", label: "Scatter plot — two numeric columns" },
  { value: "line", label: "Line chart — number over date" },
];

/** Operators that need a value column, for UI gating. */
const NEEDS_Y = new Set(["agg-bar", "scatter", "line"]);
const NEEDS_AGG = new Set(["agg-bar", "line"]);

let currentConfig = null; // persists across re-renders within a session

export function renderCharts(container, params = {}) {
  // Deep link (e.g. a correlation cell → #/charts?type=scatter&x=age&y=gpa)
  if (params.type) {
    currentConfig = { type: params.type, xId: params.x ?? null, yId: params.y ?? null, agg: params.agg ?? "mean" };
  }
  const { dataset, profile } = getState();
  const working = dataset.working;

  container.replaceChildren();

  container.append(
    el("h1", { class: "screen-title", text: "Charts" }),
    el("p", { class: "screen-subtitle muted", text: "Visual explanations built from your actual columns — recommendations first, or build your own." }),
  );

  // ---- No suitable columns at all? Explain, don't render an empty frame.
  const typeCounts = profile.typeCounts ?? {};
  const hasNumeric = (typeCounts.integer ?? 0) + (typeCounts.float ?? 0) > 0;
  const hasCategorical = (typeCounts.categorical ?? 0) + (typeCounts.boolean ?? 0) + (typeCounts.string ?? 0) > 0;
  const hasDate = (typeCounts.date ?? 0) > 0;

  if (!hasNumeric && !hasCategorical) {
    container.append(stateCard(
      "Nothing to chart yet",
      "Charts need at least one numeric column (for distributions) or one categorical column (for comparisons). This dataset has neither after type inference.",
    ));
    return;
  }

  // ---- Scope control: what the charts represent -------------------
  container.append(buildScopeBar(container));

  // ---- Recommendations -------------------------------------------
  const recs = recommendCharts(profile);
  if (recs.length > 0) {
    const recSection = el("section", { class: "chart-recs", "aria-label": "Recommended charts" });
    recSection.append(el("h2", { class: "section-title", text: "Recommended for this dataset" }));
    const grid = el("div", { class: "chart-rec-grid" });
    for (const rec of recs) {
      grid.append(recCard(rec, container));
    }
    recSection.append(grid);
    container.append(recSection);
  }

  // ---- Manual builder --------------------------------------------
  const builderSection = el("section", { class: "chart-builder-section", "aria-label": "Build a chart" });
  builderSection.append(el("h2", { class: "section-title", text: "Build your own" }));
  builderSection.append(buildBuilder(working, profile, container));
  container.append(builderSection);

  // ---- Chart output ----------------------------------------------
  const output = el("section", { class: "chart-output view-transition", "aria-label": "Chart", "aria-live": "polite" });
  container.append(output);

  // Default view: first recommendation, so the screen never opens empty.
  if (currentConfig) {
    drawChart(output, currentConfig, container);
  } else if (recs.length > 0) {
    const first = recs[0];
    currentConfig = { type: first.type, xId: first.xId, yId: first.yId, agg: first.agg };
    drawChart(output, currentConfig, container);
  } else {
    output.append(stateCard(
      "No recommendations for this dataset",
      "The column types in this dataset don't match any chart type yet. Try the builder above.",
    ));
  }
}

/* ---------- Scope (filtered vs full dataset) ---------- */

function buildScopeBar(container) {
  const bar = el("div", { class: "chart-scope card" });
  const nFiltered = filteredRows().length;
  const nTotal = getState().profile.rowCount;
  const hasFilters = nFiltered !== nTotal;

  // The label must reflect what the charts ACTUALLY draw (scopePref),
  // not merely whether filters exist — otherwise the words and the
  // picture disagree after toggling.
  const label = el("p", { class: "chart-scope-label" });
  if (!hasFilters) {
    label.append(
      el("strong", { text: `Using all ${nTotal} rows` }),
      document.createTextNode(" — no filters are active"),
    );
    bar.append(label);
    return bar; // nothing to toggle when the views are identical
  }
  if (scopePref) {
    label.append(
      el("strong", { text: `Using current filters — ${nFiltered} of ${nTotal} rows` }),
      document.createTextNode(" (matches the Data Explorer view)"),
    );
  } else {
    label.append(
      el("strong", { text: `Using all ${nTotal} rows` }),
      document.createTextNode(" — filters are ignored for these charts"),
    );
  }

  const btn = el("button", {
    class: "btn btn-secondary btn-sm",
    type: "button",
    text: scopePref ? "Ignore filters" : "Visualize filtered rows",
    onclick: () => {
      scopePref = !scopePref;
      renderCharts(container);
    },
  });

  bar.append(label, btn);
  return bar;
}

/** The rows charts currently draw from, honoring the scope preference. */
let scopePref = true; // prefer filtered view when filters exist

function filteredRows() {
  const { dataset, profile } = getState();
  const working = dataset.working;
  const columnIds = working.columns.map((c) => c.id);
  const q = explorer.search.trim();
  const query = q === "" ? null : (/^[+-]?\d+(\.\d+)?$/.test(q) ? Number(q) : q);
  const predicate = rowPredicate(query, explorer.filters, columnIds);
  return working.rows.filter(predicate);
}

/** The rows charts currently draw from, honoring the scope preference. */
export function rowsForChart() {
  const { dataset } = getState();
  const nTotal = dataset.working.rowCount;
  const rows = filteredRows();
  if (!scopePref) return { rows: dataset.working.rows, scope: "all" };
  // Filters active → use them (and say so). Empty result → caller explains.
  return { rows, scope: rows.length !== nTotal ? "filtered" : "all" };
}

/* ---------- Recommendation cards ---------- */

function recCard(rec, container) {
  const card = el("button", { class: "chart-rec card", type: "button" });
  card.append(
    el("span", { class: "chart-rec-label", text: rec.label }),
    el("span", { class: "chart-rec-why caption muted", text: rec.why }),
    el("span", { class: "chart-rec-cta", text: "Show chart →" }),
  );
  card.addEventListener("click", () => {
    currentConfig = { type: rec.type, xId: rec.xId, yId: rec.yId, agg: rec.agg };
    renderCharts(container); // re-rendered output enters via .view-transition
  });
  return card;
}

/* ---------- Manual builder ---------- */

function buildBuilder(working, profile, container) {
  const card = el("div", { class: "chart-builder card" });

  const typeSel = el("select", { id: "chart-type", "aria-label": "Chart type" });
  for (const t of CHART_TYPES) typeSel.append(el("option", { value: t.value, text: t.label }));

  const colOpts = (filter) =>
    working.columns
      .filter((c) => filter(profile.byColumn[c.id]?.type ?? "string"))
      .map((c) => ({ value: c.id, text: `${c.name} (${profile.byColumn[c.id]?.type ?? "string"})` }));

  const xSel = el("select", { id: "chart-x", "aria-label": "X column" });
  const ySel = el("select", { id: "chart-y", "aria-label": "Y column" });
  const aggSel = el("select", { id: "chart-agg", "aria-label": "Aggregation" });

  const xField = el("div", { class: "builder-field" }, [
    el("label", { class: "field-label", for: "chart-x", text: "X axis" }),
    xSel,
  ]);
  const yField = el("div", { class: "builder-field" }, [
    el("label", { class: "field-label", for: "chart-y", text: "Y axis" }),
    ySel,
  ]);
  const aggField = el("div", { class: "builder-field" }, [
    el("label", { class: "field-label", for: "chart-agg", text: "Aggregation" }),
    aggSel,
  ]);

  /** Which columns may fill a select, per chart type and axis. */
  const xFilterFor = (type) =>
    type === "histogram" || type === "box" ? (t) => ["integer", "float"].includes(t)
    : type === "line" ? (t) => t === "date"
    : type === "scatter" ? (t) => ["integer", "float"].includes(t)
    : (t) => ["categorical", "boolean", "string", "identifier", "date"].includes(t); // bar / agg-bar groups

  const yFilterFor = (type) =>
    type === "agg-bar" || type === "line" ? (t) => ["integer", "float"].includes(t)
    : type === "scatter" ? (t) => ["integer", "float"].includes(t)
    : null;

  const fillSelect = (sel, opts, selected) => {
    sel.replaceChildren();
    for (const o of opts) sel.append(el("option", { value: o.value, text: o.text }));
    if (selected && opts.some((o) => o.value === selected)) sel.value = selected;
  };

  const sync = (keepValues) => {
    const type = typeSel.value;
    const xOpts = colOpts(xFilterFor(type));
    fillSelect(xSel, xOpts, keepValues ? xSel.value : currentConfig?.xId);

    const needsY = NEEDS_Y.has(type);
    yField.hidden = !needsY;
    if (needsY) {
      const yOpts = colOpts(yFilterFor(type)).filter((o) => o.value !== xSel.value || type !== "scatter");
      fillSelect(ySel, yOpts, keepValues ? ySel.value : currentConfig?.yId);
    }
    const needsAgg = NEEDS_AGG.has(type);
    aggField.hidden = !needsAgg;
    if (needsAgg) {
      aggSel.replaceChildren();
      for (const a of AGGREGATIONS) aggSel.append(el("option", { value: a, text: a }));
      aggSel.value = keepValues ? aggSel.value : (currentConfig?.agg ?? "mean");
    }
  };

  typeSel.addEventListener("change", () => sync(false));
  xSel.addEventListener("change", () => sync(true));

  const drawBtn = el("button", {
    class: "btn btn-primary btn-sm",
    type: "button",
    text: "Draw chart",
    onclick: () => {
      const config = {
        type: typeSel.value,
        xId: xSel.value || null,
        yId: yField.hidden ? null : (ySel.value || null),
        agg: aggField.hidden ? null : aggSel.value,
      };
      currentConfig = config;
      const output = container.querySelector(".chart-output");
      drawChart(output, config, container);
    },
  });

  card.append(
    el("div", { class: "builder-field" }, [
      el("label", { class: "field-label", for: "chart-type", text: "Chart type" }),
      typeSel,
    ]),
    xField, yField, aggField,
    el("div", { class: "builder-actions" }, [drawBtn]),
  );

  // Initialize from the current config so the builder reflects the chart
  // shown (deep links included) — sync(false) fills selects from currentConfig.
  if (currentConfig) typeSel.value = currentConfig.type;
  sync(false);
  return card;
}

/* ---------- Chart drawing + states ---------- */

function drawChart(output, config, container) {
  // M10: swap with a tiny crossfade so rebuilds read as continuity,
  // not a flash — old markup fades out, new markup rises in.
  if (output.childNodes.length) {
    output.classList.add("fade-out");
    setTimeout(() => {
      output.classList.remove("fade-out");
      drawChartInner(output, config, container);
    }, 120);
    return;
  }
  drawChartInner(output, config, container);
}

function drawChartInner(output, config, container) {
  output.replaceChildren();

  // 1. Config validation — invalid combinations get an explanation.
  const { profile } = getState();
  const configError = chartConfigError(config, profile);
  if (configError) {
    output.append(stateCard("This chart can't be built", configError));
    return;
  }

  // 2. Scope: full dataset or current filtered view.
  const { rows, scope } = rowsForChart();
  if (rows.length === 0) {
    output.append(stateCard(
      "No rows match the current search and filters",
      "The chart has nothing to draw. Clear the search or filters in the Data Table, or switch to all rows.",
    ));
    return;
  }

  // 3. Compute + render per type; data problems become honest states.
  const colName = (id) => profile.byColumn[id]?.name ?? id;
  const xLabel = colName(config.xId);
  const yLabel = config.yId ? colName(config.yId) : null;
  const scopeNote = scope === "filtered" ? " · using filtered rows" : "";

  try {
    let meta = null;
    switch (config.type) {
      case "histogram": {
        const data = computeHistogram(rows, config.xId);
        if (!data.usable) return noData(output, data);
        renderHistogram(output, data, { columnLabel: xLabel });
        meta = `${data.bins.reduce((s, b) => s + b.count, 0)} values charted`;
        break;
      }
      case "box": {
        const box = computeBoxStats(rows, config.xId);
        if (!box.usable) return noData(output, box);
        renderBox(output, box, { columnLabel: xLabel });
        meta = `${box.n} values charted`;
        break;
      }
      case "bar": {
        const data = computeCategoryCounts(rows, config.xId);
        if (!data.usable) return noData(output, data);
        renderBarChart(output, data, { xLabel, statLabel: "Rows" });
        meta = `${data.categories.reduce((s, c) => s + c.count, 0)} rows across categories`;
        break;
      }
      case "agg-bar": {
        const data = computeAggregates(rows, config.xId, config.yId, config.agg);
        if (!data.usable) return noData(output, data);
        renderBarChart(output, data, {
          xLabel, yLabel: `${config.agg} of ${yLabel}`,
          statLabel: `${config.agg} of ${yLabel}`,
          countOf: (c) => c.n,
        });
        meta = `${data.categories.length} categories charted`;
        break;
      }
      case "scatter": {
        const data = computeScatter(rows, config.xId, config.yId);
        if (!data.usable) return noData(output, data);
        renderScatter(output, data, { xLabel, yLabel });
        meta = `${data.points.length} points`;
        break;
      }
      case "line": {
        const data = computeLine(rows, config.xId, config.yId, config.agg ?? "mean");
        if (!data.usable) return noData(output, data);
        renderLine(output, data, { xLabel, yLabel });
        meta = `${data.points.length} dates`;
        break;
      }
      default:
        output.append(stateCard("Unknown chart type", "Pick a chart type from the builder."));
        return;
    }
    // Statistics ↔ Visualization connection: numeric distributions cite
    // the profile's own stats (computed once, reused — never recomputed).
    const xProf = profile.byColumn[config.xId];
    if (xProf?.stats && ["histogram", "box"].includes(config.type)) {
      output.append(el("p", {
        class: "chart-stats-line caption muted",
        text: `From Statistics: mean ${fmt(xProf.stats.mean)} · median ${fmt(xProf.stats.median)} · range ${fmt(xProf.stats.min)}–${fmt(xProf.stats.max)}.`,
      }));
    }
    annotateScope(output, scopeNote, config, profile);
  } catch (error) {
    output.append(stateCard(
      "Something went wrong while drawing this chart",
      `${error?.message ?? "Unknown error"} — adjust the chart settings and try again.`,
    ));
  }
}

function noData(output, data) {
  const extra = [];
  if (data.skipped > 0) extra.push(`${data.skipped} of ${data.total} rows were skipped because values were missing or not usable.`);
  output.append(stateCard(
    "Not enough usable data for this chart",
    `${data.reason ?? ""}${extra.length ? " " + extra.join(" ") : ""}`,
  ));
}

/** Small provenance line under the chart title area. */
function annotateScope(output, scopeNote, config, profile) {
  if (!scopeNote) return;
  const note = el("p", { class: "chart-scope-note caption" });
  note.textContent = "Chart reflects the current Data Explorer filters." + statsHint(config, profile);
  output.querySelector(".chart-figure")?.before(note);
}

function statsHint(config, profile) {
  const p = profile.byColumn[config.xId];
  if (p?.stats && ["histogram", "box"].includes(config.type)) {
    return ` Statistics: mean ${fmt(p.stats.mean)}, median ${fmt(p.stats.median)}.`;
  }
  return "";
}

const fmt = (v) => (v === null || v === undefined ? "—" : Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 3 }));

/* ---------- Shared state card ---------- */

export function stateCard(title, message) {
  const card = el("div", { class: "chart-state card", role: "status" });
  card.append(
    el("p", { class: "chart-state-title", text: title }),
    el("p", { class: "caption muted", text: message }),
  );
  return card;
}
