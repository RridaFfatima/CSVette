# CSVette — Technical Architecture

Status: design agreed before implementation. Builds on `docs/UX-ARCHITECTURE.md` and `docs/DESIGN-SYSTEM.md`. No code yet.

The architecture goal in one sentence: **plain vanilla JS in small, single-purpose ES modules — pure data logic kept DOM-free and testable, thin view modules that render, and one predictable state object with an explicit lifecycle.**

---

## 1. Technology decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | **None — vanilla ES modules** | The app is one state object + render functions; a framework adds concepts without removing complexity here. Perfect for learning. |
| CSV parsing | **Papa Parse** (CDN, pinned version) | RFC-4180-correct handling of quotes, embedded commas/newlines, BOM, delimiter sniffing, streaming. Writing this correctly by hand is a project in itself. |
| Charts | **Plotly.js** (basic bundle) | Covers bar/line/histogram/scatter/box/pie + heatmap for correlations with theming control. |
| Icons | **Lucide** | Small, consistent, MIT. |
| Fonts | Google Fonts (IBM Plex) | Per design system; graceful fallbacks if offline. |
| Build step | **None** | Native ES modules + CDN scripts. `index.html` loads `<script type="module" src="js/app.js">`. Deploys by pushing to GitHub Pages as-is. |

Version pinning: all CDN URLs pinned to exact versions with commented upgrade notes.

## 2. Folder structure (final)

The spec's structure holds, with two additions and one clarification — both technically justified:

```text
csvette/
├── index.html                 # app shell: head tokens/pre-theme, sidebar, header, workspace mount, overlays
├── css/
│   ├── variables.css          # all design tokens (light + dark)
│   ├── style.css              # base/reset, layout, shell, sidebar, typography
│   ├── components.css         # buttons, cards, badges, alerts, tables, inputs, toasts…
│   └── responsive.css         # breakpoints (640/768/1024/1280) & mobile drawer
├── js/
│   ├── app.js                 # bootstrap, router wiring, global event delegation, theme toggle
│   ├── router.js              # hash router: parse, guard, dispatch (ADDED: isolation aids testing)
│   ├── state.js               # single AppState + explicit mutator functions (ADDED: state ≠ scattered globals)
│   ├── csv-parser.js          # file validation + Papa Parse wrapper → Dataset (pure)
│   ├── data-profile.js        # type inference + per-column profiles (pure)
│   ├── data-quality.js        # quality engine + health score (pure)
│   ├── statistics.js          # numeric/categorical stats helpers (pure)
│   ├── charts.js              # recommendations, config validation, transforms, Plotly rendering
│   ├── cleaner.js             # operations, history, undo (pure — returns new dataset snapshots)
│   ├── views/                 # (ADDED folder) one file per screen, thin renderers
│   │   ├── landing.js  overview.js  health.js  missing.js  duplicates.js  outliers.js
│   │   ├── consistency.js  types.js  identifiers.js  table.js  stats-view.js
│   │   ├── charts-view.js  correlations.js  clean.js  history.js  export-csv.js  report.js
│   ├── exporter.js            # CSV export + HTML report generation (pure)
│   ├── dom.js                 # tiny helpers: el(), esc(), formatBytes… (ADDED: XSS-safe building)
│   └── storage.js             # namespaced localStorage for preferences only
├── sample-data/               # sales.csv, students.csv, orders.csv, messy_customers.csv
├── tests/                     # strategy in §19 (ADDED: tests live with the project)
├── docs/                      # this architecture set
├── README.md  LICENSE  .gitignore
```

Why `js/views/`: the spec's list has no home for screen renderers; without one, app.js becomes a giant file (anti-goal #26). Each view file is small and maps 1:1 to a sidebar entry.

## 3. Data model

Plain objects, no classes needed except where methods earn their keep. All string data arrives as strings; conversion is *inferred*, never lossy at rest.

```js
// Dataset — the central structure
{
  name: "sales.csv",
  columns: [ { name: "region", type: "categorical", id: "region" } ],  // id = stable key (survives rename)
  rows: [ { region: "North", units: "120" } ],   // array of plain objects keyed by column id
  rowCount: 1204
}

// ColumnProfile (computed, cached per column)
{
  columnId, name, type,             // "integer"|"float"|"number"|"boolean"|"date"|"categorical"|"identifier"|"string"
  count, missing, missingPct, unique, uniquePct,
  mode, modeFrequency, topValues: [{value, count}],  // categorical/dates
  min, max, mean, median, stdDev, q1, q3, iqr,         // numeric (numbers, not strings)
  isConstant, isIdentifier
}

// QualityFinding — one shape for every issue (powers sidebar, dashboard, screens, report)
{
  type: "missing-values",           // stable machine key
  severity: "warning",              // "critical" | "warning" | "info"
  title: "Missing values",
  description: "23 cells across 4 columns",   // human text
  columns: ["age", "income"],       // affected column ids
  count: 23,                        // affected cells or rows
  columnCounts: { age: 15, income: 8 },       // per-column drill-down
  sampleRows: [41, 87, 102],        // up to 5 row indices for inspection links
  suggestion: { operation: "fill-missing", params: { method: "median", columns: ["age"] } }
}

// HealthReport
{ score: 0-100, band: "good"|"fair"|"poor",
  dimensions: { completeness: 0-100, uniqueness: 0-100, consistency: 0-100, validity: 0-100 },
  breakdown: [ {rule, weight, pointsLost, maxPoints} ] }   // powers "How this is calculated"

// CleaningOperation (history entry)
{ id, timestamp, op: "remove-duplicates", params: {…},
  before: {rows, cols}, after: {rows, cols}, affected: 8, affectedDescription: "8 rows removed" }

// ChartConfig
{ type: "bar"|"line"|"histogram"|"scatter"|"box"|"donut",
  x: columnId, y: columnId|null, agg: "count"|"sum"|"mean"|"median"|null, series: columnId|null }
```

Arrays are the source of truth; indices into `rows` are "original row numbers" and are preserved through cleaning (see §10).

## 4. State model

One module-owned object, mutated only through named functions (a hand-rolled, ~150-line store — the most framework-like thing here, and deliberately simple):

```js
// state.js
const state = {
  dataset: {
    original: null,      // Dataset — frozen after load (Object.freeze), never modified
    working: null,       // Dataset — what every screen reads
    fileName: null, sizeBytes: 0, loadedAt: null, isDirty: false   // isDirty = any cleaning applied
  },
  profile: { columns: [], computedAt: null },      // keyed to working
  quality:  { findings: [], health: null, computedAt: null },
  explorer: { search: "", sort: {col: null, dir: null}, filters: [], hiddenColumns: [],
              page: 1, pageSize: 50, fullScreen: false },
  cleaning: { history: [], stagedOp: null },
  charts:   { config: null, recommendations: [] },
  ui:       { route: "overview", routeParams: {}, theme: "light"|"dark", loading: null }
};

// API surface (all changes flow through these)
loadDataset(dataset)        // sets original+working, freezes original, triggers full analyze()
setWorkingDataset(ds, op)   // used by cleaner: swap working, push history, trigger recalc
setExplorer(patch)          // explorer-only: triggers table re-render only
setRoute(route, params)     // ui-only: triggers view render only
```

Recalculation is evented, not magical: mutators return a list of "what changed" (`dataset`, `quality`, `explorer`…) and `app.js` reacts by re-rendering affected regions (sidebar badges, workspace view). No two-way binding, no observers beyond this single dispatch point.

Three data layers, per spec: **original** (frozen), **working** (cleaned), **filtered view** (`state.explorer` applied over `working` at render time — filtering never copies the dataset; it produces an array of row indices).

## 5. Dataset lifecycle

```text
File input / drag-drop / sample fetch
  → validate (extension, size guard, type)
  → Papa Parse (header: true, skipEmptyLines, dynamicTyping: false*, worker: false v1)
  → normalize: trim BOM, header dedup ("col", "col_2"), rows as objects with original row index
  → validate: 0 columns? 0 rows? ragged rows → missing-fill + count, empty file → error
  → profile (type inference per column, then per-column stats)      [cached in state.profile]
  → quality analysis (all rules, all findings, health score)        [cached in state.quality]
  → render Overview
  → (explore freely — no recompute unless filters/sort change, which is render-time only)
  → clean operation → cleaner.js returns NEW dataset snapshot → setWorkingDataset
  → recalc: profile + quality only (not re-parse) → sidebar counts & health update everywhere
  → visualize/export read current working + explorer state
```

\* `dynamicTyping: false` is deliberate: parsing `"00123"` or `"1e5"` automatically corrupts IDs and dates. Types are inferred once, by us, conservatively (§7), and only converted where a computation needs it (e.g. `parseFloat` inside `mean()`).

**Cache invalidation rule:** after any cleaning op, recompute profile + quality in full. It's a single pass per column over the data — fast for the target sizes (§14) and far easier to keep correct than incremental updates. "Premature over-engineering" applies.

## 6. CSV parsing (csv-parser.js)

- **Validation first:** extension/`File.type` check → warn-not-block ("This doesn't look like a CSV — attempting anyway"); size check against soft limit (see §14) → blocking error with explanation.
- **Papa Parse config:** `{ header: true, skipEmptyLines: 'greedy', dynamicTyping: false, transformHeader: trim }`.
- **Quoted values, embedded commas/newlines:** handled by Papa (RFC-4180). No custom parsing.
- **Malformed rows:** Papa reports `errors[]` per row; CSVette collects them, fills absent cells with `""`, continues parsing, and surfaces a **non-blocking info finding** ("3 rows had fewer fields than the header — treated as missing").
- **Empty file / header-only file:** explicit error state ("This file has no rows") / warning state ("This file has headers but no data rows").
- **Encoding:** accept `File` object so Papa reads bytes and detects UTF-8 BOM; attempt UTF-8, fall back message if replacement chars dominate ("file may be ISO-8859-1 — try converting to UTF-8").
- **Huge files:** v1 parses in one go with progress; streaming (`chunk`) is the documented upgrade path if the size guard is ever raised (§14).

## 7. Type inference (data-profile.js)

Per column, a conservative cascade. A column gets a type only if **≥ 90%** of non-missing values match it; numeric formats are scoped so identifiers don't slip through.

```text
boolean     ∈ {true,false,TRUE,FALSE,True,False,yes,no,y,n} (exact match)
date        matches common formats: ISO YYYY-MM-DD, YYYY/MM/DD, DD-MMM-YYYY, MM/DD/YYYY,
            "12 Jan 2024"… (validated via Date parse + round-trip, no epoch-only acceptance)
integer     /^[+-]?\d+$/ AND NOT identifier-suspicious
float       standard decimal/scientific notation, AND NOT identifier-suspicious
identifier  any of: ≥95% unique + all values match /^[0-9]+$/ with leading zeros present,
            all values same length ≥ 4 digits, matches UUID, or matches /^[A-Z]{2,}-\d+$/
            ("ID-0042" style codes) → type "identifier", excluded from numeric stats
categorical string non-date with unique% ≤ 50% and unique count ≤ 50 → "categorical"
string      otherwise
```

- Ties/ambiguity → `string` (the safe default). Numeric stats, outliers, and correlations skip `identifier` columns by rule, not convention.
- Empty/`NULL`/`N/A`/`NA`/`?`-like tokens are **missing markers** (see §8), never type evidence.
- Inference runs on the first 10,000 non-missing values max (deterministic; noted in report).

## 8. Data profiling (data-profile.js + statistics.js)

- **Missing markers:** `""`, `"null"`, `"NULL"`, `"n/a"`, `"N/A"`, `"NA"`, `"?"`, `"-"`, `"—"` (case-insensitive, exact match only — `"na"` inside a word is untouched; `?`/`-`/`—` only counted when the whole cell is that token). Counted, never mutated at load: the raw string stays in the data; "missing" is derived at analysis time.
- **Missing & invalid values** in stats: excluded from min/max/mean/median/stdDev/percentiles; included in `count` as `missing`; `unique` counts distinct non-missing values.
- **Numeric stats** computed on `Number` conversions *only where parseable*; if a cell isn't parseable it's excluded and reported by the type-issues rule instead of silently averaged.
- **Categorical:** mode, top-8 frequencies + "other" bucket.
- **Dates:** min/max, span, parsed count vs failures.
- **Identifiers:** unique%, detected pattern; **no numeric statistics computed** (the "00123" rule).

## 9. Quality engine (data-quality.js)

Pure functions: `analyzeQuality(dataset, profile) → { findings[], health }`. One finding object per rule per scope (see §3 shape). Rules:

| Rule | Logic | Default severity |
|---|---|---|
| missing-values | per column missingPct; >0 info · >5% warning · >20% critical | escalates |
| duplicate-rows | full-row JSON key comparison, group rows | >0 warning |
| duplicate-identifiers | repeated values in identifier columns | >0 warning |
| constant-columns | all non-missing values identical | info |
| category-inconsistency | normalize key = lowercase+trim+strip punctuation; variants with same key but different raw values, each variant ≥ 5% of column | warning |
| type-issues | values not matching the inferred column type | ≥1 warning |
| identifier-columns | identifier type detected | info (educational note) |
| outliers | IQR: below Q1−1.5·IQR / above Q3+1.5·IQR, numeric non-identifier columns | info ("potential") |

Outlier wording is enforced at the model level: the finding's title/description strings say "potential outlier… worth reviewing" — views render what the engine says, so no view can overstate certainty.

## 10. Health score (data-quality.js)

**Start at 100; subtract transparent penalties; clamp 0–100.** Band: ≥85 good · 50–84 fair · <50 poor.

| Dimension | Weight | Rule |
|---|---|---|
| Completeness | 30 | proportional to missing cells: `100 × (1 − missingCells / totalCells)` |
| Uniqueness | 20 | `100 × (1 − duplicateRows / rowCount)` |
| Consistency | 25 | penalty per affected column for category-inconsistency (8) and type-issues (6), maxed at dimension weight |
| Validity | 25 | outlier columns (3 each) + constant columns (4 each) + duplicate-identifier columns (6 each), maxed at weight |

- **Unavailable dimension:** e.g. zero numeric columns → no outlier/validity penalty from that rule; zero duplicates → full uniqueness points. Score only ever reflects what can be measured.
- **`breakdown[]`** lists every rule, its weight, points lost, and human reason — rendered verbatim in Health Summary's "How this is calculated". No black box, no decorative score.
- Recalculated in full after every cleaning op; the delta is shown ("Health score 78 → 84") because before/after are both known at that moment.

## 11. Explorer (views/table.js + state.explorer)

- **Data flow:** `working rows` → `applySearch` → `applyFilters` → `applySort` → row-index array → paginate → render ≤ `pageSize` rows. The full working set is never DOM-rendered.
- **Search:** case-insensitive substring across visible columns, per-cell, first match wins; debounced 150ms.
- **Filters:** array of `{columnId, op, value|values}`; ops per column type (text: equals/not-equals/contains/starts-with · number: eq/gt/lt/between · date: before/after/between · categorical: in[]). Comparison via the column's inferred type — numeric filters parse numerals, so "greater than 9" doesn't string-compare "10".
- **Sort:** type-aware comparator (numeric parse for numbers, date parse for dates, localeCompare for strings, missing always last in both directions); `aria-sort` on headers.
- **Pagination:** page/pageSize in state; "Showing 1–50 of 1,204" line is computed from the filtered index array. Rendered as `<button>`s (no `<a href="#">` weirdness).
- **Column visibility:** list of hidden ids in state; headers + cells filtered at render.
- **Full-screen:** class toggle on the shell; Esc exits.
- **Performance:** at 50 rows/page this stays instant to ~100k+ rows because filtering/sorting is one linear pass over an array of row indices; the dataset objects are never copied per interaction.

## 12. Cleaning engine (cleaner.js)

Pure and immutable: every operation takes `(workingDataset, params)` and returns `{ nextDataset, affected, affectedRows, description }` — **never** mutates its input. Working snapshots make undo trivial and predictable.

```js
ops = {
  "remove-duplicates", "remove-missing-rows",
  "fill-missing",        // params: {columns, method: "mean"|"median"|"mode"|"custom", value}
  "trim-whitespace",     // params: {columns}
  "change-case",         // params: {columns, case: "lower"|"upper"|"title"}
  "normalize-categories" // params: {column, mapping: {variant: canonical}} (V2, from consistency screen)
  "rename-column",       // params: {column, newName}
  "delete-column"        // params: {column}
}
```

- **History:** append-only array of `CleaningOperation` (§3). **Undo** = restore previous dataset snapshot; an undo appends its own history entry ("Undo: fill-missing") so history stays truthful. **Revert to original** = working := original, confirmed first.
- **Row identity:** each row carries its original load index; ops preserve it (removals drop indices, fills keep them) — this is what lets any screen link "row 41" into the table forever.
- **Before/after:** the Clean view renders affected counts + a sample of changed rows from `{before, next}` without storing full dataset copies.
- **Gates:** operations that would affect > 25% of rows require confirmation; disabled ops list their reason.

## 13. Visualization engine (charts.js)

- **Recommendation logic** (reads profile, no fake data): numeric col → histogram; categorical (≤30 unique) → bar of frequencies; date + numeric → line (date on x, aggregated); cat + num → bar of mean/count by category; num + num → scatter; single cat low-cardinality + nothing else → donut. Output: ranked `ChartConfig[]` with titles.
- **Validation:** `validateChartConfig(config, profile) → {ok, errors[]}` — human-readable ("Line charts need a date or numeric X axis", "Pick an aggregation to plot Sales by Region"). Invalid configs render the message, never a wrong chart.
- **Transform:** aggregation happens in `charts.js` (group-by + count/sum/mean/median over working rows), producing Plotly-ready `{x[], y[]}`. Histograms bin numerically; date axes aggregate by day/month/year.
- **Rendering:** one Plotly `newPlot` per chart card, `displayModeBar: false`, responsive; theme applied via a token→Plotly template function that re-runs on theme toggle. Cap scatter at ~5,000 points with a sampled note.
- **Correlations:** Pearson r over numeric non-identifier pairs (n ≥ 30 else warn); Plotly heatmap with the diverging scale; click cell → scatter config.

## 14. Export (exporter.js)

- **CSV export:** reconstruct CSV from rows (proper quoting/escaping — values containing `,`, `"`, or newlines are wrapped and doubled). Sources: original (re-offered as uploaded or reconstructed), working, filtered view (current explorer row indices). Download via `Blob` + `URL.createObjectURL` + `<a download>`. Filenames: `sales_cleaned.csv`, `sales_filtered.csv`, `sales_original.csv`.
- **HTML report:** standalone document built from `state` (summary, health + breakdown, findings with sample rows, column stats table, cleaning history). Inlined CSS (no external deps so the report works offline/emailed). Offered as new-tab preview + download.
- **Data-quality report** never contains the full dataset by default (summary tables only) — keeps the file small and matches its purpose.

## 15. Storage (storage.js)

localStorage **preferences only**, under one namespace (`csvette.theme`, `csvette.pageSize`): theme, table page size, last-used chart type. Datasets are **never** persisted (privacy by design + quota limits); refresh = re-upload, which the UX copy states. All storage access is try/catch-wrapped (private browsing).

## 16. Performance strategy

- **Parsing:** progress events from Papa during load; the size guard warns at ~50 MB (recommended) and blocks at ~150 MB (v1 honest limit), with messaging per state design. Workers/streaming documented as the upgrade path, not built early.
- **Rendering:** pagination everywhere; table renders ≤ pageSize rows; charts capped/sampled; sidebar badge update is O(findings) not O(data).
- **Compute:** profile + quality computed **once** per dataset version (cache in state), recomputed only on cleaning; per-interaction explorer work is a single linear pass; stats helpers avoid repeated `parseFloat` (convert once into a scratch array).
- **DOM:** views rebuild their container's innerHTML via a single safe builder call per render (no incremental patching = no staleness bugs; cheap at this scale).
- **Web Workers:** explicitly deferred. Justified only when parsing >150 MB or profiling >1M rows lands on the roadmap.

## 17. Error handling

Layered, so no error strands the app:

| Layer | Approach |
|---|---|
| File/parse errors | Caught in the loader; staged overlay shows what/why/next (retry, try sample). App returns to landing — state untouched. |
| Analysis errors | try/catch around profile/quality per stage; a failure renders the error state in the affected card ("Couldn't compute outliers for this column") without blocking other screens. |
| Chart errors | `validateChartConfig` guards before render; runtime errors swap the chart card to an error state. |
| Cleaning errors | Ops validate params first (e.g. fill-missing with no missing values → disabled op); failures leave the working dataset unchanged (immutability makes this free). |
| Export errors | try/catch with a message ("Couldn't generate the report — try again") — no partial files. |
| Global safety net | `window.addEventListener('error')` + unhandled-rejection hook → toast + console details; the app shell stays usable. |

Every error path renders the designed error state (what happened · likely why · what to do next) per the UX spec.

## 18. Security & privacy

- **Untrusted data rule:** every CSV cell is treated as hostile text. All dynamic content is inserted via `dom.js` helpers that use `textContent`/element construction — **no string-concatenated innerHTML with data values** (the single rule that prevents XSS from dataset content). Chart labels go through Plotly's text path, not HTML.
- No dataset ever leaves the page: no fetch/XHR of file contents, no analytics, no CDN that receives data (static script loads only). Privacy statement is enforced by architecture, not just copy.
- No secrets, keys, or auth exist in the app. `rel="noopener"` on any external links; `target="_blank"` only for report preview.
- CSP note for README: a `meta` CSP restricting `script-src` to self + pinned CDNs is included and documented.

## 19. Testing strategy

Practical for a no-build project — browser-native and dependency-light:

- **Unit tests (pure modules):** plain JS test files in `tests/` run via a tiny test runner page (`tests/runner.html`, assert helpers ~40 lines, no dependency). Because csv-parser/data-profile/data-quality/statistics/cleaner/exporter are DOM-free ES modules, they import directly in the browser. Cover:
  - *Parser edge cases:* quoted commas/newlines, BOM, ragged rows, empty file, header-only, delimiter sniffing.
  - *Type inference:* `"00123"`→identifier, `"twenty-two"`→string, mixed-age column, dates in 4 formats, boolean variants, categorical threshold boundary (51% unique → string).
  - *Statistics:* known-input mean/median/stdDev/percentiles; missing-value exclusion.
  - *Quality engine:* each rule on crafted mini-datasets incl. the `Pakistan/pakistan/PAKISTAN/Pak` case; severity escalation thresholds.
  - *Health score:* hand-computed expected scores + breakdown for 3 fixtures.
  - *Cleaner:* each op's before/after, undo chain, original-untouched invariant (`Object.isFrozen`), row-index preservation.
  - *Filtering:* numeric vs string comparison ("gt 9" vs "10"), date before/after, missing-last sort.
  - *Exporter:* CSV round-trip (export → re-parse → equal), quoting of tricky values.
- **Edge-case fixtures:** `tests/fixtures/` with tiny crafted CSVs (ragged, quoted, empty, all-missing-column, constant column, unicode).
- **UI testing:** manual checklists per milestone (documented in `docs/TESTING.md`) + verification in this workspace via the preview tooling at each milestone.
- **Sample datasets double as tests:** `messy_customers.csv` is crafted so every quality rule fires at least once with known expected findings — asserted in tests.

## 20. GitHub Pages considerations

- Pure static deploy: push → Pages serves root (`index.html` present). No build, no Jekyll processing needed (add empty `.nojekyll` to be safe with any future underscore paths).
- **Relative paths only** (`./css/…`, `./js/…`) so the site works at `username.github.io/csvette/`.
- **Hash routing** (already chosen in UX) — no server-side rewrites needed for deep links, unlike history-API routing on Pages.
- CDN dependencies pinned by exact version; app degrades gracefully (fonts/icons) if a CDN is unreachable; core analysis never depends on network.
- `README.md` documents: what it is, how to run locally (`npx serve` or `python -m http.server` — needed because ES modules require http, not `file://`), deployment steps, privacy statement.

## 21. Open items for the milestone prompt

- Exact MVP scope cut (which views/ops ship in Milestone 1 vs later) → milestone prompt.
- Whether `normalize-categories` lands in V2 cleaning or MVP (recommended V2; consistency *detection* is MVP).
- Sample dataset sizes (~300–800 rows each; messy_customers engineered per §19) → milestone prompt.
