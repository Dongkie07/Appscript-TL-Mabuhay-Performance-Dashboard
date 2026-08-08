/**
 * SLSAch%-aligned executive and monthly reporting orchestration.
 */
/**
 * Executive sales reporting aligned with the redesigned SLSAch% pivots.
 *
 * SLSAch% now reads CATEGORY OF SALES V2 directly and excludes General
 * Service Type NON and REPRINT. Its achievement values are SUMs of the
 * row-level contribution columns:
 *   M = company achievement contribution
 *   N = region achievement contribution
 *   O = branch achievement contribution
 * Monthly targets are the repeated J/K/L values, counted once per month at
 * the company, region, or branch level.
 *
 * The dedicated Sales Trends view follows the same NON/REPRINT exclusion.
 * Overview encoded collections remain available from the base dashboard.
 * This file is read-only and never writes to the spreadsheet.
 */
function buildDashboardDataWithMonthlyTargetFix_(requestedFilters) {
  const filters = requestedFilters || {};
  const dashboardData = buildDashboardData_(filters);
  const executiveFilters = Object.assign({}, filters, {
    // buildDashboardData_ already performed the forced source refresh.
    // Avoid reading the complete workbook a second time in the same request.
    forceRefresh: false
  });
  const executiveData = buildExecutiveSalesSupport_(executiveFilters);
  applyExecutiveDataToDashboard_(dashboardData, executiveData);

  return dashboardData;
}
function buildExecutiveSalesSupport_(requestedFilters) {
  const request = requestedFilters || {};
  const spreadsheet = getSpreadsheet_();
  const forceRefresh = request.forceRefresh === true;
  const sourceResult = getDashboardSourcesCached_(
    spreadsheet,
    forceRefresh
  );
  const salesSource = sourceResult.sources.sales;
  const filters = normalizeFilters_(
    request,
    salesSource.minDate,
    salesSource.maxDate
  );
  const resultType = 'EXECUTIVE_PERF_V13_CLEAN_ARCH';
  if (!forceRefresh) {
    const cached = readDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      resultType
    );

    if (cached) {
      cached.cacheStatus = 'HIT';
      return cached;
    }
  }

  const response = buildExecutiveSalesDataFromSources_(
    spreadsheet,
    sourceResult,
    salesSource,
    filters
  );
  try {
    writeDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      resultType,
      response
    );
  } catch (cacheError) {
    console.warn(
      'Executive result cache write failed: ' + cacheError
    );
  }

  return response;
}
function buildExecutiveSalesDataFromSources_(
  spreadsheet,
  sourceResult,
  salesSource,
  filters
) {
  const timezone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const aggregation = executiveCreateAggregation_();
  const sharedTrendBucketCache = Object.create(null);

  executiveAggregateSales_(
    salesSource,
    filters,
    timezone,
    aggregation,
    sharedTrendBucketCache
  );
  /*
   * The current SLSAch% pivots use CATEGORY OF SALES V2 itself. The required
   * J:O and AZ:BI values are already present in the normalized sales source,
   * so no additional Sheet read is needed here.
   */
  const officialResult = executiveCalculatePivotAchievement_(
    salesSource,
    filters
  );
  const branchSummaries = executiveBuildBranchSummaries_(
    salesSource,
    filters,
    aggregation,
    officialResult
  );
  const kpis = executiveBuildKpis_(
    branchSummaries,
    aggregation,
    officialResult
  );
  const trendMode = executiveResolveTrendMode_(
    'AUTO',
    filters.startDate,
    filters.endDate
  );
  const trends = {
    DAY: executiveBuildTrendSeries_(aggregation.trends.DAY),
    WEEK: executiveBuildTrendSeries_(aggregation.trends.WEEK),
    MONTH: executiveBuildTrendSeries_(aggregation.trends.MONTH),
    YEAR: executiveBuildTrendSeries_(aggregation.trends.YEAR)
  };
  const encodedTrends = {
    DAY: executiveBuildTrendSeries_(aggregation.encodedTrends.DAY),
    WEEK: executiveBuildTrendSeries_(aggregation.encodedTrends.WEEK),
    MONTH: executiveBuildTrendSeries_(aggregation.encodedTrends.MONTH),
    YEAR: executiveBuildTrendSeries_(aggregation.encodedTrends.YEAR)
  };
  const response = {
    filtersApplied: {
      startDate: formatDate_(filters.startDate, timezone),
      endDate: formatDate_(filters.endDate, timezone),
      region: filters.region,
      branch: filters.branch
    },
    trendMode: trendMode,
    trend: trends[trendMode] || trends.DAY,
    trends: trends,
    encodedTrend: encodedTrends[trendMode] || encodedTrends.DAY,
    encodedTrends: encodedTrends,
    serviceMix: topSeries_(aggregation.serviceMix, 6),
    topBranches: executiveBuildTopBranches_(branchSummaries, 10),
    branches: branchSummaries,
    regions: executiveBuildRegionSummaries_(officialResult),
    kpis: kpis,
    branchAchievementCount: kpis.branchAchievementCount,
    transactionSource: {
      sheet: DASHBOARD_CONFIG.SALES_SHEET,
      column: 'BH',
      aggregation: 'SUM'
    },
    officialAchievement: {
      sourceSheet: officialResult.source,
      target: round2_(officialResult.selectedTarget),
      actualCollections: round2_(officialResult.selectedActual),
      targetAchievement: nullableRound2_(
        officialResult.selectedAchievement
      ),
      scope: officialResult.scope,
      branchRecordCount: officialResult.achievementCount
    },
    reconciliation: executiveBuildReconciliation_(
      aggregation,
      officialResult
    ),
    cacheStatus: sourceResult.cacheStatus || 'MISS',
    cachedAt:
      sourceResult.cachedAt instanceof Date
        ? sourceResult.cachedAt.toISOString()
        : String(sourceResult.cachedAt || '')
  };
  /*
   * Preload the month represented by the selected end date. This uses the
   * source data that is already in memory, so opening Monthly Sales does not
   * need another server request. The snapshot is intentionally compact: it
   * contains only the KPI and Region -> Branch detail needed by that tab.
   */
  response.monthlySnapshot = executiveBuildPreloadedMonthSnapshot_(
    salesSource,
    filters,
    timezone,
    response,
    sharedTrendBucketCache
  );

  return response;
}
function applyExecutiveDataToDashboard_(dashboardData, executiveData) {
  dashboardData.meta = dashboardData.meta || {};
  dashboardData.kpis = dashboardData.kpis || {};
  dashboardData.charts = dashboardData.charts || {};
  dashboardData.health = dashboardData.health || {};
  dashboardData.branches = dashboardData.branches || [];

  const executiveKpis =
    executiveData && executiveData.kpis
      ? executiveData.kpis
      : {};
  const reconciliation =
    executiveData && executiveData.reconciliation
      ? executiveData.reconciliation
      : {};

  dashboardData.kpis.officialActualCollections =
    executiveKpis.officialActualCollections;
  dashboardData.kpis.target = executiveKpis.target;
  dashboardData.kpis.targetAchievement =
    executiveKpis.targetAchievement;
  dashboardData.kpis.weightedTargetAchievement =
    executiveKpis.weightedTargetAchievement;
  dashboardData.kpis.reportedTargetProgress =
    executiveKpis.reportedTargetProgress;
  dashboardData.kpis.branchAchievementCount =
    executiveKpis.branchAchievementCount;
  dashboardData.kpis.encodedCollections =
    executiveKpis.encodedCollections;
  dashboardData.kpis.excludedCollections =
    executiveKpis.excludedCollections;

  applyPivotBranchesToDashboard_(
    dashboardData,
    executiveData.branches || []
  );

  dashboardData.meta.salesReportingRule =
    'OVERVIEW_ENCODED_MONTHLY_AND_BRANCH_SLSACH';
  dashboardData.meta.targetAchievementMethod =
    'CUMULATIVE_ACTUAL_DIVIDED_BY_CUMULATIVE_TARGET';
  dashboardData.health.salesRowsExcludedFromTrends =
    Number(reconciliation.excludedRows) || 0;

  // Unified UI contract. Monthly Sales and Trends no longer make a
  // second executive request, so all fields needed by those views must
  // be forwarded here.
  dashboardData.executiveSales = {
    filtersApplied: executiveData.filtersApplied || null,
    kpis: executiveKpis,
    reconciliation: reconciliation,
    officialAchievement:
      executiveData.officialAchievement || null,
    branchAchievementCount:
      Number(
        executiveData.branchAchievementCount ??
          executiveKpis.branchAchievementCount
      ) || 0,
    weightedTargetAchievement:
      executiveKpis.weightedTargetAchievement == null
        ? null
        : executiveKpis.weightedTargetAchievement,
    reportedTargetProgress:
      executiveKpis.reportedTargetProgress == null
        ? null
        : executiveKpis.reportedTargetProgress,
    regions: executiveData.regions || [],
    branches: executiveData.branches || [],
    trendMode: executiveData.trendMode || 'DAY',
    trend: executiveData.trend || [],
    trends: executiveData.trends || {},
    encodedTrend: executiveData.encodedTrend || [],
    encodedTrends: executiveData.encodedTrends || {},
    serviceMix: executiveData.serviceMix || [],
    topBranches: executiveData.topBranches || [],
    monthlySnapshot: executiveData.monthlySnapshot || null,
    cacheStatus: executiveData.cacheStatus || 'MISS',
    cachedAt: executiveData.cachedAt || ''
  };
}
function applyPivotBranchesToDashboard_(dashboardData, pivotBranches) {
  const pivotByKey = Object.create(null);
  const dashboardByKey = Object.create(null);

  for (let index = 0; index < pivotBranches.length; index += 1) {
    pivotByKey[pivotBranches[index].branchKey] = pivotBranches[index];
  }
  for (let index = 0; index < dashboardData.branches.length; index += 1) {
    const branch = dashboardData.branches[index];
    const pivot = pivotByKey[branch.branchKey];
    dashboardByKey[branch.branchKey] = true;

    if (!pivot) continue;
    branch.branchName = pivot.branchName || branch.branchName;
    branch.region = pivot.region || branch.region;
    branch.sales = round2_(pivot.sales);
    branch.target = round2_(pivot.target);
    branch.targetAchievement = nullableRound2_(
      pivot.targetAchievement
    );
    branch.transactions = round2_(pivot.transactions);
    branch.averageTicket = round2_(pivot.averageTicket);
    branch.salesLessDisbursements = round2_(
      branch.sales - numberOrZero_(branch.expenses)
    );
  }
  for (let index = 0; index < pivotBranches.length; index += 1) {
    const pivot = pivotBranches[index];

    if (dashboardByKey[pivot.branchKey]) continue;
    dashboardData.branches.push({
      branchKey: pivot.branchKey,
      branchName: pivot.branchName,
      region: pivot.region,
      sales: round2_(pivot.sales),
      target: round2_(pivot.target),
      targetAchievement: nullableRound2_(pivot.targetAchievement),
      transactions: round2_(pivot.transactions),
      averageTicket: round2_(pivot.averageTicket),
      customers: 0,
      expenses: 0,
      salesLessDisbursements: round2_(pivot.sales),
      tdcAllocated: null,
      tdcUsed: null,
      tdcPreviousAllocated: null,
      tdcPreviousUsed: null,
      tdcUtilization: null,
      tdcTrend: createUtilizationTrend_(null, null),
      pdcAllocated: null,
      pdcUsed: null,
      pdcPreviousAllocated: null,
      pdcPreviousUsed: null,
      pdcUtilization: null,
      pdcTrend: createUtilizationTrend_(null, null)
    });
  }
  dashboardData.branches.sort(function sortPivotBranches(first, second) {
    if (second.sales !== first.sales) {
      return second.sales - first.sales;
    }

    return first.branchName.localeCompare(second.branchName);
  });
}
