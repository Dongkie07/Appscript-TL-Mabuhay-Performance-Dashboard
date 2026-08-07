/**
 * Transforms aggregates into browser response models.
 */

function buildDashboardResponse_(context) {
  const salesSource = context.sources.sales;
  const expenseSource = context.sources.expenses;
  const customerSource = context.sources.customers;
  const aggregation = context.aggregation;
  return {
    meta: buildDashboardMeta_(context),
    availableDateRange: {
      min: formatDate_(
        salesSource.minDate,
        context.timezone
      ),
      max: formatDate_(
        salesSource.maxDate,
        context.timezone
      )
    },
    filtersApplied: buildAppliedFilters_(
      context.filters,
      context.timezone
    ),
    options: buildFilterOptions_(salesSource),
    kpis: buildDashboardKpis_(context.dashboardTotals),
    charts: buildDashboardCharts_(
      aggregation,
      context.branchSummaries
    ),
    capacityDeferred: true,
    branches: context.branchSummaries,
    health: {
      salesRowsRead: salesSource.rows.length,
      salesRowsMatched: aggregation.salesRowsMatched,
      expenseRowsRead: expenseSource.rows.length,
      expenseRowsMatched: aggregation.expenseRowsMatched,
      customerRowsRead: customerSource.rows.length,
      customerRowsMatched: aggregation.customerRowsMatched,
      branchesMatched: context.branchSummaries.length
    }
  };
}

function buildDashboardMeta_(context) {
  return {
    title: DASHBOARD_CONFIG.TITLE,
    spreadsheetName: context.spreadsheet.getName(),
    readOnly: true,
    refreshedAt: Utilities.formatDate(
      new Date(),
      context.timezone,
      'yyyy-MM-dd HH:mm:ss'
    ),
    dataAsOf: context.aggregation.selectedMaxDate
      ? formatDate_(
          context.aggregation.selectedMaxDate,
          context.timezone
        )
      : null,
    timezone: context.timezone,
    processingMs:
      Date.now() - context.processingStartedAt,
    sourceCacheStatus:
      context.sourceResult.cacheStatus,
    resultCacheStatus: 'MISS',
    sourceCachedAt: Utilities.formatDate(
      context.sourceResult.cachedAt,
      context.timezone,
      'yyyy-MM-dd HH:mm:ss'
    ),
    sourceCacheMinutes: Math.round(
      DASHBOARD_CONFIG.SOURCE_CACHE_SECONDS / 60
    ),
    trendBucket: context.aggregation.trendBucketMode,
    autoRefreshMinutes: 0
  };
}

function buildAppliedFilters_(filters, timezone) {
  return {
    startDate: formatDate_(filters.startDate, timezone),
    endDate: formatDate_(filters.endDate, timezone),
    region: filters.region,
    branch: filters.branch
  };
}

function buildFilterOptions_(salesSource) {
  const regionOptions = Object.keys(
    salesSource.regions
  );
  const branchKeys = Object.keys(
    salesSource.canonicalBranches
  );
  const branchOptions = [];

  regionOptions.sort(regionSort_);
  for (
    let branchIndex = 0;
    branchIndex < branchKeys.length;
    branchIndex += 1
  ) {
    const branchKey = branchKeys[branchIndex];
    const branch = salesSource.canonicalBranches[branchKey];

    branchOptions.push({
      branchKey: branchKey,
      branchName: branch.branchName,
      region: branch.region
    });
  }

  branchOptions.sort(compareBranchNames_);

  return {
    regions: regionOptions,
    branches: branchOptions
  };
}

function compareBranchNames_(firstBranch, secondBranch) {
  return firstBranch.branchName.localeCompare(
    secondBranch.branchName
  );
}

function buildDashboardKpis_(totals) {
  const targetAchievement = percentageOrNull_(
    totals.sales,
    totals.target
  );
  const averageTicket = divideOrDefault_(
    totals.sales,
    totals.transactions,
    0
  );
  const tdcUtilization = percentageOrNull_(
    totals.tdcUsed,
    totals.tdcAllocated
  );
  const pdcUtilization = percentageOrNull_(
    totals.pdcUsed,
    totals.pdcAllocated
  );
  const tdcTrendCurrentUtilization = percentageOrNull_(
    totals.tdcTrendCurrentUsed,
    totals.tdcTrendCurrentAllocated
  );
  const tdcTrendPreviousUtilization = percentageOrNull_(
    totals.tdcTrendPreviousUsed,
    totals.tdcTrendPreviousAllocated
  );
  const pdcTrendCurrentUtilization = percentageOrNull_(
    totals.pdcTrendCurrentUsed,
    totals.pdcTrendCurrentAllocated
  );
  const pdcTrendPreviousUtilization = percentageOrNull_(
    totals.pdcTrendPreviousUsed,
    totals.pdcTrendPreviousAllocated
  );
  return {
    sales: round2_(totals.sales),
    target: round2_(totals.target),
    targetAchievement: nullableRound2_(
      targetAchievement
    ),
    transactions: round2_(totals.transactions),
    averageTicket: round2_(averageTicket),
    customers: round2_(totals.customers),
    expenses: round2_(totals.expenses),
    salesLessDisbursements: round2_(
      totals.sales - totals.expenses
    ),
    tdcUtilization: nullableRound2_(tdcUtilization),
    tdcTrend: createUtilizationTrend_(
      tdcTrendCurrentUtilization,
      tdcTrendPreviousUtilization
    ),
    pdcUtilization: nullableRound2_(pdcUtilization),
    pdcTrend: createUtilizationTrend_(
      pdcTrendCurrentUtilization,
      pdcTrendPreviousUtilization
    )
  };
}

function buildCapacityView_(
  capacitySnapshots,
  weeklyBusiness,
  canonicalBranches,
  filters
) {
  return {
    basis: 'LATEST_AVAILABLE_PER_BRANCH',
    officialBranchCount: countSelectedOfficialBranches_(
      canonicalBranches,
      filters
    ),
    tdc: buildCapacityCourseView_(
      capacitySnapshots,
      weeklyBusiness,
      canonicalBranches,
      filters,
      'tdc',
      'TDC'
    ),
    pdc: buildCapacityCourseView_(
      capacitySnapshots,
      weeklyBusiness,
      canonicalBranches,
      filters,
      'pdc',
      'PDC'
    )
  };
}

function buildCapacityCourseView_(
  capacitySnapshots,
  weeklyBusiness,
  canonicalBranches,
  filters,
  coursePrefix,
  courseCode
) {
  const branchKeys = getSelectedOfficialBranchKeys_(
    canonicalBranches,
    filters
  );
  const branches = [];
  const summaryTotals = createCapacitySummaryTotals_();

  for (
    let branchIndex = 0;
    branchIndex < branchKeys.length;
    branchIndex += 1
  ) {
    const branchKey = branchKeys[branchIndex];
    const officialBranch = canonicalBranches[branchKey] || {};
    const orderedSnapshots = getOrderedCapacitySnapshots_(
      capacitySnapshots[branchKey]
    );
    const courseSnapshots = getCourseCapacitySnapshots_(
      orderedSnapshots,
      coursePrefix
    );
    let branchView;

    if (courseSnapshots.length) {
      branchView = buildCapacityBranchView_(
        branchKey,
        courseSnapshots,
        coursePrefix,
        weeklyBusiness
      );
      addCapacityBranchToSummary_(
        summaryTotals,
        branchView
      );
    } else {
      branchView = createEmptyCapacityBranchView_(
        branchKey,
        officialBranch
      );
    }

    branches.push(branchView);
  }

  const freshnessSummary = applyCapacityFreshness_(branches);

  branches.sort(compareCapacityBranches_);

  const summary = finalizeCapacitySummary_(summaryTotals);
  summary.coverage.officialBranches = branchKeys.length;
  summary.coverage.branchesWithoutUsableUtilization = Math.max(
    branchKeys.length - summary.coverage.branchesWithUtilization,
    0
  );
  summary.coverage.currentBranches =
    freshnessSummary.currentBranches;
  summary.coverage.branchesBehindLatest =
    freshnessSummary.branchesBehindLatest;
  summary.coverage.staleBranches =
    freshnessSummary.staleBranches;
  summary.coverage.branchesWithoutRecord =
    freshnessSummary.branchesWithoutRecord;
  summary.latestReportingPeriod = {
    periodKey: freshnessSummary.latestPeriodKey,
    periodLabel: freshnessSummary.latestPeriodLabel
  };
  return {
    courseCode: courseCode,
    summary: summary,
    branches: branches
  };
}

function buildDashboardCharts_(
  aggregation,
  branchSummaries
) {
  return {
    salesTrend: buildSalesTrendSeries_(
      aggregation.salesTrend
    ),
    serviceMix: topSeries_(
      aggregation.serviceMix,
      6
    ),
    customerMix: topSeries_(
      aggregation.customerMix,
      6
    ),
    expenseMix: topSeries_(
      aggregation.expenseMix,
      6
    ),
    topBranches: buildTopBranchSeries_(
      branchSummaries,
      10
    )
  };
}

function buildSalesTrendSeries_(salesTrend) {
  const trendKeys = Object.keys(salesTrend);
  const series = [];

  trendKeys.sort();

  for (
    let trendIndex = 0;
    trendIndex < trendKeys.length;
    trendIndex += 1
  ) {
    const trend = salesTrend[trendKeys[trendIndex]];
    series.push({
      key: trend.key,
      label: trend.label,
      sales: round2_(trend.sales),
      transactions: round2_(trend.transactions)
    });
  }

  return series;
}

function buildTopBranchSeries_(branchSummaries, limit) {
  const topBranches = branchSummaries.slice(0, limit);
  const series = [];
  for (
    let branchIndex = 0;
    branchIndex < topBranches.length;
    branchIndex += 1
  ) {
    const branch = topBranches[branchIndex];
    series.push({
      label: branch.branchName,
      value: branch.sales,
      target: branch.target
    });
  }

  return series;
}
