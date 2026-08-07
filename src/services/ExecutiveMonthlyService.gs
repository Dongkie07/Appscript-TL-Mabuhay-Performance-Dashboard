/**
 * Preloaded monthly snapshot support.
 */

function executiveBuildPreloadedMonthSnapshot_(
  salesSource,
  filters,
  timezone,
  preparedResponse,
  sharedTrendBucketCache
) {
  const anchor = filters.endDate;

  if (!(anchor instanceof Date) || isNaN(anchor.getTime())) {
    return null;
  }

  const monthStart = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    1
  );
  const monthEnd = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + 1,
    0
  );
  const sourceMinimum = salesSource.minDate;
  const sourceMaximum = salesSource.maxDate;

  if (
    sourceMinimum instanceof Date &&
    monthEnd < sourceMinimum
  ) {
    return null;
  }

  if (
    sourceMaximum instanceof Date &&
    monthStart > sourceMaximum
  ) {
    return null;
  }

  const boundedStart =
    sourceMinimum instanceof Date && sourceMinimum > monthStart
      ? new Date(sourceMinimum.getTime())
      : monthStart;
  const boundedEnd =
    sourceMaximum instanceof Date && sourceMaximum < monthEnd
      ? new Date(sourceMaximum.getTime())
      : monthEnd;
  const monthlyFilters = {
    startDate: boundedStart,
    endDate: boundedEnd,
    region: filters.region,
    branch: filters.branch
  };

  if (executiveSameDateRange_(filters, monthlyFilters)) {
    return executiveCompactMonthlySnapshot_(preparedResponse);
  }

  const aggregation = executiveCreateAggregation_();

  executiveAggregateSales_(
    salesSource,
    monthlyFilters,
    timezone,
    aggregation,
    sharedTrendBucketCache
  );

  const officialResult = executiveCalculatePivotAchievement_(
    salesSource,
    monthlyFilters
  );
  const branchSummaries = executiveBuildBranchSummaries_(
    salesSource,
    monthlyFilters,
    aggregation,
    officialResult
  );
  const kpis = executiveBuildKpis_(
    branchSummaries,
    aggregation,
    officialResult
  );

  return {
    filtersApplied: {
      startDate: formatDate_(boundedStart, timezone),
      endDate: formatDate_(boundedEnd, timezone),
      region: monthlyFilters.region,
      branch: monthlyFilters.branch
    },
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
    preloaded: true
  };
}

function executiveCompactMonthlySnapshot_(response) {
  return {
    filtersApplied: response.filtersApplied,
    branches: response.branches,
    regions: response.regions,
    kpis: response.kpis,
    branchAchievementCount: response.branchAchievementCount,
    transactionSource: response.transactionSource,
    officialAchievement: response.officialAchievement,
    reconciliation: response.reconciliation,
    preloaded: true
  };
}

function executiveSameDateRange_(firstFilters, secondFilters) {
  return Boolean(
    firstFilters &&
    secondFilters &&
    firstFilters.startDate instanceof Date &&
    firstFilters.endDate instanceof Date &&
    secondFilters.startDate instanceof Date &&
    secondFilters.endDate instanceof Date &&
    firstFilters.startDate.getTime() ===
      secondFilters.startDate.getTime() &&
    firstFilters.endDate.getTime() ===
      secondFilters.endDate.getTime() &&
    firstFilters.region === secondFilters.region &&
    firstFilters.branch === secondFilters.branch
  );
}
