/* ============================================================
   CSVette — report.js
   Generates the standalone Data Quality Report (Milestone 7).

   Design rules enforced here:
   • It REUSES the existing engine's outputs (profile, quality,
     health) — the scoring methodology is NOT duplicated; the
     report only presents dimension values, weights and details
     that computeHealth already produces (§16).
   • Every dataset-derived string is HTML-escaped (§23). There is
     no path where cell values, column names or file names reach
     the HTML unescaped. The report must never execute data.
   • Self-contained: one HTML string, embedded CSS, no CDN, no
     external fonts, no JavaScript — works offline and prints
     well (§22, §25). Deliberately light "Paper" styling only.
   • Summary data only — the full dataset is never embedded (§31).
   No DOM calls in this module, so it is unit-testable in Node.
   ============================================================ */

import { profileDataset } from "./data-profile.js";

/* ---------- escaping & formatting ---------- */

/** Escape a value for safe interpolation into HTML text/attributes (§23). */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Deterministic number formatting: up to `d` decimals, no locale surprises. */
function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const s = Number(n).toFixed(d);
  return s.replace(/\.?0+$/, "") || "0";
}

function pct(n) {
  return `${fmt(n, 1)}%`;
}

/** Cap a list for display, stating the truncation honestly (§18). */
function capList(items, render, max = 12) {
  const shown = items.slice(0, max).map(render).join(", ");
  return items.length > max
    ? `${shown} … and ${items.length - max} more`
    : shown;
}

const TYPE_LABELS = {
  integer: "Whole number",
  float: "Number",
  categorical: "Category",
  string: "Text",
  date: "Date",
  boolean: "Boolean",
  identifier: "Identifier",
  empty: "Empty",
};

/* ---------- report sections ---------- */

function summarySection(dataset, profile) {
  const tc = profile.typeCounts ?? {};
  const num = (tc.integer ?? 0) + (tc.float ?? 0);
  const rows = [
    ["Rows", profile.rowCount],
    ["Columns", profile.columnCount],
    ["Total cells", profile.totalCells],
    ["Missing cells", profile.missingCells],
    ["Duplicate rows", profile.duplicateRows],
    ["Numeric columns", num],
    ["Categorical / text columns", (tc.categorical ?? 0) + (tc.string ?? 0)],
    ["Date columns", tc.date ?? 0],
    ["Boolean columns", tc.boolean ?? 0],
    ["Identifier columns", tc.identifier ?? 0],
  ];
  return `<dl class="summary-grid">${rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>`;
}

function qualitySection(health) {
  const dims = Object.entries(health.dimensions)
    .map(([key, d]) => {
      const contribution = Math.round(((d.value ?? 0) * (d.weight ?? 0)) / 100 * 10) / 10;
      const width = Math.max(0, Math.min(100, d.value ?? 0));
      return `<tr>
        <th scope="row">${escapeHtml(key)}</th>
        <td class="num">${fmt(d.value, 1)}</td>
        <td class="num">${d.weight}%</td>
        <td class="num">${fmt(contribution, 1)} pts</td>
        <td>${escapeHtml(d.detail ?? "")}</td>
        <td class="bar-cell"><span class="bar" data-v="${width}"><span style="width:${width}%"></span></span></td>
      </tr>`;
    })
    .join("");
  const totalContrib = Object.values(health.dimensions)
    .reduce((n, d) => n + ((d.value ?? 0) * (d.weight ?? 0)) / 100, 0);
  return `
  <p class="score-line"><span class="score">${health.score}</span> / 100 —
    <span class="chip chip-${health.band}">${health.band}</span>
  </p>
  <table class="report-table">
    <thead><tr><th>Dimension</th><th class="num">Score</th><th class="num">Weight</th><th class="num">Contributes</th><th>Detail</th><th></th></tr></thead>
    <tbody>${dims}</tbody>
  </table>
  <p class="caption">Overall score = (30 × completeness + 20 × uniqueness + 25 × consistency + 25 × validity) ÷ 100,
  rounded. Each dimension starts at 100 and is reduced by the issues listed in this report:
  the contributions above sum to ${fmt(totalContrib, 1)} before rounding. Band thresholds: ≥85 good, ≥50 fair, below 50 poor.</p>`;
}

function sectionShell(id, title, severity, bodyHtml) {
  const chip = severity === "clear"
    ? `<span class="chip chip-good">All clear</span>`
    : `<span class="chip chip-${severity}">${severity}</span>`;
  return `<section class="finding" id="${id}">
    <h3>${escapeHtml(title)} ${chip}</h3>
    ${bodyHtml}
  </section>`;
}

function findingsSections(profile, quality) {
  const parts = [];

  /* — Missing values — */
  const md = quality.missingDetails ?? [];
  if (md.length > 0) {
    const rows = md.map((d) => {
      const tokens = Object.entries(d.tokens ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `"${t}" ×${n}`)
        .join(", ");
      return `<tr><th scope="row">${escapeHtml(d.name)}</th><td class="num">${d.missing}</td>
        <td class="num">${pct(d.missingPct)}</td><td>${escapeHtml(tokens || "—")}</td></tr>`;
    }).join("");
    parts.push(sectionShell("missing", "Missing values", "warning",
      `<table class="report-table"><thead><tr><th>Column</th><th class="num">Missing</th><th class="num">Share</th><th>Placeholder tokens</th></tr></thead><tbody>${rows}</tbody></table>
       <p class="caption">Empty cells, and tokens such as N/A, NULL or ?, count as missing — the same definition the app uses everywhere.</p>`));
  } else {
    parts.push(sectionShell("missing", "Missing values", "clear", `<p>No missing values were detected.</p>`));
  }

  /* — Duplicates — */
  const dupCount = profile.duplicateRows ?? 0;
  const groups = quality.duplicateGroups ?? [];
  if (dupCount > 0) {
    const groupHtml = capList(groups, (g) => {
      return `<li>Row ${g.rows[0]} = row ${g.rows.slice(1).join(", ")} <span class="muted">(${escapeHtml(g.preview.join(" · "))})</span></li>`;
    }, 8);
    parts.push(sectionShell("duplicates", "Duplicate rows", "warning",
      `<p>${dupCount} duplicate row${dupCount === 1 ? "" : "s"} (exact matches on every column).</p><ul class="plain-list">${groupHtml}</ul>`));
  } else {
    parts.push(sectionShell("duplicates", "Duplicate rows", "clear", `<p>No duplicate rows were detected.</p>`));
  }

  /* — Potential outliers — */
  const od = quality.outlierDetails ?? [];
  if (od.length > 0) {
    const rows = od.map((d) => `<tr><th scope="row">${escapeHtml(d.name)}</th>
      <td class="num">${fmt(d.lower, 2)} – ${fmt(d.upper, 2)}</td>
      <td class="num">${d.outliers.length}</td>
      <td>${escapeHtml(capList(d.outliers, (o) => `${fmt(o.value, 2)} (row ${o.rowNum})`))}</td></tr>`).join("");
    parts.push(sectionShell("outliers", "Potential outliers", "info",
      `<table class="report-table"><thead><tr><th>Column</th><th class="num">Usual range (1.5 × IQR fences)</th><th class="num">Count</th><th>Values</th></tr></thead><tbody>${rows}</tbody></table>
       <p class="caption">“Potential outliers” are values outside the 1.5 × IQR fences — unusual values worth reviewing, not necessarily errors.</p>`));
  } else {
    parts.push(sectionShell("outliers", "Potential outliers", "clear", `<p>No potential outliers were detected (IQR method).</p>`));
  }

  /* — Consistency (category variants + constant columns) — */
  const vg = quality.variantGroups ?? [];
  const constants = (quality.findings ?? []).find((f) => f.type === "constant-columns");
  if (vg.length > 0 || constants) {
    let body = "";
    if (vg.length > 0) {
      const blocks = vg.map((g) => {
        const clusters = g.clusters.map((c) => {
          const variants = c.variants.map((v) => `"${v.value}" ×${v.count}`).join(" · ");
          return `<li>${escapeHtml(variants)}</li>`;
        }).join("");
        return `<li><strong>${escapeHtml(g.name)}</strong><ul class="plain-list">${clusters}</ul></li>`;
      }).join("");
      body += `<p>These columns may use inconsistent spellings (case or abbreviation differences). Values are flagged, not judged:</p><ul class="plain-list">${blocks}</ul>`;
    }
    if (constants) {
      // Constant-column names come straight from the profile — never parsed
      // out of finding descriptions.
      const names = constants.columns.map((id) => profile.byColumn[id]?.name ?? id);
      body += `<p>Constant columns (every value identical): ${names.map((n) => `"${escapeHtml(n)}"`).join(", ")}.</p>`;
    }
    parts.push(sectionShell("consistency", "Consistency", "warning", body));
  } else {
    parts.push(sectionShell("consistency", "Consistency", "clear", `<p>No category inconsistencies or constant columns were detected.</p>`));
  }

  /* — Type issues — */
  const tv = quality.typeViolations ?? [];
  if (tv.length > 0) {
    const blocks = tv.map((d) => {
      const values = capList(d.violations, (v) => `"${v.value}" (row ${v.rowNum})`);
      return `<li><strong>${escapeHtml(d.name)}</strong> — expected ${escapeHtml(TYPE_LABELS[d.inferredType] ?? d.inferredType)}: ${escapeHtml(values)}${d.truncated ? " … (list capped at 20 per column)" : ""}</li>`;
    }).join("");
    parts.push(sectionShell("types", "Type issues", "warning",
      `<ul class="plain-list">${blocks}</ul><p class="caption">These values don't fit the column's inferred type. Types are inferred conservatively from the values themselves.</p>`));
  } else {
    parts.push(sectionShell("types", "Type issues", "clear", `<p>No type violations were detected.</p>`));
  }

  /* — Identifier issues — */
  const dupIds = quality.dupIdDetails ?? [];
  if (dupIds.length > 0) {
    const blocks = dupIds.map((d) => {
      const repeats = capList(d.repeats, (r) => `"${r.value}" appears ${r.count}× (rows ${r.rows.slice(0, 8).join(", ")}${r.rows.length > 8 ? "…" : ""})`, 8);
      return `<li><strong>${escapeHtml(d.name)}</strong>: ${escapeHtml(repeats)}</li>`;
    }).join("");
    parts.push(sectionShell("identifiers", "Identifier issues", "warning",
      `<ul class="plain-list">${blocks}</ul><p class="caption">Identifier-like columns are usually expected to be unique.</p>`));
  } else {
    parts.push(sectionShell("identifiers", "Identifier issues", "clear", `<p>No identifier issues were detected.</p>`));
  }

  return parts.join("\n");
}

function columnProfileTable(profile) {
  const cols = Object.values(profile.byColumn);
  const maxCols = 60; // keep the report readable for very wide datasets
  const head = `<thead><tr><th>Column</th><th>Type</th><th class="num">Missing</th><th class="num">Missing %</th>
    <th class="num">Unique</th><th class="num">Unique %</th><th>Statistics</th></tr></thead>`;
  const body = cols.slice(0, maxCols).map((p) => {
    let stats = "—";
    if (p.stats) {
      stats = `min ${fmt(p.stats.min)} · max ${fmt(p.stats.max)} · mean ${fmt(p.stats.mean)} · median ${fmt(p.stats.median)}`;
    } else if (p.mode !== null && p.mode !== undefined) {
      const freq = (p.topValues ?? []).find((t) => t.value === p.mode);
      stats = `most common: "${p.mode}"${freq ? ` ×${freq.count}` : ""}`;
    }
    return `<tr><th scope="row">${escapeHtml(p.name)}</th><td>${escapeHtml(TYPE_LABELS[p.type] ?? p.type)}</td>
      <td class="num">${p.missing}</td><td class="num">${pct(p.missingPct)}</td>
      <td class="num">${p.unique}</td><td class="num">${pct(p.uniquePct)}</td>
      <td>${escapeHtml(stats)}</td></tr>`;
  }).join("");
  const note = cols.length > maxCols
    ? `<p class="caption">Showing the first ${maxCols} of ${cols.length} columns.</p>`
    : "";
  return `<table class="report-table">${head}<tbody>${body}</tbody></table>${note}`;
}

function historySection(history) {
  if (!history || history.length === 0) {
    return `<p>No cleaning operations were performed.</p>`;
  }
  const items = history.map((h, i) => {
    const time = h.time instanceof Date ? h.time.toISOString().replace("T", " ").slice(0, 16) : "";
    return `<li><span class="step">${i + 1}.</span> ${escapeHtml(h.label)}${h.detail ? ` <span class="muted">— ${escapeHtml(h.detail)}</span>` : ""}${time ? ` <span class="muted mono">(${time})</span>` : ""}</li>`;
  }).join("");
  return `<ol class="history-list">${items}</ol>`;
}

function beforeAfterSection(original, working, profileWorking) {
  if (!original) return "";
  // Original metrics are computed fresh from the untouched original —
  // never invented, never mutated (§20).
  const profileOriginal = profileDataset(original);
  const rows = [
    ["Rows", profileOriginal.rowCount, profileWorking.rowCount],
    ["Columns", profileOriginal.columnCount, profileWorking.columnCount],
    ["Missing cells", profileOriginal.missingCells, profileWorking.missingCells],
    ["Duplicate rows", profileOriginal.duplicateRows, profileWorking.duplicateRows],
  ];
  return `<table class="report-table compare">
    <thead><tr><th></th><th class="num">Original</th><th class="num">Working</th></tr></thead>
    <tbody>${rows.map(([k, a, b]) => `<tr><th scope="row">${escapeHtml(k)}</th><td class="num">${a}</td><td class="num">${b}</td></tr>`).join("")}</tbody>
  </table>`;
}

/* ---------- document assembly ---------- */

export function buildQualityReportHtml({ fileName, original, working, profile, quality, health, history, generatedAt }) {
  const when = generatedAt instanceof Date
    ? generatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    : String(generatedAt ?? "");
  const ops = history?.length ?? 0;

  const context = ops === 0
    ? `This report describes the current working dataset, which matches the original uploaded file.`
    : `This report describes the cleaned <strong>working dataset</strong> (${ops} cleaning operation${ops === 1 ? "" : "s"} applied). The original uploaded dataset remains unchanged in CSVette.`;

  const beforeAfter = ops > 0 ? beforeAfterSection(original, working, profile) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data Quality Report — ${escapeHtml(fileName)}</title>
<style>
  :root {
    --bg: #F6F7F8; --surface: #FFFFFF; --surface-2: #EFF1F3;
    --border: #E2E5E9; --border-strong: #CBD1D8;
    --text: #191D21; --text-2: #454C54; --text-3: #6B727B;
    --accent: #0F766E; --accent-soft: #E4F2F0;
    --good: #067647; --warning: #B54708; --critical: #B42318; --info: #175CD3;
    --tint-good: #ECFDF3; --tint-warning: #FFFAEB; --tint-critical: #FEF3F2; --tint-info: #EFF8FF;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 15px/1.55 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 40px 16px 64px;
  }
  main { max-width: 900px; margin: 0 auto; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 28px 32px; margin-bottom: 20px;
  }
  .brand { font-weight: 600; letter-spacing: 0.02em; }
  .brand span { color: var(--accent); }
  .overline {
    font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--text-3); font-weight: 600;
  }
  h1 { font-size: 26px; font-weight: 600; margin: 4px 0 2px; }
  h2 { font-size: 18px; font-weight: 600; margin: 0 0 14px; }
  h3 { font-size: 15px; font-weight: 600; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
  .muted { color: var(--text-2); }
  .mono { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  .caption { font-size: 13px; color: var(--text-3); margin-top: 10px; }
  .context-line { margin-top: 10px; font-size: 14px; color: var(--text-2); }
  .meta { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }

  /* summary grid — definition list, not dashboard cards */
  .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px 18px; margin: 0; }
  .summary-grid dt { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-3); font-weight: 600; }
  .summary-grid dd { font-size: 22px; font-weight: 600; font-family: ui-monospace, "SF Mono", Consolas, monospace; margin: 2px 0 0; }

  /* score */
  .score-line { font-size: 15px; margin-bottom: 16px; }
  .score { font-size: 44px; font-weight: 600; font-family: ui-monospace, "SF Mono", Consolas, monospace; color: var(--accent); vertical-align: -6px; margin-right: 6px; }
  .chip { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 999px; padding: 3px 10px; }
  .chip-good { background: var(--tint-good); color: var(--good); }
  .chip-warning, .chip-fair { background: var(--tint-warning); color: var(--warning); }
  .chip-critical, .chip-poor { background: var(--tint-critical); color: var(--critical); }
  .chip-info { background: var(--tint-info); color: var(--info); }
  .bar-cell { width: 90px; }
  .bar { display: block; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); border-radius: 3px; }

  /* tables */
  .report-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .report-table th, .report-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .report-table thead th { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-3); border-bottom: 1px solid var(--border-strong); }
  .report-table tbody th { font-weight: 500; }
  .report-table .num { text-align: right; font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 13px; white-space: nowrap; }
  .report-table.compare { max-width: 420px; }

  .finding { border-top: 1px solid var(--border); padding-top: 16px; margin-top: 16px; }
  .finding:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
  .plain-list { margin: 6px 0 0; padding-left: 18px; }
  .plain-list li { margin: 4px 0; }
  .history-list { margin: 0; padding-left: 0; list-style: none; }
  .history-list li { padding: 7px 0; border-bottom: 1px solid var(--border); }
  .history-list .step { color: var(--text-3); margin-right: 6px; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  footer { text-align: center; color: var(--text-3); font-size: 13px; }

  @media (max-width: 640px) {
    .card { padding: 20px 16px; }
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
    .bar-cell { display: none; }
    /* Wide tables scroll inside their card instead of stretching the page. */
    .report-table { display: block; overflow-x: auto; }
  }
  @media print {
    body { background: #FFFFFF; padding: 0; font-size: 12px; }
    .card { border: 0; border-radius: 0; padding: 12px 0; margin-bottom: 12px; page-break-inside: avoid; }
    .report-table { page-break-inside: auto; }
    .report-table tr { page-break-inside: avoid; }
    h2, h3 { page-break-after: avoid; }
    .score { font-size: 32px; }
  }
</style>
</head>
<body>
<main>

  <header class="card">
    <div class="brand">CSV<span>ette</span></div>
    <p class="overline">Data Quality Report</p>
    <h1>${escapeHtml(fileName)}</h1>
    <p class="muted">Generated ${escapeHtml(when)} · ${profile.rowCount} rows × ${profile.columnCount} columns</p>
    <p class="context-line">${context}</p>
  </header>

  <section class="card">
    <h2>Overall quality</h2>
    ${qualitySection(health)}
  </section>

  <section class="card">
    <h2>Data quality findings</h2>
    ${findingsSections(profile, quality)}
  </section>

  <section class="card">
    <h2>Dataset summary</h2>
    ${summarySection(working, profile)}
  </section>

  <section class="card">
    <h2>Column profile</h2>
    ${columnProfileTable(profile)}
  </section>

  ${ops > 0 ? `
  <section class="card">
    <h2>Before / after cleaning</h2>
    ${beforeAfter}
  </section>` : ""}

  <section class="card">
    <h2>Cleaning history</h2>
    ${historySection(history)}
  </section>

  <footer>
    <p>Generated entirely in your browser by CSVette — no data left this device.</p>
  </footer>

</main>
</body>
</html>`;
}
