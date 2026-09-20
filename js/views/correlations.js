/* ============================================================
   CSVette — views/correlations.js
   The Correlations screen: a readable Pearson matrix over the
   numeric columns, with a clear scale, honest gaps (insufficient
   data shows "—", never a fake 0), and neutral association
   language. Correlation is not causation — the screen says so.

   Clicking a matrix cell opens that pair as a scatter in Charts.
   ============================================================ */

import { getState } from "../state.js";
import { navigate } from "../router.js";
import { computeCorrelations } from "../chart-data.js";
import { rowsForChart } from "./charts.js";
import { el } from "../dom.js";

/** Strength bands, deliberately neutral (no causal wording). */
function strengthLabel(r) {
  const a = Math.abs(r);
  if (a < 0.1) return "negligible association";
  if (a < 0.3) return "weak association";
  if (a < 0.5) return "moderate association";
  if (a < 0.7) return "strong association";
  return "very strong association";
}
const direction = (r) => (r > 0 ? "positive" : r < 0 ? "negative" : "no");

export function renderCorrelations(container) {
  const { profile } = getState();
  container.replaceChildren();

  container.append(
    el("h1", { class: "screen-title", text: "Correlations" }),
    el("p", { class: "screen-subtitle muted", text: "How strongly numeric columns move together — Pearson's r over paired values. Association, not cause." }),
  );

  const { rows, scope } = rowsForChart();

  if (rows.length === 0) {
    container.append(el("div", { class: "chart-state card", role: "status" }, [
      el("p", { class: "chart-state-title", text: "No rows match the current search and filters" }),
      el("p", { class: "caption muted", text: "Clear the search or filters in the Data Table to compute correlations." }),
    ]));
    return;
  }

  const corr = computeCorrelations(rows, profile);

  if (!corr.computable) {
    container.append(el("div", { class: "chart-state card", role: "status" }, [
      el("p", { class: "chart-state-title", text: "Not enough numeric data" }),
      el("p", { class: "caption muted", text: corr.reason }),
    ]));
    return;
  }

  if (scope === "filtered") {
    container.append(el("p", { class: "chart-scope-note caption", text: `Computed on the ${rows.length} rows matching the current Data Explorer filters.` }));
  }

  container.append(buildMatrix(corr, profile));
  container.append(buildLegend());
  container.append(buildMethodNote(rows.length));
}

/* ---------- The matrix ---------- */

function buildMatrix(corr, profile) {
  const wrap = el("div", { class: "corr-wrap card" });
  const scroll = el("div", { class: "corr-scroll" });
  const table = el("table", { class: "corr-table" });

  // Header row: corner cell + column names
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", { class: "corr-corner", scope: "col", text: "r" }));
  for (const col of corr.columns) {
    const th = el("th", { scope: "col", class: "corr-colhead", title: col.name });
    th.textContent = col.name;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  corr.columns.forEach((rowCol, i) => {
    const tr = el("tr");
    const rowHead = el("th", { scope: "row", class: "corr-rowhead", title: rowCol.name });
    rowHead.textContent = rowCol.name;
    tr.append(rowHead);

    corr.matrix[i].forEach((cell, j) => {
      const colCol = corr.columns[j];
      tr.append(corrCell(cell, rowCol, colCol, i === j, profile));
    });
    tbody.append(tr);
  });
  table.append(tbody);

  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function corrCell(cell, rowCol, colCol, isDiagonal, profile) {
  const td = el("td", { class: "corr-cell" });

  if (isDiagonal) {
    td.classList.add("corr-diagonal");
    td.textContent = "1";
    td.setAttribute("aria-label", `${rowCol.name} with itself — 1 by definition`);
    return td;
  }

  if (cell.r === null || cell.n < 3) {
    td.classList.add("corr-na");
    td.textContent = "—";
    td.title = cell.n < 3
      ? `Only ${cell.n} complete pair${cell.n === 1 ? "" : "s"} — not enough to compute a coefficient.`
      : "A column has no variation here, so no coefficient is defined.";
    td.setAttribute("aria-label", td.title);
    return td;
  }

  const pct = Math.round(Math.abs(cell.r) * 100);
  td.style.setProperty("--r", String(cell.r));
  td.style.setProperty("--rabs", String(pct)); // strength, for color-mix tinting
  td.classList.add(cell.r > 0 ? "corr-pos" : "corr-neg");
  td.textContent = formatR(cell.r);
  td.title = `${rowCol.name} × ${colCol.name}\nr = ${formatR(cell.r)} — ${direction(cell.r)} ${strengthLabel(cell.r)}\nBased on ${cell.n} complete pairs`;
  td.setAttribute("aria-label", `${rowCol.name} and ${colCol.name}: r = ${formatR(cell.r)}, ${direction(cell.r)} ${strengthLabel(cell.r)}, ${cell.n} pairs`);
  td.classList.add("corr-clickable");
  td.setAttribute("role", "button");
  td.tabIndex = 0;
  td.addEventListener("click", () => {
    navigate("charts", { type: "scatter", x: rowCol.id, y: colCol.id });
  });
  td.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate("charts", { type: "scatter", x: rowCol.id, y: colCol.id });
    }
  });
  return td;
}

const formatR = (r) => (r < 0 ? "−" : "") + Math.abs(r).toFixed(2);

/* ---------- Legend + method notes ---------- */

function buildLegend() {
  const legend = el("div", { class: "corr-legend card" });
  const scale = el("div", { class: "corr-scale", "aria-hidden": "true" });
  const labels = el("div", { class: "corr-scale-labels caption muted" });
  for (const [label, cls] of [["−1", "neg"], ["0", "zero"], ["+1", "pos"]]) {
    const seg = el("span", { class: `corr-scale-seg ${cls}` });
    scale.append(seg);
  }
  for (const t of ["−1", "0", "+1"]) labels.append(el("span", { text: t }));

  legend.append(
    el("p", { class: "field-label", text: "Strength of association (|r|)" }),
    scale,
    labels,
    el("ul", { class: "corr-bands caption muted" }, [
      el("li", { text: "±0.7 or more — very strong" }),
      el("li", { text: "±0.5 to ±0.7 — strong" }),
      el("li", { text: "±0.3 to ±0.5 — moderate" }),
      el("li", { text: "below ±0.3 — weak or negligible" }),
    ]),
  );
  return legend;
}

function buildMethodNote(nRows) {
  return el("div", { class: "corr-note card" }, [
    el("p", { class: "chart-state-title", text: "How to read this" }),
    el("p", { class: "caption muted", text: `Pearson's r measures linear association between two numeric columns, computed over complete pairs of values (${nRows} rows in view). Positive r means the values tend to rise together; negative r means one tends to fall as the other rises. A dash means there wasn't enough complete, varying data to compute a coefficient — no number is invented.` }),
    el("p", { class: "caption muted corr-causation", text: "Correlation is not causation: a strong association does not tell you which column influences the other, or whether something else explains both." }),
  ]);
}
