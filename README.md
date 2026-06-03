# GitHub Copilot Billing Preview

A web application for previewing and comparing your future GitHub Copilot bills as you transition to the new usage-based billing model. Upload your CSV billing reports to explore requests, costs, AI Credits, and trends across users, organizations, models, and cost centers.

Production instance: <https://copilot-billing-preview.github.com/>

This project is in active development. It is intended to help GitHub Copilot customers understand usage-based billing preview data during the transition period.

## Features

- Parse GitHub Copilot usage billing CSV reports in the browser
- Compare request-based and usage-based billing signals
- Explore usage and cost trends by user, organization, model, product, and cost center
- Review AI Credit usage, included credits, and cost management views
- **License Optimizer** — find the lowest-cost Business/Enterprise seat mix based on actual AIC usage

## What's new in this branch (`feature/duckdb-wasm-integration`)

### DuckDB-WASM query engine

The data pipeline has been rewritten to use [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview.html) as an in-browser analytical query engine. CSV rows are streamed, normalized, and loaded into a DuckDB table, then all aggregations run as parallel SQL queries instead of hand-rolled JavaScript reducers.

**Why this matters:**
- Faster processing for large reports — SQL runs close to the data, in a single pass
- Simpler, more maintainable aggregation logic
- Identical behavior in browser (WASM workers) and Node.js/Vitest (worker adapter)

**Technical details:**
- `src/db/duckdb.ts` — DuckDB singleton; selects WASM bundle in browser, uses a Node worker adapter in test environments
- `src/db/appender.ts` — columnar row buffer that flushes via Apache Arrow IPC stream (the only reliable insertion path in DuckDB-WASM)
- `src/db/schema.ts` — canonical `usage` table DDL
- `src/pipeline/runPipelineDuckDB.ts` — full pipeline: stream CSV → normalize → AIC-allocate → append to DuckDB → run 8 parallel SQL queries → return structured results

### License Optimizer

A new page (`License Optimizer` in the sidebar, available for organization reports) helps you find the cheapest combination of Business and Enterprise seats given your actual AIC usage from the uploaded report.

**Features:**

| Feature | Description |
|---------|-------------|
| Optimal mix recommendation | Finds the Business/Enterprise split that minimizes monthly spend (license fees + AIC overage) subject to your minimum seat constraint |
| Cost grid | Interactive table of costs across ±10/25/50/100 seats around the optimal — click any cell to inspect it |
| Current config comparison | Side-by-side breakdown of current config vs recommended (or selected) mix with savings/premium delta |
| Fixed total seats mode | Checkbox to constrain the search to exactly N total seats — finds the best B/E split for that total |
| Annual projection | Toggle to view all costs as monthly or annual (×12) figures |
| Break-even guide | Explains the AIC unit thresholds at which each seat type pays off vs pure overage pricing |
| Zero-AIC user insight | Flags users with no AIC usage in the report period — they only need a base Business seat |
| CSV export | Downloads a summary of current config, recommended mix, fixed-total optimal, and selected cell |

**Seat constraint fix:** The optimizer respects your configured seat total (from the seat override UI) as the minimum floor, not just the number of active users in the report. This prevents scenarios where the optimizer recommends fewer seats than you actually have contracted.

**Pricing model used:**
- Business: $19/month, 3,000 AIC units included
- Enterprise: $39/month, 7,000 AIC units included
- AIC overage: $0.01/unit
- Business break-even: 1,900 AIC units/month
- Enterprise break-even: 3,900 AIC units/month
- Enterprise preferred over Business when marginal usage exceeds 2,000 additional units/month

## Scope and limitations

- This app is a preview and planning tool, not a source of record for billing.
- CSV files are processed locally in your browser; do not upload real billing reports to public issues, pull requests, or discussions.
- The app expects GitHub Copilot billing report CSVs that match the current format documented in [docs/report-format.md](docs/report-format.md).
- Billing calculations may change as GitHub Copilot usage-based billing evolves.

## Background

GitHub Copilot Billing Preview helps customers inspect usage-based billing CSV exports before relying on them for planning or budget conversations. For detailed CSV format expectations, see [docs/report-format.md](docs/report-format.md).

Contributions are welcome. Before opening an issue or pull request, avoid sharing real customer data, billing reports, screenshots with sensitive information, or any other private information. For contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Requirements

### Prerequisites

- Node.js 20.19.0+
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open your browser to the URL shown (typically `http://localhost:5173`)

### Build

```bash
npm run build
```

The production build will be created in the `dist/` directory.

### Test

```bash
npm run test
```

### Lint

```bash
npm run lint
```

### Hosting your own copy

You can deploy a private instance of this app to GitHub Pages:

1. **Fork the repository** - click **Fork** on the GitHub repository page to create a copy under your account or organization.

2. **Enable GitHub Pages** - in your fork, go to **Settings > Pages**, set the source to **GitHub Actions**, and save.

3. **Deploy** - the [`.github/workflows/pages.yml`](.github/workflows/pages.yml) workflow runs automatically on every push to `main`. It lints, tests, builds the app, and deploys it to your Pages URL (`https://<your-username>.github.io/<repo-name>/`). You can also trigger it manually from the **Actions** tab using the **Run workflow** button.

## License

This project is licensed under the terms of the MIT open source license. Please refer to the [LICENSE](./LICENSE) file for the full terms.

## Maintainers

Maintainers are listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).

## Support

Use GitHub issues to report bugs and request improvements once this repository is public. Do not attach billing CSV files or screenshots that contain sensitive billing information.

Support expectations are documented in [SUPPORT.md](SUPPORT.md).
