/* ============================================================
   CSVette — views/placeholder.js
   For sections whose engines arrive in later milestones. Real
   navigation, honest content: never a broken page or a dead link.
   ============================================================ */

const SECTION_INFO = {
  health: {
    title: "Health Summary",
    icon: "M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z",
    text: "A transparent health score across completeness, uniqueness, consistency, and validity — with the full methodology visible.",
    milestone: "Milestone 3",
  },
  missing: {
    title: "Missing Values",
    icon: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    text: "Per-column missing counts, percentages, and the tokens CSVette treats as missing (NULL, N/A, ?…).",
    milestone: "Milestone 3",
  },
  duplicates: {
    title: "Duplicates",
    icon: "M16 3h5v5 M8 3H3v5 M12 8v8 M8 21h8",
    text: "Exact duplicate rows, grouped for review, with a safe one-click removal.",
    milestone: "Milestone 3",
  },
  outliers: {
    title: "Outliers",
    icon: "M4 14h16 M8 14V8 M16 14v-4 M12 14v2",
    text: "IQR-based potential-outlier detection for numeric columns — always labelled “potential”, never “wrong”.",
    milestone: "Milestone 4",
  },
  consistency: {
    title: "Consistency",
    icon: "M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3",
    text: "Inconsistent category representations, like “Pakistan / pakistan / PAKISTAN / Pak”, surfaced for review.",
    milestone: "Milestone 3",
  },
  types: {
    title: "Type Issues",
    icon: "M4 7V4h16v3 M9 20h6 M12 4v16",
    text: "Values that don't fit their column's inferred type, like “twenty-two” in an age column.",
    milestone: "Milestone 3",
  },
  identifiers: {
    title: "Identifier Issues",
    icon: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    text: "Detected ID columns and repeated identifiers — kept out of numeric analysis on purpose.",
    milestone: "Milestone 3",
  },
  charts: {
    title: "Charts",
    icon: "M3 3v16a2 2 0 0 0 2 2h16 M18 17V9 M13 17V5 M8 17v-3",
    text: "Recommended charts from your actual columns, plus a manual builder with validation.",
    milestone: "Milestone 5",
  },
  correlations: {
    title: "Correlations",
    icon: "M3 3h18v18H3z M8 8h8v8H8z",
    text: "Correlation matrix for numeric columns, with scatter drill-down — and the reminder that correlation is not causation.",
    milestone: "Milestone 5",
  },
  clean: {
    title: "Clean Data",
    icon: "m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21 M22 21H7",
    text: "Non-destructive cleaning on a working copy: remove duplicates, fill missing values, trim, rename, and more.",
    milestone: "Milestone 6",
  },
  history: {
    title: "History",
    icon: "M3 3v5h5 M3.05 13a9 9 0 1 0 .5-5.5L3 8 M12 7v5l4 2",
    text: "Every cleaning operation, before/after counts, and undo.",
    milestone: "Milestone 6",
  },
  "export-csv": {
    title: "Export CSV",
    icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
    text: "Download the original, cleaned, or filtered dataset.",
    milestone: "Milestone 6",
  },
  report: {
    title: "Data Quality Report",
    icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
    text: "A shareable HTML report: summary, health score, findings, and column statistics.",
    milestone: "Milestone 6",
  },
};

/** Render a placeholder screen for a not-yet-implemented route. */
export function renderPlaceholder(container, route) {
  const info = SECTION_INFO[route] ?? {
    title: route, icon: "M12 8v4 M12 16h.01",
    text: "This section arrives in a later milestone.", milestone: "Later",
  };

  container.replaceChildren();

  const card = document.createElement("div");
  card.className = "empty-state placeholder-card";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of info.icon.split(" M")) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d.startsWith("M") ? d : "M" + d);
    svg.append(path);
  }

  const title = document.createElement("h3");
  title.className = "h2";
  title.textContent = info.title;

  const text = document.createElement("p");
  text.textContent = info.text;

  const pill = document.createElement("span");
  pill.className = "chip";
  pill.textContent = `Arrives in ${info.milestone}`;

  card.append(svg, title, text, pill);
  container.append(card);
}
