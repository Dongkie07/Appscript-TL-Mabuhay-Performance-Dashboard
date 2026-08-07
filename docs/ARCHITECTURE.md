# Architecture

## Request flow

```text
Browser
  -> public endpoint in src/web/WebApp.gs
  -> source/result cache in src/infrastructure
  -> read-only repositories in src/repositories
  -> domain helpers in src/domain
  -> reporting services in src/services
  -> compact JSON response
  -> client renderer in src/ui
```

## Server boundaries

- `web/`: public Apps Script functions and manual admin tasks.
- `infrastructure/`: memory cache, shared source cache, filtered result cache.
- `repositories/`: spreadsheet reads and normalization only.
- `domain/`: pure helpers for filters, dates, numbers, normalization, capacity, and trends.
- `services/`: aggregation and response construction.

Functions ending with `_` are private server functions. Public functions exposed to `google.script.run` are kept in `web/WebApp.gs`.

## Client organization

`ui/Index.html` is only the page composition root. Markup, CSS, and JavaScript are split into includes.

The numbered style files are intentionally included in order to preserve the original CSS cascade. Main and executive JavaScript are split into fragments that form one IIFE each after Apps Script template inclusion. Do not reorder the `AppStart`/`AppEnd` or `ExecutiveStart`/`ExecutiveEnd` includes.

## Cache model

1. A cold request reads each source tab in batches and normalizes rows.
2. The normalized source is stored in the shared script cache.
3. Filtered response objects are cached by date, region, branch, report type, and cache version.
4. The 15-minute trigger calls `warmDashboardCache()` to reduce cold starts.
5. The dashboard Refresh button forces a new source build.

Increment `SOURCE_CACHE_VERSION` when source normalization changes. Increment `RESULT_CACHE_VERSION` when response calculations or shapes change.
