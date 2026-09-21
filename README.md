 CSVette

A browser-based CSV data quality, exploration, cleaning, and visualization tool.
https://rridaffatima.github.io/CSVette/#/

CSVette helps you understand a dataset before working with it — from identifying missing values and duplicates to exploring distributions, finding inconsistencies, cleaning data, and exporting the results.

Everything happens in your browser. Your dataset is never uploaded to a server.


 ✦ What is CSVette?

Working with a CSV often starts with the same questions:

* What is actually in this dataset?
* Which columns have missing or inconsistent values?
* Are there duplicates or suspicious outliers?
* What patterns are worth investigating?
* What happens if I clean the data?
* Can I compare the original dataset with the cleaned version?

CSVette brings these steps together in one workspace.

Upload → Understand → Find Problems → Explore → Clean → Visualize → Export**


 ✦ Features

 Data Quality Analysis

Automatically profile your dataset and identify:

* Missing values and missing-value patterns
* Duplicate rows
* Duplicate identifiers
* Constant columns
* Category inconsistencies
* Type violations
* Identifier issues
* Potential outliers
* Overall data health

The health score combines:

Completeness · Uniqueness · Consistency · Validity


 Data Explorer

Explore your data interactively with:

* Global search
* Match highlighting
* Type-aware filters
* Multiple filters with AND logic
* Sorting
* Pagination
* Deep links from quality findings directly into relevant rows and columns


 Visualizations

Create visualizations directly from your dataset:

* Histograms
* Box plots
* Bar charts
* Aggregated charts
* Scatter plots
* Date-based line charts
* Pearson correlation matrix

Charts respect the current filtered dataset and provide context about the data being visualized.



 Data Cleaning

Clean your working dataset without modifying the original:

* Remove duplicate rows
* Fill missing values
* Trim whitespace
* Normalize text case
* Replace values
* Rename columns
* Delete columns
* Delete selected rows

Every successful modification is tracked in history.

**Undo** and **Reset** let you safely experiment with your data.



 Insights

CSVette automatically surfaces useful observations such as:

* Significant missingness
* Duplicate records
* Highly concentrated categories
* High-cardinality columns
* Potential outliers
* Distribution asymmetry
* High variability
* Strong or moderate correlations

Insights are linked back to the relevant part of the application so you can investigate them rather than simply reading a warning.



 Export & Reporting

Export:

* Original CSV
* Working/cleaned CSV
* Current filtered view

CSVette can also generate a standalone **Data Quality Report** containing dataset statistics, quality findings, insights, column information, and cleaning history.



 ✦ Privacy by Design

CSVette is entirely client-side.

Your CSV stays in your browser.

There is:

* No backend
* No database
* No account
* No dataset upload
* No API key
* No cloud processing

Local storage is used only for application preferences such as theme settings.



 ✦ Design

CSVette uses a restrained data-product interface built around:

* Paper and Graphite themes
* IBM Plex typography
* Data-focused visual hierarchy
* Responsive layouts
* Accessible interaction states
* Subtle motion and transitions
* Reduced-motion support

The interface is intentionally designed to keep data and analysis at the center rather than overwhelming the user with decorative UI.



 ✦ Performance

CSVette is designed to work entirely in the browser while remaining responsive across typical CSV workflows.

During final QA, the application was tested with datasets up to **50,000 rows**.

Representative measurements included:

| Dataset           |                           Result |
| ----------------- | -------------------------------: |
| 1,000 rows        |         Near-instant interaction |
| 10,000 rows       |           ~2s initial processing |
| 50,000 rows       | A few seconds initial processing |
| 50,000-row search |                            ~15ms |
| 50,000-row sort   |                            ~15ms |
| 2.1MB CSV export  |                            ~92ms |

Initial processing of very large datasets can block the browser briefly because CSVette intentionally keeps processing client-side.



 ✦ Testing

CSVette went through a full functional and browser QA cycle.

Current automated regression suite:

336 / 336 tests passing

Coverage includes:

* Data cleaning
* Filtering
* Visualization data preparation
* CSV export
* Data quality reports
* Automated insights

Browser QA additionally covered:

* Dataset switching
* Deep links
* Search and filters
* Sorting and pagination
* Cleaning and undo/reset
* Charts and correlations
* Insights
* CSV exports
* Report generation
* Dark/light themes
* Mobile layouts
* Accessibility
* Security/XSS cases
* Large datasets
* GitHub Pages compatibility



 ✦ Tech Stack

* HTML5
* CSS3
* Vanilla JavaScript
* ES Modules
* Papa Parse for CSV parsing
* SVG for data visualizations
* localStorage for user preferences
* GitHub Pages for deployment

No frontend framework and no build step.



 ✦ Architecture

CSVette is structured as a modular client-side application.


CSVette
│
├── CSV Parsing
├── Dataset State
├── Data Profiling
├── Quality Engine
├── Data Explorer
├── Statistics
├── Visualization Engine
├── Cleaning Engine
├── Insights Engine
├── Export / Reporting
└── UI / Routing


The original dataset and working dataset are kept separate so cleaning operations remain non-destructive.

Core analysis logic is separated from UI rendering where possible, allowing the data engines to be tested independently.


 ✦ Run Locally

Clone the repository and serve the project over HTTP.

bash
python serve.py 8000


Or:

bash
python -m http.server 8000


Then open:

text
http://localhost:8000


CSVette does not require a backend or build process.

 ✦ Deployment

CSVette is designed for static hosting and can be deployed directly through GitHub Pages.

There is no build step.

 ✦ License

MIT License
