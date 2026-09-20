/* ============================================================
   CSVette — views/overview.js
   The Overview screen: what is this dataset, what needs your
   attention, and the full health score. Renders ONLY from
   state (profile, quality, health); no computation here.
   Every attention card deep-links into its analysis screen.
   ============================================================ */

import { el } from "../dom.js";
import { getState } from "../state.js";
import { navigate } from "../router.js";
import { formatBytes } from "../csv-parser.js";

/* ---------- Key insights (Milestone 8) ----------
   Rendered from state.insights — the pure engine's output.
   This view owns presentation only: severity chips, source
   labels, and the deep link each insight exposes (§14–§16). */

const INSIGHT_LINKS = {
  missingness: (m) => ({ route: "table", params: { col: m.columnId }, label: "View column →" }),
  duplicates: () => ({ route: "duplicates", params: {}, label: "View duplicates →" }),
  concentration: (m) => ({ route: "table", params: { col: m.columnId }, label: "View column →" }),
  cardinality: (m) => ({ route: "stats", params: {}, label: "Open Statistics →" }),
  distribution: (m) => ({ route: "charts", params: { type: "histogram", x: m.columnId }, label: "View histogram →" }),
  outliers: (m) => ({ route: "charts", params: { type: "box", x: m.columnId }, label: "View box plot →" }),
  correlation: (m) => ({ route: "charts", params: { type: "scatter", x: m.xId, y: m.yId }, label: "View scatter →" }),
  quality: (m) => ({ route: "health", params: {}, label: "Open Data Health →" }),
};

function insightRow(ins) {
  const row = el("div", { class: `insight-row insight-${ins.severity}` });
  // Severity is conveyed by text label AND color — never color alone (§29).
  row.append(el("span", { class: `chip chip-${ins.severity} insight-chip`, text: ins.severity }));
  const main = el("div", { class: "insight-main" });
  main.append(el("p", { class: "insight-text", text: ins.description }));
  main.append(el("span", { class: "caption muted insight-source", text: `Source: ${ins.source}` }));
  row.append(main);
  const link = INSIGHT_LINKS[ins.type]?.(ins.metadata ?? {});
  if (link) {
    row.append(el("button", {
      class: "btn btn-secondary btn-sm insight-link",
      type: "button",
      text: link.label,
      onclick: () => navigate(link.route, link.params),
    }));
  }
  return row;
}

function buildInsights() {
  const { insights, dataset, profile } = getState();
  const card = el("section", { class: "card card-pad", "aria-label": "Key insights" });
  card.append(el("h3", { class: "h3" }, ["Key insights"]));
  card.append(el("p", {
    class: "caption muted",
    text: `Deterministic observations about ${dataset.fileName ?? "this dataset"} — always describing the full working dataset, never the current table filters.`,
  }));

  const list = insights ?? [];
  if (list.length === 0) {
    card.append(el("p", { class: "muted", text: "No additional insights detected." }));
    return card;
  }
  const wrap = el("div", { class: "insight-list" });
  for (const ins of list) wrap.append(insightRow(ins));
  card.append(wrap);
  card.append(el("p", {
    class: "caption muted",
    text: "Observations only — CSVette describes patterns; it does not infer causes.",
  }));
  return card;
}

const FINDING_META = {
  "missing-values":        { label: "Missing values", icon: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01", cta: "View details →" },
  "duplicate-rows":        { label: "Duplicate rows", icon: "M16 3h5v5 M8 3H3v5 M12 8v8 M8 21h8", cta: "View duplicates →" },
  "duplicate-identifiers": { label: "Duplicate identifiers", icon: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7", cta: "View identifiers →" },
  "constant-columns":      { label: "Constant columns", icon: "M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3", cta: "View details →" },
  "category-inconsistency":{ label: "Category inconsistencies", icon: "M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3", cta: "View issues →" },
  "type-issues":           { label: "Type issues", icon: "M4 7V4h16v3 M9 20h6 M12 4v16", cta: "View details →" },
  "identifier-columns":    { label: "Identifier columns", icon: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7", cta: "View details →" },
  "outliers":              { label: "Potential outliers", icon: "M4 14h16 M8 14V8 M16 14v-4 M12 14v2", cta: "View outliers →" },
};

/** Render Overview into the workspace container. */
export function renderOverview(container) {
  const { dataset, profile, health, quality, warnings } = getState();
  const working = dataset.working;

  container.replaceChildren();

  // ---------- Header strip ----------
  const head = el("section", { class: "card card-pad ov-head" });
  head.append(
    el("div", { class: "ov-head-main" }, [
      el("h2", { class: "h1" }, [dataset.fileName ?? "Dataset"]),
      el("p", { class: "caption muted" }, [
        `${profile.rowCount} rows × ${profile.columnCount} columns · ${profile.totalCells} cells · ${formatBytes(dataset.sizeBytes)}`,
      ]),
    ]),
    el("div", { class: "ov-score" }, [
      el("div", { class: "ov-score-num mono" }, [String(health.score)]),
      el("div", { class: "ov-score-side" }, [
        healthChip(health.band),
        el("span", { class: "caption muted" }, ["health score"]),
      ]),
    ]),
  );
  container.append(head);

  // ---------- Parse warnings ----------
  if (warnings.length > 0) {
    const warn = el("div", { class: "alert alert-warning", role: "note" });
    warn.append(el("div", { class: "alert-title" }, [`Parsed with ${warnings.length} note${warnings.length > 1 ? "s" : ""}`]));
    const list = el("ul", { class: "alert-list" });
    for (const w of warnings.slice(0, 4)) list.append(el("li", {}, [w]));
    warn.append(list);
    container.append(warn);
  }

  // ---------- What needs your attention? ----------
  container.append(buildAttention(quality));

  // ---------- Key insights (Milestone 8) ----------
  container.append(buildInsights());

  // ---------- Stat grid ----------
  const grid = el("section", { class: "ov-grid" });
  grid.append(
    statCard("Missing values", profile.missingCells,
      `${pct(profile.missingCells, profile.totalCells)} of all cells`, profile.missingCells > 0),
    statCard("Duplicate rows", profile.duplicateRows,
      profile.duplicateRows > 0 ? "exact matches" : "none found", profile.duplicateRows > 0),
    statCard("Numeric columns", typeCount(profile, ["integer", "float"]),
      "usable in statistics"),
    statCard("Categorical columns", typeCount(profile, ["categorical"]),
      "repeating text values"),
    statCard("Date columns", typeCount(profile, ["date"]),
      "recognized date formats"),
    statCard("Boolean columns", typeCount(profile, ["boolean"]),
      "true/false-like values"),
  );
  container.append(grid);

  // ---------- Health breakdown (full, four dimensions) ----------
  const hc = el("section", { class: "card card-pad" });
  hc.append(
    el("h3", { class: "h3" }, ["Health score breakdown"]),
  );

  const dims = el("div", { class: "ov-dims" });
  for (const [key, dim] of Object.entries(health.dimensions)) {
    const name = key[0].toUpperCase() + key.slice(1);
    dims.append(
      el("div", { class: "ov-dim" }, [
        el("span", { class: "ov-dim-name" }, [`${name} · weight ${dim.weight}`]),
        el("span", { class: "ov-dim-value mono" }, [`${dim.value}`]),
        el("div", { class: "ov-dim-bar" }, [
          el("i", { style: `width:${dim.value}%` }),
        ]),
        el("span", { class: "caption muted" }, [dim.detail]),
      ]),
    );
  }
  hc.append(dims);

  const methodLink = el("button", {
    class: "btn btn-secondary btn-sm",
    type: "button",
    onClick: () => navigate("health"),
  }, ["How this is calculated →"]);
  hc.append(methodLink);
  container.append(hc);

  // ---------- Column table ----------
  const colCard = el("section", { class: "card" });
  colCard.append(el("div", { class: "card-head" }, [el("h3", { class: "h3" }, ["Columns"])]));

  const wrap = el("div", { class: "table-scroll" });
  const table = el("table", { class: "data-table" });
  table.innerHTML = `
    <thead><tr>
      <th scope="col">Column</th><th scope="col">Type</th><th scope="col" class="num">Missing</th>
      <th scope="col" class="num">Unique</th><th scope="col" class="num">Min</th><th scope="col" class="num">Mean</th>
      <th scope="col" class="num">Median</th><th scope="col" class="num">Max</th><th scope="col">Issues</th>
    </tr></thead>`;

  const findingsByType = Object.fromEntries((quality?.findings ?? []).map((f) => [f.type, f]));
  const byColumnId = (list) => list ?? [];

  const tbody = el("tbody");
  for (const col of Object.values(profile.byColumn)) {
    const s = col.stats;
    const fmt = (v) => (v === null || v === undefined ? "—" : fmtNum(v));

    // Per-column issue links (spec §29: column names link into analysis).
    const issues = el("td", { class: "issues-cell" });
    const missN = col.missing;
    const outN = byColumnId(findingsByType["outliers"]?.columns).includes(col.columnId)
      ? findingsByType["outliers"].columnCounts[col.columnId] : 0;
    const varN = byColumnId(findingsByType["category-inconsistency"]?.columns).includes(col.columnId)
      ? findingsByType["category-inconsistency"].columnCounts[col.columnId] : 0;
    const typeN = byColumnId(findingsByType["type-issues"]?.columns).includes(col.columnId)
      ? findingsByType["type-issues"].columnCounts[col.columnId] : 0;

    if (missN > 0) issues.append(issueChip(`${missN} missing`, "missing", col.columnId));
    if (outN > 0) issues.append(issueChip(`${outN} outlier${outN === 1 ? "" : "s"}`, "outliers", col.columnId));
    if (varN > 0) issues.append(issueChip("variants", "consistency", col.columnId));
    if (typeN > 0) issues.append(issueChip(`${typeN} type`, "types", col.columnId));
    if (col.isConstant) issues.append(issueChip("constant", "consistency", col.columnId));
    if (col.type === "identifier") {
      issues.append(issueChip("identifier", "identifiers", col.columnId));
    }
    if (issues.childNodes.length === 0) {
      issues.append(el("span", { class: "caption muted" }, ["—"]));
    }

    const missingTd = el("td", { class: "num" }, [
      `${col.missing}${missN > 0 ? ` (${pct(col.missing, col.total)})` : ""}`,
    ]);

    const tr = el("tr", {}, [
      el("td", {}, [
        el("button", {
          class: "link-btn",
          type: "button",
          onClick: () => navigate("table", { col: col.columnId }),
        }, [col.name]),
      ]),
      el("td", {}, [el("span", { class: "chip" }, [col.type])]),
      missingTd,
      el("td", { class: "num" }, [`${col.unique}`]),
      el("td", { class: "num mono" }, [s ? fmt(s.min) : "—"]),
      el("td", { class: "num mono" }, [s ? fmt(s.mean) : "—"]),
      el("td", { class: "num mono" }, [s ? fmt(s.median) : "—"]),
      el("td", { class: "num mono" }, [s ? fmt(s.max) : "—"]),
      issues,
    ]);

    if (missN > 0) missingTd.classList.add("is-missing");
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  colCard.append(wrap);
  container.append(colCard);
}

/* ---------- Attention cards ---------- */

function buildAttention(quality) {
  const section = el("section", { class: "attention-section" });
  section.append(el("h3", { class: "h3" }, ["What needs your attention?"]));

  const findings = (quality?.findings ?? []).filter((f) => f.count > 0 || f.type === "identifier-columns");

  if (findings.length === 0) {
    const card = el("div", { class: "card card-pad all-clear" });
    card.append(
      el("h3", { class: "h3" }, ["Nothing needs attention"]),
      el("p", { class: "finding-desc muted" }, [
        "No missing values, duplicates, outliers, or inconsistencies were detected. ",
        "Explore the statistics or create a chart to learn more.",
      ]),
    );
    section.append(card);
    return section;
  }

  const grid = el("div", { class: "attention-grid" });
  for (const f of findings) {
    const meta = FINDING_META[f.type] ?? { label: f.title, cta: "View details →" };
    const sub = attentionSub(f);
    const card = el("div", { class: "card card-pad attention-card" });

    card.append(
      el("div", { class: "attention-card-top" }, [
        sevIcon(f.severity),
        el("span", { class: "attention-card-label" }, [meta.label]),
      ]),
      el("div", { class: "attention-card-count mono" }, [countLabel(f)]),
      el("div", { class: "caption muted" }, [sub]),
      el("button", {
        class: "attention-card-cta",
        type: "button",
        onClick: () => navigate(f.route, attentionParams(f)),
      }, [meta.cta]),
    );
    grid.append(card);
  }
  section.append(grid);
  return section;
}

function countLabel(f) {
  switch (f.type) {
    case "identifier-columns": return `${f.count} column${f.count === 1 ? "" : "s"} detected`;
    case "constant-columns":   return `${f.count} column${f.count === 1 ? "" : "s"}`;
    default:                   return `${f.count}`;
  }
}

function attentionSub(f) {
  switch (f.type) {
    case "missing-values": {
      const worst = Object.entries(f.columnCounts).sort((a, b) => b[1] - a[1])[0];
      return `${f.columns.length} column${f.columns.length === 1 ? "" : "s"} affected · worst: "${worst?.[0] ?? "?"}"`;
    }
    case "category-inconsistency":
      return `${f.columns.length} column${f.columns.length === 1 ? "" : "s"} affected`;
    case "outliers":
      return `${f.columns.length} numeric column${f.columns.length === 1 ? "" : "s"} affected`;
    case "duplicate-rows":
      return f.sampleRows.length > 0 ? `e.g. row ${f.sampleRows[0]}` : "";
    default:
      return "";
  }
}

function attentionParams(f) {
  // Deep-link a column context where the screen supports it.
  if (f.type === "missing-values") {
    const worst = Object.entries(f.columnCounts).sort((a, b) => b[1] - a[1])[0];
    return worst ? { col: worst[0] } : {};
  }
  return {};
}

function sevIcon(sev) {
  const paths = {
    critical: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
    warning:  "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
    info:     "M12 16v-4 M12 8h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[sev] ?? paths.info);
  svg.append(path);
  svg.classList.add(`sev-icon-${sev}`);
  return svg;
}

function healthChip(band) {
  const map = { good: "ok", fair: "warning", poor: "critical" };
  const labels = { good: "Good", fair: "Fair", poor: "Poor" };
  const svg = sevIcon(map[band]);
  const chip = el("span", { class: `sev sev-${map[band]}` }, [
    svg,
    el("span", { class: "sr-only" }, [`${labels[band]}: `]),
    labels[band],
  ]);
  return chip;
}

function issueChip(label, route, colId) {
  return el("button", {
    class: "chip chip-link",
    type: "button",
    onClick: () => navigate(route, colId ? { col: colId } : {}),
  }, [label]);
}

/* ---------- small builders ---------- */

function statCard(label, value, note, flagged = false) {
  return el("div", { class: "card ov-stat" + (flagged ? " ov-stat-flag" : "") }, [
    el("span", { class: "caption muted" }, [label]),
    el("span", { class: "ov-stat-num mono" }, [String(value)]),
    el("span", { class: "caption muted" }, [note]),
  ]);
}

function typeCount(profile, types) {
  return types.reduce((n, t) => n + (profile.typeCounts[t] ?? 0), 0);
}

function pct(part, total) {
  if (!total) return "0%";
  const p = (part / total) * 100;
  return (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + "%";
}

function fmtNum(v) {
  if (v === null || v === undefined) return "—";
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
