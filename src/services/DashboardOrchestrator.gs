/**
 * Main dashboard orchestration and cache flow.
 */

/**
 * Coordinates dashboard data preparation.
 *
 * This layer does not know spreadsheet column positions. It receives normalized
 * records from SpreadsheetRepository.gs and turns them into dashboard metrics.
 */

function buildDashboardData_(requestedFilters) {
  const processingStartedAt = Date.now();
  const spreadsheet = getSpreadsheet_();
  const timezone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const forceRefresh =
    requestedFilters &&
    requestedFilters.forceRefresh === true;
  const sourceResult = getDashboardSourcesCached_(
    spreadsheet,
    forceRefresh
  );
  const sources = sourceResult.sources;

  assertSalesDatesExist_(sources.sales);

  const filters = normalizeFilters_(
    requestedFilters || {},
    sources.sales.minDate,
    sources.sales.maxDate
  );
  const cachedResponse = forceRefresh
    ? null
    : readDashboardResultCache_(
        spreadsheet,
        sourceResult,
        filters,
        'OVERVIEW'
      );

  if (cachedResponse) {
    return prepareCachedDashboardResponse_(
      cachedResponse,
      sourceResult,
      timezone,
      processingStartedAt
    );
  }

  const trendBucketMode = chooseTrendBucket_(
    filters.startDate,
    filters.endDate
  );
  const aggregation = createAggregationState_(
    trendBucketMode
  );

  // 1. Pre-populate all official branches so 0-sales branches exist in branchTotals
  initializeCanonicalBranches_(
    aggregation.branchTotals,
    sources.sales.canonicalBranches
  );

  // 2. Scan and capture only monthly targets that belong to the selected filter period
  aggregateMonthlyTargets_(
    sources.sales,
    filters,
    aggregation
  );

  // 3. Aggregate daily sales rows onto the initialized branches
  aggregateSalesRows_(
    sources.sales,
    filters,
    timezone,
    aggregation
  );

  applyMonthlyTargets_(aggregation);
  applyOverviewCapacity_(aggregation);

  aggregateExpenseRows_(
    sources.expenses,
    sources.sales.canonicalBranches,
    filters,
    aggregation
  );
  aggregateCustomerRows_(
    sources.customers,
    sources.sales.canonicalBranches,
    filters,
    aggregation
  );

  const branchSummaries = buildBranchSummaries_(
    aggregation.branchTotals
  );
  const dashboardTotals = calculateDashboardTotals_(
    branchSummaries
  );
  const response = buildDashboardResponse_({
    spreadsheet: spreadsheet,
    timezone: timezone,
    processingStartedAt: processingStartedAt,
    sourceResult: sourceResult,
    filters: filters,
    sources: sources,
    aggregation: aggregation,
    branchSummaries: branchSummaries,
    dashboardTotals: dashboardTotals
  });

  response.meta.resultCacheStatus = 'MISS';

  try {
    writeDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      'OVERVIEW',
      response
    );
  } catch (cacheError) {
    console.warn(
      'Dashboard filtered result cache write failed: ' +
      cacheError
    );
  }

  return response;
}

function prepareCachedDashboardResponse_(
  response,
  sourceResult,
  timezone,
  processingStartedAt
) {
  response.meta = response.meta || {};
  response.meta.processingMs =
    Date.now() - processingStartedAt;
  response.meta.sourceCacheStatus =
    sourceResult.cacheStatus;
  response.meta.sourceCachedAt = Utilities.formatDate(
    sourceResult.cachedAt,
    timezone,
    'yyyy-MM-dd HH:mm:ss'
  );
  response.meta.resultCacheStatus = 'HIT';

  return response;
}

function assertSalesDatesExist_(salesSource) {
  if (salesSource.minDate && salesSource.maxDate) {
    return;
  }

  throw new Error(
    'No valid transaction dates were found in "' +
    DASHBOARD_CONFIG.SALES_SHEET +
    '". Check that column BB contains real Google Sheets dates.'
  );
}
