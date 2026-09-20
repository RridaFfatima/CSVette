# CSVette — UX & Screen Architecture

Status: design agreed before implementation. Referenced by the design-system, technical-architecture, and milestone prompts. No code yet.

---

## 1. Guiding principles

The user must always be able to answer five questions:

1. **Where am I?** — the sidebar highlights the active section (`aria-current="page"`), and the header shows the current screen name next to the dataset chip.
2. **What did CSVette find?** — every finding is counted and shown in three places (see below).
3. **What needs my attention?** — the Overview screen's "What needs your attention?" cards, ordered by severity.
4. **What can I do next?** — every analysis screen ends in a suggested action ("View affected rows", "Clean this column", "Export cleaned CSV").
5. **How do I get back?** — the sidebar is persistent (desktop) or one tap away (mobile); nothing important lives behind nested dialogs.

**The "analysis is visible" rule.** Every detected finding appears in *three* surfaces:

| Surface | Form |
|---|---|
| Persistent sidebar | Live count badge next to each Data Health item (e.g. `Missing Values · 4`). Zero findings show a subtle check state. |
| Overview dashboard | "What needs your attention?" cards with counts, columns affected, and "View details →" links. |
| Analysis screens | Full detail with drill-down into actual rows and values. |

Counts in the sidebar are always live — they update automatically after every cleaning operation, so the user sees their progress as the numbers drop.

**Two worlds.** The app has exactly two modes:

- **Pre-dataset:** the landing page. No sidebar, no dashboard — nothing to navigate yet.
- **Workspace:** one app shell (sidebar + header + workspace area) that swaps its content per screen. There is no full-page navigation between analysis screens.

**Data lifecycle.** The dataset lives in memory only for the session (privacy by design). localStorage holds preferences only (theme, table page size, last chart settings). Refreshing or loading a new dataset discards the session; CSVette confirms before discarding work.

---

## 2. App shell & routing

A single `index.html` shell; screens are rendered into the workspace area.

**Hash-based routing** — chosen because it is simple, works on GitHub Pages, keeps back/forward working, and makes deep links (Overview card → Outliers, filtered to one column) trivially representable:

```text
#/overview      #/health       #/missing       #/duplicates
#/outliers      #/consistency  #/types         #/identifiers
#/table         #/stats        #/charts        #/correlations
#/clean         #/history      #/export/csv    #/export/report
```

**Context via URL params**, e.g.:

- `#/outliers?col=age` — outlier screen pre-filtered to the Age column (chip: "Showing 1 of 5 columns · Clear").
- `#/table?filter=age:missing` — Data Table opened with an active, removable filter chip.

**Route guard:** navigating to any workspace route with no dataset loaded redirects to the landing page with a friendly note ("Upload a CSV or try a sample dataset to begin").

**Workspace header (always visible in workspace mode):**

- Left: dataset name + `rows × cols` chip.
- Center/right: health score mini-badge (clickable → `#/health`), theme toggle, "New dataset" button (with confirm if cleaning has been applied).
- Mobile: hamburger button replaces the sidebar.

---

## 3. Screen inventory (17 screens + global overlays)

**Pre-dataset**
1. Landing

**Dataset**
2. Overview (dashboard)

**Data Health**
3. Health Summary
4. Missing Values
5. Duplicates
6. Outliers
7. Consistency
8. Type Issues
9. Identifier Issues

**Explore**
10. Data Table
11. Statistics

**Visualize**
12. Charts
13. Correlations

**Clean**
14. Clean Data
15. History

**Export**
16. Export CSV
17. Data Quality Report

**Global overlays (not screens):** staged upload overlay, error banner/dialog, confirm dialogs, restrained toasts, mobile nav drawer.

---

## 4. Navigation structure

Desktop sidebar (fixed, ~260px), exactly the spec's structure:

```text
CSVette
────────────
DATASET
  Overview

DATA HEALTH
  Health Summary
  Missing Values        · 4
  Duplicates            · 8
  Outliers              · 27
  Consistency           · 3
  Type Issues           · 2
  Identifier Issues     · 1

EXPLORE
  Data Table
  Statistics

VISUALIZE
  Charts
  Correlations

CLEAN
  Clean Data
  History

EXPORT
  CSV
  Data Quality Report
────────────
Privacy note: "Your data stays in your browser."
```

- Active item: filled/underline treatment + `aria-current="page"` (never color alone).
- Badges show finding counts; groups with findings get a subtle emphasis dot. All-zero states read as calm, not broken.
- Sidebar items are real hash links → keyboard-navigable, middle-clickable, back-button friendly.

Mobile (≤ ~900px): sidebar becomes an off-canvas drawer via hamburger. Groups are collapsible accordions with badges visible on the group headers, so "DATA HEALTH · 45" is discoverable without expanding. Analysis screens remain one tap away; no horizontal-scroll nav that hides sections.

---

## 5. Primary user flows

**Main flow**

```text
Landing (upload / sample)
  → staged loading overlay (Reading → Parsing → Profiling → Checking quality)
  → Overview with attention cards
  → click a card → analysis screen (with column context)
  → act via Clean Data
  → verify in Data Table / watch sidebar counts + health score drop
  → Charts / Correlations
  → Export CSV / Data Quality Report
```

**Secondary flows**

- *Straight to explore:* landing offers "Explore a sample first" style path → Data Table.
- *Direct nav:* user ignores Overview and uses sidebar badges directly — always valid.
- *Clean loop:* Clean Data → Apply → toast with **Undo** → auto-recompute → History entry → health delta shown ("Health score 78 → 84").
- *Row investigation from anywhere:* any row reference ("row 41") is a link that opens the Data Table scrolled/filtered to that row.

---

## 6. Screen-by-screen specs

Each screen lists purpose, major components, and notable states.

### 1. Landing

- **Purpose:** explain the product, get a CSV in fast, establish trust (privacy).
- **Components:** hero (headline "Turn messy CSVs into meaningful data." + supporting line), primary CTA **Upload CSV**, secondary **Try a sample dataset** (sales, students, orders, messy_customers — each labeled; messy_customers labeled "see data-quality analysis in action"), privacy statement, product preview (static mock of the workspace), feature highlights grid (4–6 cards: profiling, quality checks, cleaning, charts), footer.
- **Drag & drop:** the entire hero is a drop target; a visible drop zone outline appears on drag-over.
- **States:** idle · drag-over · loading (staged overlay takes over) · error (parse failure panel: what went wrong, why, retry / try a sample).

### 2. Overview

- **Purpose:** "What is this dataset?" + "What needs your attention?"
- **Components:**
  - Header strip: dataset name, rows, columns, total cells.
  - Health score card (score + band + "See why →" → Health Summary).
  - Stat strip: missing cells, duplicate rows, numeric / categorical / date / boolean column counts, potential outliers.
  - **"What needs your attention?"** — one card per non-zero finding type (Missing Values, Potential Outliers, Duplicates, Consistency, Type Issues, Identifier Issues). Each card: count, columns affected, "View details →" deep link (with the most relevant column as context where sensible). Cards ordered by severity.
  - All-clear state: calm "No obvious quality issues detected" + suggestions to explore or visualize.
  - **Column table:** every column as a row — name, inferred-type chip, missing % bar, unique count. Column names are links into the relevant analysis pre-filtered to that column. This is the main context-preservation device.

### 3. Health Summary

- **Purpose:** transparent score — not decorative.
- **Components:** large score (0–100) with band label (Good / Fair / Poor); four dimension meters (Completeness, Uniqueness, Consistency, Validity) each with a one-line explanation; **"How this is calculated"** section listing each rule, its weight, and its current point impact; findings list grouped by severity (Critical / Warning / Info — icon + text, not color alone) with links to detail screens; "Last checked" timestamp (recomputed automatically after cleaning).

### 4. Missing Values

- **Components:** toggle "Only columns with missing values / all columns"; per-column rows: name, type, missing count, missing %, visual bar, placeholder values found (NULL, N/A, ?, …) with counts; per column: "View affected rows →" (Data Table pre-filtered) and "Clean…" (Clean Data with fill/drop pre-selected for that column).
- **States:** all-clear ("No missing values in this dataset") with next-step links.

### 5. Duplicates

- **Components:** summary card (count, % of rows); duplicate groups table (group #, row numbers, first few cell values); "View all duplicate rows →" (pre-filtered Data Table); primary action **Remove duplicates** (routes to Clean Data with the operation pre-selected — the Clean screen shows before/after before applying).
- **Definition note:** exact duplicates = all cells identical.

### 6. Outliers

- **Components:** column chips at top (only numeric, non-identifier columns; deep-link param preselects one); per column: count, method explanation (IQR: Q1, Q3, lower/upper bounds shown as numbers), a small box-plot or histogram with bounds marked, list of outlier values each linked to its row; **standing wording:** "Potential outliers are unusual values worth reviewing — not necessarily errors."
- **Deliberate omission:** no bulk "delete outliers" button. Action is "Review these rows in the Data Table."

### 7. Consistency

- **Components:** per affected column: variant table (e.g. `Pakistan 512 · pakistan 87 · PAKISTAN 40 · Pak 12`) with counts, suggested canonical form, share of affected rows; suggested normalizations (trim, lowercase, map variants) offered as links into Clean Data; note: "Differences are flagged, not automatically treated as errors."

### 8. Type Issues

- **Components:** per affected column: inferred type chip, the inference rule that fired, list of non-conforming values with row numbers (e.g. `Age: "twenty-two" — row 41`), "View rows →". Cleaning (fix or convert) happens in Clean Data.

### 9. Identifier Issues

- **Components:** suspected ID columns with evidence (unique %, leading zeros, pattern, UUID-like format); duplicate-ID count when an ID repeats; standing warning: "IDs are labels, not measurements — CSVette excludes them from statistics, outliers, and correlations."

### 10. Data Table

- **Purpose:** the workhorse explorer.
- **Components:**
  - Toolbar: global search; column-visibility dropdown; full-screen toggle; page-size select; pagination.
  - **Active filter bar:** one chip per active filter (`Age between 18–30 ×`) + "Clear all". Always visible whenever anything is active.
  - Status line: `Showing 1–50 of 1,204 rows · 8 hidden by filters · sorted by Age ↓`.
  - Type-aware per-column filter menu: text (equals / not equals / contains / starts with), number (equals / > / < / between), date (before / after / between), categorical (checkbox value list).
  - Sortable headers (type-aware, arrow indicator, no color-only cue).
  - Missing cells: subtle styling **plus** an icon/glyph — not color alone. Sticky header; always-visible row-number column (original row indices, stable across cleaning).
  - Full-screen mode: table fills the viewport; Escape or toggle exits.
- **States:** no filters match ("No rows match your filters. Clear filters?") · empty dataset edge case · loading skeleton only on first render.

### 11. Statistics

- **Components:** column selector (list of all columns with type chips) + detail panel: count, missing, unique, min/max, mean, median, std dev, quartiles, mode; numeric → histogram + outlier bounds marker; categorical → frequency table with bars (top values + "other"). An "All columns" summary table for a quick scan.

### 12. Charts

- **Components:**
  - **Recommended charts** row: 3–5 suggestion cards derived from the profile ("Distribution of Age", "Sales by Region", "Orders over time") — clicking prefills the builder.
  - **Manual builder:** chart type (bar, line, histogram, scatter, box, donut), X, Y, aggregation (count / sum / mean / median where applicable), optional series split.
  - **Live validation:** incompatible combos explain themselves ("Line charts need a date or numeric X axis", "Choose an aggregation to plot Sales by Region") instead of silently rendering nonsense.
  - Live Plotly preview; chart title defaults to a description of what's plotted.

### 13. Correlations

- **Components:** correlation matrix (Plotly heatmap) over numeric non-identifier columns (with a note about exclusions); clicking a cell opens the scatter plot for that pair with r shown; low-sample warning when rows are few; **persistent caption:** "Correlation describes association, not causation."

### 14. Clean Data

- **Purpose:** deliberate, safe, reversible changes to a working dataset.
- **Components:**
  - Banner: "You're editing a working copy — the original stays untouched." + **Revert to original** (confirm dialog).
  - Left: operation list (remove duplicates; drop rows with missing values; fill missing — mean / median / mode / custom value; trim whitespace; change case; rename column; delete column).
  - Right: **preview pane** — "This will remove 8 rows (0.7%)" / affected cells, sample of affected rows before → after.
  - **Apply** (explicit confirm if the change affects > 25% of rows) → success toast with **Undo** → auto re-profile & re-run all quality checks → sidebar counts, Overview cards, and health score update everywhere.
  - Disabled ops with reasons (e.g. "Fill missing — no missing values in this dataset").

### 15. History

- **Components:** timeline of operations (time, operation, affected rows/cells, resulting shape); each entry has **Undo** (restores the prior snapshot; the undo itself is logged); "Revert to original" at the top. Empty state: "No cleaning operations yet."

### 16. Export CSV

- **Components:** source choice — original / working (cleaned) / current filtered view; preview of first rows + row/col count; download button (`sales_cleaned.csv` style naming).

### 17. Data Quality Report

- **Components:** include/exclude options (column stats, cleaning history), Generate → styled standalone HTML report (open in a new tab and/or download) covering dataset summary, health score + methodology, missing values, duplicates, outliers, type issues, consistency issues, column statistics, cleaning history.

---

## 7. Global overlays & feedback

- **Upload overlay:** staged status text — "Reading your file… → Parsing rows (12,400)… → Profiling columns… → Checking data quality…" with a cancel option.
- **Error dialog/banner:** what went wrong · likely why · what to do next (retry, try a sample). Parse errors name the approximate line/problem when the parser provides one.
- **Toasts:** restrained — used for success confirmations ("Loaded sales.csv — 1,204 rows, 18 columns") and the Undo affordance after cleaning. No toast spam; errors use the banner/dialog, not toasts.
- **Confirm dialogs:** loading a new dataset over an edited session; Revert to original; any clean apply affecting > 25% of rows.

---

## 8. State matrix (applies to every screen)

| State | Rule |
|---|---|
| Empty | Every analysis screen has an all-clear state with next-step links — never a blank page. |
| Loading | Skeletons/spinners with explanatory text, only where work takes perceptible time. |
| Success | Restrained confirmation; counts update everywhere. |
| Error | Explains what happened, why, and the way out. |
| Disabled | Buttons that can't act are disabled **with a reason** (tooltip or inline text). |
| Confirmation | Destructive or high-impact actions always ask first. |

---

## 9. Interaction rules

1. Every count/finding anywhere is clickable and leads to its analysis (with column context when one exists).
2. Every row reference opens the Data Table at that row (original row numbers are stable across cleaning operations).
3. Sorting/filtering are views — the dataset never changes outside the Clean flow.
4. Cleaning applies immediately to the working dataset; recalcs are automatic; a health delta is shown.
5. Table filters are screen-local; deep-linked filters appear as removable chips so the user is never confused by hidden state.
6. Navigation never destroys in-progress work (chart builder settings, selected column) unless the user loads a new dataset (confirmed).
7. Escape closes overlays, drawers, full-screen table, and dialogs; focus returns to the trigger.

---

## 10. Desktop behavior

- Fixed sidebar (~260px) + 56px header; workspace content max-width ~1200px (tables may span full width).
- Two-pane screens (Charts, Clean, Statistics) sit side by side; collapse to stacked below ~1100px.
- Full-screen table mode for large datasets; everything else keeps the shell visible so navigation is never more than one glance away.

## 11. Mobile behavior

- Sidebar → off-canvas drawer (hamburger); collapsible groups with count badges on headers.
- Header shows dataset chip + health badge; actions collapse into an overflow menu.
- Data table: horizontal scroll with sticky header and sticky row-number column; filter menus become bottom-sheet panels; pagination preserved.
- Charts: full-width, Plotly responsive config; builder controls stack vertically.
- Touch targets ≥ 44px; no hover-dependent information.

## 12. Accessibility requirements

- Semantic landmarks (`header`, `nav[aria-label]`, `main`, `footer`); skip-to-content link.
- `aria-current="page"` + non-color active treatment on nav.
- Real tables (`<table>`, `th[scope]`, screen-reader captions); charts get text alternatives (underlying summary tables are one click away) and never encode meaning in color alone.
- Severity/status always icon + text + color.
- Visible focus states everywhere; route changes move focus to the new screen's heading; dialogs trap and restore focus.
- AA contrast in both themes; `prefers-reduced-motion` respected.
- All form controls labeled; icon-only buttons have accessible names.

## 13. Open questions for the next prompts

- Exact health-score formula and dimension weights → **technical architecture** prompt.
- Soft file-size limit and the "very large file" threshold → technical architecture.
- Visual tokens (graphite/charcoal palette, accent, type scale) → **design system** prompt.
- Module boundaries matching this UX (router, views, state) → technical architecture.
