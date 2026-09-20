/* ============================================================
   CSVette — views/stats.js
   The Statistics screen: choose a column, see its profile in
   detail — including min/max/mean/median/stdDev for numeric
   columns and top values for categorical ones.
   ============================================================ */

import { getState } from "../state.js";

let selectedColumnId = null;

/** Render the statistics view. */
export function renderStats(container) {
  const { dataset, profile } = getState();
  const working = dataset.working;

  // Keep prior selection when the column still exists; else default to first.
  if (!selectedColumnId || !profile.byColumn[selectedColumnId]) {
    selectedColumnId = working.columns[0]?.id ?? null;
  }

  container.replaceChildren();

  if (!selectedColumnId) {
    const empty = document.createElement("p");
    empty.className = "caption muted";
    empty.textContent = "This dataset has no columns to profile.";
    container.append(empty);
    return;
  }

  // ---------- Layout: column list + detail ----------
  const layout = document.createElement("div");
  layout.className = "stats-layout";

  const list = document.createElement("div");
  list.className = "card stats-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Columns");

  for (const col of working.columns) {
    const prof = profile.byColumn[col.id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stats-col-item";
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(col.id === selectedColumnId));
    btn.dataset.columnId = col.id;

    const name = document.createElement("span");
    name.className = "stats-col-name";
    name.textContent = col.name;

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = prof.type;

    btn.append(name, chip);
    btn.addEventListener("click", () => {
      selectedColumnId = col.id;
      renderStats(container);
    });
    list.append(btn);
  }

  const detail = document.createElement("div");
  detail.className = "card card-pad stats-detail";
  renderColumnDetail(detail, profile.byColumn[selectedColumnId]);

  layout.append(list, detail);
  container.append(layout);
}

function renderColumnDetail(panel, prof) {
  panel.replaceChildren();

  const head = document.createElement("div");
  head.className = "stats-detail-head";
  const title = document.createElement("h3");
  title.className = "h2";
  title.textContent = prof.name;
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = prof.type;
  head.append(title, chip);
  panel.append(head);

  // ---------- Always-available facts ----------
  const facts = document.createElement("dl");
  facts.className = "stats-facts";
  addFact(facts, "Values", prof.total.toLocaleString("en-US"));
  addFact(facts, "Missing", `${prof.missing}${prof.missing > 0 ? ` (${prof.missingPct.toFixed(1)}%)` : ""}`);
  addFact(facts, "Unique", `${prof.unique} (${prof.uniquePct.toFixed(1)}%)`);
  if (prof.isConstant) addFact(facts, "Notes", "Every value is identical");
  if (prof.type === "identifier") addFact(facts, "Notes", "Treated as an identifier — excluded from numeric statistics");
  panel.append(facts);

  // ---------- Numeric statistics ----------
  if (prof.stats) {
    const grid = document.createElement("div");
    grid.className = "stats-grid";
    const s = prof.stats;
    grid.append(
      statBox("Min", s.min), statBox("Max", s.max),
      statBox("Mean", s.mean), statBox("Median", s.median),
      statBox("Std dev", s.stdDev), statBox("Count", s.count),
    );
    panel.append(grid);

    // ---------- M8: spread metrics derived from the SAME stats object ----------
    const spread = document.createElement("div");
    spread.className = "stats-grid";
    const range = s.max - s.min;
    const iqr = s.q3 - s.q1;
    const cv = (s.stdDev !== null && s.stdDev !== undefined && s.mean !== 0)
      ? s.stdDev / Math.abs(s.mean) : null;
    spread.append(
      statBox("Range", range), statBox("IQR (Q3 − Q1)", iqr),
      statBox("Coeff. of variation", cv === null ? null : cv, true),
    );
    panel.append(spread);
    const spreadNote = document.createElement("p");
    spreadNote.className = "caption muted";
    spreadNote.textContent = cv === null
      ? "Coefficient of variation is undefined for a mean of 0."
      : "Coefficient of variation = std dev ÷ |mean| — relative spread, comparable across columns.";
    panel.append(spreadNote);

    if (prof.missing > 0) {
      const note = document.createElement("p");
      note.className = "caption muted";
      note.textContent = "Statistics are computed over non-missing values only.";
      panel.append(note);
    }
    return;
  }

  // ---------- Categorical / date / boolean / identifier ----------
  if (prof.topValues && prof.topValues.length > 0) {
    const sub = document.createElement("h4");
    sub.className = "overline";
    sub.textContent = "Most common values";
    panel.append(sub);

    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "data-table";

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th scope='col'>Value</th><th scope='col' class='num'>Count</th><th scope='col' class='num'>Share</th></tr>";
    table.append(thead);

    const tbody = document.createElement("tbody");
    const totalPresent = prof.total - prof.missing;
    for (const { value, count } of prof.topValues) {
      const tr = document.createElement("tr");
      const tdV = document.createElement("td");
      tdV.textContent = value === "" ? "(empty)" : value;
      const tdC = document.createElement("td");
      tdC.className = "num mono";
      tdC.textContent = String(count);
      const tdS = document.createElement("td");
      tdS.className = "num mono";
      tdS.textContent = totalPresent > 0 ? ((count / totalPresent) * 100).toFixed(1) + "%" : "—";
      tr.append(tdV, tdC, tdS);
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    panel.append(wrap);

    if (prof.mode !== null && prof.mode !== undefined) {
      const note = document.createElement("p");
      note.className = "caption muted";
      note.textContent = `Mode (most frequent value): ${prof.mode}`;
      panel.append(note);
    }

    // ---------- M8: top-category concentration (§7/§23) ----------
    const present = prof.total - prof.missing;
    const top = (prof.topValues ?? [])[0];
    if (top && present > 0) {
      const share = top.count / present;
      const conc = document.createElement("p");
      conc.className = "caption muted";
      conc.textContent = share >= 0.7
        ? `Top-category concentration: "${top.value}" accounts for ${Math.round(share * 100)}% of non-missing values — a heavily concentrated distribution.`
        : `Top-category concentration: "${top.value}" accounts for ${Math.round(share * 100)}% of non-missing values.`;
      panel.append(conc);
    }
  }
}

function addFact(dl, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dd.className = "mono";
  dl.append(dt, dd);
}

function statBox(label, value, asRatio = false) {
  const box = document.createElement("div");
  box.className = "stats-box";
  const l = document.createElement("span");
  l.className = "caption muted";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "stats-box-num mono";
  v.textContent = asRatio && typeof value === "number" ? `${(value * 100).toFixed(0)}%` : formatNum(value);
  box.append(l, v);
  return box;
}

function formatNum(v) {
  if (v === null || v === undefined) return "—";
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
