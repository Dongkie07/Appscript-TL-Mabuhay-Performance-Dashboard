# TL Mabuhay Performance Dashboard

A read-only Google Apps Script web dashboard for sales, monthly achievement, disbursements, customers, TDC/PDC utilization, trends, and source-to-collection slot sharing.

## What changed in this clean architecture

- Large server files were split into `web`, `infrastructure`, `repositories`, `domain`, and `services` modules.
- Large HTML, CSS, and browser JavaScript files were split into ordered includes.
- `ui/Index.html` is now a small composition file instead of a monolithic page.
- Disbursement columns are found by header name, so inserted columns such as `CH` do not shift the parser.
- Monthly achievement follows the redesigned `SLSAch%` source logic from `CATEGORY OF SALES V2`.
- Weekly reporting uses Sunday through Saturday to match `DlySLSTrd`.
- The TDC/PDC tab includes **Slot sharing**, identifying source/lender and collection/borrower branches where the Sheet provides them.
- Source and filtered results remain cached, with a 15-minute warm-cache task available.
- `tools/validate.mjs` verifies server syntax, duplicate server functions, HTML includes, and rendered client JavaScript before a push.

## Repository layout

```text
src/
  appsscript.json
  config/          Application settings and cache versions
  web/             Public endpoints and admin tasks
  infrastructure/  Memory, source, and filtered-result caching
  repositories/    Read-only Sheet access and normalization
  domain/          Filters, dates, numbers, normalizers, capacity, trends
  services/        Dashboard, pivot, slot, trend, and response services
  ui/
    Index.html      Page composition root
    views/          HTML views and panels
    styles/         Ordered core style fragments
    scripts/        Main dashboard browser modules
    features/       Executive reporting and slot-sharing features
tools/
  validate.mjs     Static validation
```

See [Architecture](docs/ARCHITECTURE.md), [Data contract](docs/DATA_CONTRACT.md), and [Migration](docs/MIGRATION.md).

## Local setup with clasp

Google recommends `clasp` for local Apps Script development and source control.

```bash
npm install
cp .clasp.json.example .clasp.json
```

Open `.clasp.json` and replace `PASTE_YOUR_APPS_SCRIPT_ID_HERE` with the Script ID from Apps Script **Project Settings**.

Enable the Apps Script API in your Google account, then run:

```bash
npm run gas:login
npm run validate
npm run gas:push
npm run gas:open
```

### Bound versus standalone project

The included manifest uses the narrow `spreadsheets.currentonly` scope and is intended for a project bound to the source workbook.

- **Bound project:** leave `DASHBOARD_CONFIG.SPREADSHEET_ID` blank.
- **Standalone project:** set the spreadsheet ID and change the OAuth scope in `src/appsscript.json` to `https://www.googleapis.com/auth/spreadsheets`.

## First deployment

After pushing:

1. Run `warmDashboardCache()` manually once and approve permissions.
2. Run `installDashboardWarmCacheTrigger()` once.
3. Deploy a new web-app version.
4. Open the deployment and click **Refresh** once.

The manifest currently preserves the existing anonymous web-app access setting. For an internal dashboard, change web-app access in the deployment settings to the narrowest audience your organization supports.

## Public server functions

| Function | Purpose |
|---|---|
| `getDashboardData(filters)` | Main dashboard payload |
| `getExecutiveSalesSupport(filters)` | Monthly sales and all trend groupings |
| `getSlotUtilizationData(filters)` | TDC/PDC utilization and data quality |
| `getSlotSharingData(filters)` | Source/lender to collection/borrower relationships |
| `clearDashboardCache()` | Clears normalized and filtered caches |
| `warmDashboardCache()` | Rebuilds common cached views |
| `installDashboardWarmCacheTrigger()` | Creates the 15-minute warm-cache trigger |

## Slot-sharing interpretation

- **Lender/source:** `Final Branch (SOURCE)`; `SOURCE` is used only as fallback.
- **Borrower/collector:** `COLLECTION BRANCH`.
- **TDC slots:** `Daily TDC Lent Slots`.
- **PDC slots:** `Daily PDC Lent Slots`.
- Rows with lent slots but no usable source branch are shown as **Source branch pending** and are not attributed to a lender.

## Validation

Run before every push:

```bash
npm run validate
```

GitHub Actions also runs the same validation on pushes and pull requests.

## Updating after a Sheet format change

1. Update the relevant repository or aliases.
2. Increment `SOURCE_CACHE_VERSION` if normalized data changes.
3. Increment `RESULT_CACHE_VERSION` if response calculations or JSON shapes change.
4. Run validation, push, warm the cache, and deploy a new version.
