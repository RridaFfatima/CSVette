/* ============================================================
   CSVette — views/health.js
   The Data Health screens. Every screen renders ONLY from the
   quality engine's results (state.quality / state.health) —
   no recomputation here. The engine chooses the wording (e.g.
   "potential" outliers), so views can never overstate certainty.

   Deep-link rule (UX §29): every row reference opens the Data
   Table at that row: #/table?rows=27&col=age
   ============================================================ */

import { el } from "../dom.js";
import { getState } from "../state.js";
import { navigate } from "../router.js";

/* ---------- Shared pieces ---------- */

const SEV_ICONS = {
  critical: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  warning: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 16v-4 M12 8h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
  ok: "M20 6 9 17l-5-5",
};

const SEV_LABELS = { critical: "Critical", warning: "Warning", info: "Info", ok: "Healthy" };

/** Severity pill: icon + label + (optional) count — never color alone. */
function sevPill(sev, count) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", SEV_ICONS[sev] ?? SEV_ICONS.info);
  svg.append(path);

  const pill = el("span", { class: `sev sev-${sev}` }, [
    svg,
    el("span", { class: "sr-only" }, [`${SEV_LABELS[sev]}: `]),
    SEV_LABELS[sev],
  ]);
  if (count !== undefined && count !== null) {
    pill.append(el("span", { class: "sev-count mono" }, [` ${count}`]));
  }
  return pill;
}

/**
 * Screen header: title, severity pill, and the engine's own description
 * (so screen wording always matches the findings and the sidebar badge).
 */
function findingHead(container, { title, sev, count, description, allClear = false }) {
  const head = el("section", { class: "card card-pad finding-head" });
  const top = el("div", { class: "finding-head-top" }, [
    el("h2", { class: "h2" }, [title]),
    sevPill(sev, allClear ? undefined : count),
  ]);
  const desc = el("p", { class: "finding-desc" }, [description]);
  head.append(top, desc);
  container.append(head);
}

/** The "nothing found" state — a real designed state, not blank space. */
function allClear(container, title, message) {
  const card = el("section", { class: "card card-pad all-clear" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", SEV_ICONS.ok);
  svg.append(path);

  card.append(
    svg,
    el("h2", { class: "h3" }, [title]),
    el("p", { class: "finding-desc muted" }, [message]),
  );
  container.append(card);
}

/** "Review rows in the Data Table" deep link. */
function rowsLink(rowNums, colId = null, label = null) {
  const rows = [...new Set(rowNums)].sort((a, b) => a - b);
  const n = rows.length;
  return el("button", {
    class: "btn btn-secondary btn-sm",
    type: "button",
    onClick: () => navigate("table", { rows: rows.join(","), col: colId ?? undefined }),
  }, [label ?? `Review ${n === 1 ? "this row" : `these ${n} rows`} in the table →`]);
}

function mono(v) {
  return el("span", { class: "mono" }, [String(v)]);
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

/* ============================================================
   1. Health Summary
   ============================================================ */

export function renderHealth(container) {
  const { health } = getState();
  container.replaceChildren();

  // Score card: the number, the band, and the transparent methodology.
  const score = el("section", { class: "card card-pad health-score" });
  const left = el("div", { class: "health-score-main" }, [
    el("div", { class: "health-score-num mono" }, [String(health.score)]),
    el("div", { class: "health-score-side" }, [
      sevPill(health.band === "good" ? "ok" : health.band === "fair" ? "warning" : "critical"),
      el("span", { class: "caption muted" }, [`out of 100 · ${health.band}`]),
    ]),
  ]);

  const dims = el("div", { class: "health-dims" });
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
  score.append(left, dims);
  container.append(score);

  // "How this is calculated" — the breakdown rendered verbatim.
  const method = el("section", { class: "card card-pad" });
  method.append(
    el("h3", { class: "h3" }, ["How this is calculated"]),
    el("p", { class: "caption muted" }, [
      "Each dimension starts at 100 and loses points for the issues found below. ",
      "The overall score is the weighted average — no hidden rules.",
    ]),
  );

  const table = el("table", { class: "data-table health-breakdown" });
  table.innerHTML = `
    <thead><tr>
      <th scope="col">Dimension</th><th scope="col" class="num">Weight</th>
      <th scope="col" class="num">Points</th><th scope="col">Why</th>
    </tr></thead>`;
  const tbody = el("tbody");
  for (const row of health.breakdown) {
    tbody.append(
      el("tr", {}, [
        el("td", {}, [row.rule]),
        el("td", { class: "num mono" }, [`/ ${row.max}`]),
        el("td", { class: "num mono" }, [`${row.points}`]),
        el("td", { class: "caption muted" }, [row.reason]),
      ]),
    );
  }
  table.append(tbody);
  const wrap = el("div", { class: "table-scroll" }, [table]);
  method.append(wrap);
  container.append(method);
}

/* ============================================================
   2. Missing Values
   ============================================================ */

export function renderMissing(container, params = {}) {
  const { quality } = getState();
  container.replaceChildren();

  const details = quality?.missingDetails ?? [];
  const finding = (quality?.findings ?? []).find((f) => f.type === "missing-values");

  if (details.length === 0) {
    allClear(container, "No missing values",
      "Every cell contains a value — nothing was left empty and no missing-value placeholders (NULL, N/A, ?) were found.");
    return;
  }

  findingHead(container, {
    title: "Missing values",
    sev: finding?.severity ?? "warning",
    count: finding?.count ?? 0,
    description: finding?.description ?? "",
  });

  for (const d of details) {
    const tokens = Object.entries(d.tokens);
    const card = el("section", { class: "card card-pad" });

    card.append(
      el("div", { class: "finding-col-head" }, [
        el("h3", { class: "h3 mono" }, [d.name]),
        el("span", { class: "chip" }, [d.type]),
      ]),
      el("p", { class: "finding-col-meta" }, [
        `${d.missing} of ${d.total} values missing (${pct(d.missing, d.total)})`,
      ]),
    );

    // How the missing values are written in the file (helps cleaning later).
    if (tokens.length > 0) {
      const tokenRow = el("div", { class: "token-row" });
      tokenRow.append(el("span", { class: "caption muted" }, ["Found as: "]));
      for (const [token, count] of tokens) {
        tokenRow.append(
          el("span", { class: "chip chip-mono" }, [
            token === "(empty)" ? "empty cell" : token,
            ` × ${count}`,
          ]),
        );
      }
      card.append(tokenRow);
    }

    card.append(
      el("div", { class: "finding-actions" }, [
        rowsLink(d.sampleRows, d.columnId),
      ]),
    );
    container.append(card);
  }
}

/* ============================================================
   3. Duplicates
   ============================================================ */

export function renderDuplicates(container) {
  const { quality } = getState();
  container.replaceChildren();

  const groups = quality?.duplicateGroups ?? [];
  const finding = (quality?.findings ?? []).find((f) => f.type === "duplicate-rows");

  if (groups.length === 0) {
    allClear(container, "No duplicate rows",
      "Every row in this dataset is unique — no exact copies were found.");
    return;
  }

  findingHead(container, {
    title: "Duplicate rows",
    sev: finding?.severity ?? "warning",
    count: finding?.count ?? 0,
    description: finding?.description ?? "",
  });

  for (const [i, group] of groups.entries()) {
    const card = el("section", { class: "card card-pad" });
    card.append(
      el("div", { class: "finding-col-head" }, [
        el("h3", { class: "h3" }, [`Group ${i + 1} · ${group.rows.length} identical rows`]),
      ]),
    );

    const preview = el("p", { class: "finding-col-meta" }, ["Matching on: "]);
    for (const [j, v] of group.preview.entries()) {
      if (j > 0) preview.append(", ");
      preview.append(mono(truncate(v, 24)));
    }
    if (group.preview.length < 4) preview.append(" …");
    card.append(preview);

    card.append(
      el("div", { class: "finding-actions" }, [
        rowsLink(group.rows, null, `Review rows ${group.rows.join(", ")} in the table →`),
      ]),
    );
    container.append(card);
  }

  const note = el("p", { class: "caption muted" }, [
    "Only exact copies count as duplicates here. Two rows that differ in a single cell are treated as distinct records.",
  ]);
  container.append(note);
}

/* ============================================================
   4. Outliers — always "potential", never "errors"
   ============================================================ */

export function renderOutliers(container) {
  const { quality } = getState();
  container.replaceChildren();

  const details = quality?.outlierDetails ?? [];
  const finding = (quality?.findings ?? []).find((f) => f.type === "outliers");

  if (details.length === 0) {
    allClear(container, "No potential outliers",
      "No values fall outside the expected range (1.5 × IQR beyond the quartiles) in any numeric column.");
    return;
  }

  findingHead(container, {
    title: "Potential outliers",
    sev: finding?.severity ?? "info",
    count: finding?.count ?? 0,
    description: finding?.description ?? "",
  });

  const explain = el("div", { class: "alert alert-info iqr-explain" }, [
    el("p", {}, [
      "A value is flagged when it sits more than 1.5 × IQR beyond the first or third quartile — a standard",
      " statistical rule of thumb. A flagged value may be a typo, but it may also be a real, unusual",
      " observation. Review before deciding.",
    ]),
  ]);
  container.append(explain);

  for (const d of details) {
    const card = el("section", { class: "card card-pad" });
    card.append(
      el("div", { class: "finding-col-head" }, [
        el("h3", { class: "h3 mono" }, [d.name]),
        el("span", { class: "chip" }, [`${d.outliers.length} potential`]),
      ]),
    );

    // Transparent IQR math — the user can verify every number.
    const math = el("div", { class: "iqr-box mono" }, [
      el("span", {}, [`Q1 = ${fmtNum(d.q1)}`]),
      el("span", {}, [`Q3 = ${fmtNum(d.q3)}`]),
      el("span", {}, [`IQR = ${fmtNum(d.iqr)}`]),
      el("span", {}, [`fences: [${fmtNum(d.lower)}, ${fmtNum(d.upper)}]`]),
    ]);
    card.append(math);

    const list = el("div", { class: "token-row" });
    for (const o of d.outliers) {
      const link = el("button", {
        class: "chip chip-mono chip-link",
        type: "button",
        onClick: () => navigate("table", { rows: String(o.rowNum), col: d.columnId }),
      }, [
        `${fmtNum(o.value)} · row ${o.rowNum} ↗`,
      ]);
      list.append(link);
    }
    card.append(list);

    card.append(
      el("div", { class: "finding-actions" }, [
        rowsLink(d.outliers.map((o) => o.rowNum), d.columnId),
      ]),
    );
    container.append(card);
  }
}

/* ============================================================
   5. Consistency — categories + constant columns
   ============================================================ */

export function renderConsistency(container) {
  const { quality } = getState();
  container.replaceChildren();

  const groups = quality?.variantGroups ?? [];
  const catFinding = (quality?.findings ?? []).find((f) => f.type === "category-inconsistency");
  const constFinding = (quality?.findings ?? []).find((f) => f.type === "constant-columns");
  const constCols = constFinding
    ? Object.values(getState().profile.byColumn).filter(
        (p) => p.isConstant && constFinding.columns.includes(p.columnId))
    : [];

  if (groups.length === 0 && constCols.length === 0) {
    allClear(container, "No consistency issues",
      "Category columns use consistent spellings, and no column repeats a single value throughout.");
    return;
  }

  const sev = catFinding ? catFinding.severity : constFinding?.severity ?? "info";
  const count = (catFinding?.count ?? 0) + (constFinding?.count ?? 0);
  findingHead(container, {
    title: "Consistency",
    sev,
    count,
    description:
      (catFinding ? `${catFinding.description} ` : "") +
      (constFinding ? `${constFinding.description}.` : ""),
  });

  // --- Category variant clusters ---
  for (const g of groups) {
    const card = el("section", { class: "card card-pad" });
    card.append(
      el("div", { class: "finding-col-head" }, [
        el("h3", { class: "h3 mono" }, [g.name]),
        el("span", { class: "chip" }, [`${g.clusters.length} possible grouping${g.clusters.length === 1 ? "" : "s"}`]),
      ]),
    );

    for (const cluster of g.clusters) {
      const row = el("div", { class: "cluster" });
      row.append(el("span", { class: "caption muted cluster-label" }, ["Maybe the same category as:"]));
      for (const [j, v] of cluster.variants.entries()) {
        if (j > 0) row.append(el("span", { class: "cluster-sep" }, ["·"]));
        const chip = el("span", {
          class: "chip chip-mono" + (j === 0 ? "" : " chip-flag"),
        }, [`${v.value} × ${v.count}`]);
        row.append(chip);
      }
      card.append(row);
    }

    card.append(
      el("p", { class: "caption muted" }, [
        "Differences are flagged, not judged — \"U.K.\" and \"UK\" may both be correct in your data. ",
        "Normalization arrives with cleaning.",
      ]),
    );
    container.append(card);
  }

  // --- Constant columns ---
  for (const p of constCols) {
    const card = el("section", { class: "card card-pad" });
    card.append(
      el("div", { class: "finding-col-head" }, [
        el("h3", { class: "h3 mono" }, [p.name]),
        el("span", { class: "chip" }, ["constant"]),
      ]),
      el("p", { class: "finding-col-meta" }, [
        "Every non-empty value is ", mono(truncate(String(p.mode), 30)),
        " — this column carries no analytical signal.",
      ]),
    );
    container.append(card);
  }
}

/* ============================================================
   6. Type Issues
   ============================================================ */

export function renderTypes(container) {
  const { quality } = getState();
  container.replaceChildren();

  const details = quality?.typeViolations ?? [];
  const finding = (quality?.findings ?? []).find((f) => f.type === "type-issues");

  if (details.length === 0) {
    allClear(container, "No type issues",
      "Every value fits the type inferred for its column — numbers are numeric, dates are dates, booleans are boolean.");
    return;
  }

  findingHead(container, {
    title: "Type issues",
    sev: finding?.severity ?? "warning",
    count: finding?.count ?? 0,
    description: finding?.description ?? "",
  });

  for (const d of details) {
    const card = el("section", { class: "card card-pad" });
    card.append(
      el("div", { class: "finding-col-head" }, [
        el("h3", { class: "h3 mono" }, [d.name]),
        el("span", { class: "chip" }, [`inferred: ${d.inferredType}`]),
      ]),
    );

    const table = el("table", { class: "data-table violation-table" });
    table.innerHTML = `
      <thead><tr><th scope="col">Value</th><th scope="col" class="num">Row</th></tr></thead>`;
    const tbody = el("tbody");
    for (const v of d.violations) {
      tbody.append(
        el("tr", {}, [
          el("td", { class: "mono" }, [v.value]),
          el("td", { class: "num" }, [
            el("button", {
              class: "chip chip-mono chip-link",
              type: "button",
              onClick: () => navigate("table", { rows: String(v.rowNum), col: d.columnId }),
            }, [`row ${v.rowNum} ↗`]),
          ]),
        ]),
      );
    }
    table.append(tbody);
    card.append(el("div", { class: "table-scroll" }, [table]));

    if (d.truncated) {
      card.append(el("p", { class: "caption muted" }, [
        "Showing the first 20 violations — the count in the header covers the whole column.",
      ]));
    }

    card.append(
      el("div", { class: "finding-actions" }, [
        rowsLink(d.violations.map((v) => v.rowNum), d.columnId),
      ]),
    );
    container.append(card);
  }
}

/* ============================================================
   7. Identifier Issues
   ============================================================ */

export function renderIdentifiers(container) {
  const { quality, profile } = getState();
  container.replaceChildren();

  const idFinding = (quality?.findings ?? []).find((f) => f.type === "identifier-columns");
  const dupIdFinding = (quality?.findings ?? []).find((f) => f.type === "duplicate-identifiers");
  const dupIdDetails = quality?.dupIdDetails ?? [];
  const idCols = idFinding
    ? idFinding.columns.map((cid) => profile.byColumn[cid]).filter(Boolean)
    : [];

  if (!idFinding && dupIdDetails.length === 0) {
    allClear(container, "No identifier columns",
      "No column looks like an ID, reference number, or code in this dataset.");
    return;
  }

  findingHead(container, {
    title: "Identifier issues",
    sev: idFinding ? idFinding.severity : dupIdFinding.severity,
    count: (idFinding?.count ?? 0) + (dupIdFinding?.count ?? 0),
    description:
      (idFinding ? `${idFinding.description}. ` : "") +
      (dupIdFinding ? `${dupIdFinding.description}.` : ""),
  });

  // --- Detected identifier columns (info, not an error) ---
  if (idCols.length > 0) {
    for (const p of idCols) {
      const card = el("section", { class: "card card-pad" });
      card.append(
        el("div", { class: "finding-col-head" }, [
          el("h3", { class: "h3 mono" }, [p.name]),
          sevPill("info"),
        ]),
        el("p", { class: "finding-col-meta" }, [
          `${p.unique} unique values across ${p.total} rows (${p.uniquePct.toFixed(0)}% unique).`,
        ]),
        el("p", { class: "caption muted" }, [
          "CSVette treats this column as a label, not a measurement: it is excluded from statistics,",
          " outliers, and correlations so averages of IDs never appear in your analysis.",
        ]),
      );
      container.append(card);
    }
  }

  // --- Duplicate identifiers (the actual issue) ---
  for (const d of dupIdDetails) {
    const card = el("section", { class: "card card-pad" });
    card.append(
      el("div", { class: "finding-col-head" }, [
        el("h3", { class: "h3 mono" }, [d.name]),
        el("span", { class: "chip" }, ["repeated values"]),
      ]),
    );

    for (const r of d.repeats) {
      const row = el("div", { class: "cluster" }, [
        el("span", { class: "chip chip-mono chip-flag" }, [`${r.value} appears ${r.count}×`]),
      ]);
      row.append(rowsLink(r.rows, d.columnId, `rows ${r.rows.join(", ")} ↗`));
      card.append(row);
    }

    card.append(
      el("p", { class: "caption muted" }, [
        "IDs are usually expected to be unique. A repeat can mean a duplicated record, a data-entry",
        " slip, or a legitimately shared key (e.g. two line items on one order) — worth checking.",
      ]),
    );
    container.append(card);
  }
}

/* ---------- utils ---------- */

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
