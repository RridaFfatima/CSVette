/* ============================================================
   CSVette — views/shell.js
   The persistent workspace: sidebar (the UX spec's navigation),
   header, and the mount point views render into. Built once,
   then only badges/labels update as state changes.
   ============================================================ */

import { navigate } from "../router.js";

/* ---------- Navigation model (UX spec §4) ---------- */

const NAV = [
  {
    label: "Dataset", items: [
      { route: "overview", icon: "M3 3h18v18H3z M3 9h18 M9 21V9", label: "Overview" },
    ],
  },
  {
    label: "Data Health", items: [
      { route: "health", icon: "M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z", label: "Health Summary" },
      { route: "missing", icon: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", label: "Missing Values", countKey: "missing" },
      { route: "duplicates", icon: "M16 3h5v5 M8 3H3v5 M12 8v8 M8 21h8", label: "Duplicates", countKey: "duplicates" },
      { route: "outliers", icon: "M4 14h16 M8 14V8 M16 14v-4 M12 14v2", label: "Outliers", countKey: "outliers" },
      { route: "consistency", icon: "M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3", label: "Consistency", countKey: "consistency" },
      { route: "types", icon: "M4 7V4h16v3 M9 20h6 M12 4v16", label: "Type Issues", countKey: "types" },
      { route: "identifiers", icon: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7", label: "Identifier Issues" },
    ],
  },
  {
    label: "Explore", items: [
      { route: "table", icon: "M3 5h18v14H3z M3 10h18 M9 5v14", label: "Data Table" },
      { route: "stats", icon: "M18 20V10 M12 20V4 M6 20v-6", label: "Statistics" },
    ],
  },
  {
    label: "Visualize", items: [
      { route: "charts", icon: "M3 3v16a2 2 0 0 0 2 2h16 M18 17V9 M13 17V5 M8 17v-3", label: "Charts" },
      { route: "correlations", icon: "M3 3h18v18H3z M8 8h8v8H8z", label: "Correlations" },
    ],
  },
  {
    label: "Clean", items: [
      { route: "clean", icon: "m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21 M22 21H7", label: "Clean Data" },
      { route: "history", icon: "M3 3v5h5 M3.05 13a9 9 0 1 0 .5-5.5L3 8 M12 7v5l4 2", label: "History" },
    ],
  },
  {
    label: "Export", items: [
      { route: "export-csv", icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3", label: "CSV" },
      { route: "report", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8", label: "Data Quality Report" },
    ],
  },
];

let root = null;
let navRefs = new Map(); // route → { item, badge }

/** Split a multi-subpath icon string on " M" (uppercase only — never " m"). */
function splitIconPath(icon) {
  return icon.split(/(?= M)/).map(s => s.trim());
}

/** Build the shell once; returns { root, workspace, sidebar }. */
export function buildShell() {
  root = document.createElement("div");
  root.className = "workspace-root";

  // --- Sidebar ---
  const brand = document.createElement("div");
  brand.className = "side-brand";
  brand.innerHTML = '<span class="wordmark">CSV<span>ette</span></span>';

  const nav = document.createElement("nav");
  nav.className = "side-nav";
  nav.setAttribute("aria-label", "Dataset sections");

  for (const group of NAV) {
    const groupLabel = document.createElement("p");
    groupLabel.className = "overline side-group";
    groupLabel.textContent = group.label;
    nav.append(groupLabel);

    for (const item of group.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "side-item";
      btn.dataset.route = item.route;

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "1.8");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      icon.setAttribute("aria-hidden", "true");
      for (const d of splitIconPath(item.icon)) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        icon.append(path);
      }

      const label = document.createElement("span");
      label.className = "side-label";
      label.textContent = item.label;
      btn.append(icon, label);

      if (item.countKey) {
        const badge = document.createElement("span");
        badge.className = "side-count mono";
        badge.hidden = true;
        btn.append(badge);
        navRefs.set(item.route, { item: btn, badge });
      } else {
        navRefs.set(item.route, { item: btn, badge: null });
      }

      btn.addEventListener("click", () => navigate(item.route));
      nav.append(btn);
    }
  }

  const privacy = document.createElement("p");
  privacy.className = "side-privacy caption";
  privacy.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
    "Your data stays in your browser.";

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.id = "sidebar";
  sidebar.append(brand, nav, privacy);

  // --- Header ---
  const title = document.createElement("span");
  title.className = "ws-title h2";
  title.id = "ws-title";

  const chip = document.createElement("span");
  chip.className = "chip mono";
  chip.id = "ws-chip";

  const spacer = document.createElement("div");
  spacer.className = "ws-spacer";

  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "icon-btn ws-menu-btn";
  menuBtn.setAttribute("aria-label", "Open navigation menu");
  menuBtn.setAttribute("aria-controls", "sidebar");
  menuBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

  const themeBtn = document.createElement("button");
  themeBtn.type = "button";
  themeBtn.className = "theme-toggle";  // class only — landing has its own toggle; ids must stay unique
  themeBtn.setAttribute("aria-pressed", "false");
  themeBtn.setAttribute("aria-label", "Switch color theme");
  themeBtn.setAttribute("title", "Switch color theme");
  themeBtn.innerHTML =
    '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>' +
    '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn btn-secondary btn-sm";
  newBtn.id = "new-dataset-btn";
  newBtn.textContent = "New dataset";

  const header = document.createElement("header");
  header.className = "ws-header";
  header.append(menuBtn, title, chip, spacer, themeBtn, newBtn);

  const workspace = document.createElement("div");
  workspace.className = "ws-content";
  workspace.id = "workspace";

  root.append(sidebar, header, workspace);

  return { root, workspace, sidebar, header };
}

/** Highlight the active route (aria-current + visual state). */
let scoreDirty = true; // M10: next Health visit after a data change gets one restrained score emphasis

export function markScoreDirty() {
  scoreDirty = true;
}

export function setActiveRoute(route) {
  for (const [key, refs] of navRefs) {
    if (key === route) {
      refs.item.setAttribute("aria-current", "page");
    } else {
      refs.item.removeAttribute("aria-current");
    }
  }
  const titles = {
    overview: "Overview", table: "Data Table", stats: "Statistics",
    health: "Health Summary", missing: "Missing Values", duplicates: "Duplicates",
    outliers: "Outliers", consistency: "Consistency", types: "Type Issues",
    identifiers: "Identifier Issues", charts: "Charts", correlations: "Correlations",
    clean: "Clean Data", history: "History", "export-csv": "Export CSV", report: "Data Quality Report",
  };
  const titleEl = root.querySelector("#ws-title");
  if (titleEl) {
    const next = titles[route] ?? route;
    if (titleEl.textContent && titleEl.textContent !== next) {
      titleEl.classList.remove("title-fade");
      void titleEl.offsetWidth; // restart the animation on back-to-back swaps
      titleEl.classList.add("title-fade");
    }
    titleEl.textContent = next;
  }
  // The Health card renders after this call — defer one frame so the
  // emphasis lands on the fresh card exactly once per data change.
  if (route === "health" && scoreDirty) {
    scoreDirty = false;
    requestAnimationFrame(() => {
      const card = root.querySelector(".health-score");
      if (card) card.classList.add("score-highlight");
    });
  }
}

/**
 * Update sidebar count badges from the quality findings (spec §29: analysis is
 * visible — counts sit in the nav, the dashboard, and the screens themselves).
 */
export function updateSidebarCounts(profile, quality) {
  const byType = Object.fromEntries((quality?.findings ?? []).map((f) => [f.type, f]));

  const counts = {
    missing: profile?.missingCells ?? 0,
    duplicates: profile?.duplicateRows ?? 0,
    outliers: byType["outliers"]?.count ?? 0,
    // Both category- and constant-column findings live in the Consistency screen.
    consistency: (byType["category-inconsistency"]?.count ?? 0) + (byType["constant-columns"]?.count ?? 0),
    types: byType["type-issues"]?.count ?? 0,
  };

  for (const [key, refs] of navRefs) {
    // Sidebar route keys are the badge keys (missing, duplicates, …).
    if (!(key in counts) || !refs.badge) continue;
    const n = counts[key];
    refs.badge.hidden = n === 0;
    refs.badge.textContent = `· ${n}`;
  }
}

/** Update the header dataset chip (name + size). */
export function updateHeaderChip(profile, fileName) {
  const chip = root.querySelector("#ws-chip");
  if (!chip) return;
  if (!profile) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.textContent = `${profile.rowCount} × ${profile.columnCount}`;
}

/** Open/close the mobile drawer. */
export function setDrawerOpen(open) {
  root.classList.toggle("drawer-open", open);
  const sidebar = root.querySelector(".sidebar");
  if (sidebar) {
    const backdrop = root.querySelector(".drawer-backdrop");
    if (backdrop) backdrop.setAttribute("aria-hidden", String(!open));
  }
}
