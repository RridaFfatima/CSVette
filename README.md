# CSVette

> Turn messy CSVs into meaningful data.

CSVette is a browser-based CSV data analysis and data-quality tool. Inspect data quality, explore patterns, clean inconsistencies, and create visualizations — **entirely in your browser**.

**Your data stays in your browser.** CSVette does not upload your dataset to a server. There is no backend, no database, and no account.

## Status

🚧 Under construction — Milestone 10 (Premium Polish & Motion). The CSV engine, data-quality analysis, health screens, the Data Explorer, charting/correlations, a full non-destructive cleaning workspace, CSV exports (original / working / filtered), a standalone HTML data-quality report, and deterministic key insights on the Overview are working and have passed a full QA pass (336 automated tests). See `docs/` for the approved UX, design-system, and technical architecture.

### Motion system (Milestone 10)

All interaction motion lives in `css/motion.css` — tokens (`--ease-soft`, `--ease-spring`, `--dur-base` aliasing the design-system durations), shared entrance keyframes, a subtle route entrance, insight stagger, one-shot health-score emphasis after data changes, a chart rebuild crossfade, button/press feedback, a theme-switch crossfade, and a single global `prefers-reduced-motion` guard that collapses all decorative motion to opacity-only or instant. Motion communicates feedback and continuity only — transform/opacity, 120–240ms.

### Visualization (Milestone 5)

- **Charts** — histogram (Freedman–Diaconis binning), box plot (IQR fences matching the quality engine), bar charts (top-N with honest omission counts), aggregated bars (count/mean/median/sum/min/max), scatter (missing-pair handling), and date line charts — all hand-rolled SVG styled with the design tokens, theme-aware, custom tooltips
- **Recommendations** — deterministic rules from the existing type profiles, each with a why
- **Manual builder** — only valid combinations are offered; invalid ones get an explanation, never a broken chart
- **Filter integration** — charts draw from the Data Explorer's filtered view, with a visible scope control and provenance notes
- **Correlations** — Pearson matrix over row-paired values, tinted cells, neutral association language, explicit correlation ≠ causation note, cell → scatter deep links
- **No chart library added** — pure logic (`chart-data.js`) is Node-tested (`node tests/chart-data-test.js`, 51 checks)

### Data Explorer (Milestone 4)

- **Search** across all columns — live counts (`8 of 30 rows match`), match highlighting, numeric values matched by value not substring
- **Type-aware filters** — text (contains/equals/starts/empty), numeric (> < ≥ ≤ between), boolean (true/false), date (before/after/between) — combinable, with edit/remove/clear-all chips
- **Combined pipeline** — search + filters + sort + pagination always agree; pages clamp when the view shrinks
- **Quality deep links preserved** — analysis screens still land on the exact row/column; rows hidden by an active filter are explained, not silently dropped

Run the filter-engine tests with `node tests/filter-test.js` (42 checks against the messy sample).

## Run locally

The app is plain HTML/CSS/JS (ES modules), so it needs to be served over HTTP:

```bash
# from the project root — pick whichever you have:
python serve.py 8000        # recommended: disables caching (edits show on reload)
python -m http.server 8000
npx serve .
```

Then open http://localhost:8000

## Deploy

Static hosting only (built for GitHub Pages): push the repository, enable Pages on the main branch / root. No build step.

## Tech

- HTML5, CSS3, vanilla JavaScript (ES modules) — no framework, no build step
- Papa Parse, Plotly.js, Lucide (added in later milestones)
- localStorage stores preferences only (e.g. theme) — never your data

## Docs

- `docs/UX-ARCHITECTURE.md` — screens, navigation, flows
- `docs/DESIGN-SYSTEM.md` — tokens, typography, components, themes
- `docs/TECHNICAL-ARCHITECTURE.md` — modules, data model, quality engine, testing

## License

MIT — see `LICENSE`.
