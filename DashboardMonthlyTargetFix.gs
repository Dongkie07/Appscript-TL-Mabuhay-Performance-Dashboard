/**
 * Corrected overview dashboard builder.
 *
 * This file intentionally leaves DashboardService.gs unchanged. Code.gs calls
 * this builder instead of the old buildDashboardData_ function.
 */
function buildDashboardDataWithMonthlyTargetFix_(requestedFilters) {
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

  // Use a new cache namespace so the old ₱49.1M June result cannot be
  // returned after the source formula is corrected back to BA (collection branch).
  const cacheViewKey = 'OVERVIEW_MONTHLY_TARGET_FIX_V3';
  const cachedResponse = forceRefresh
    ? null
    : readDashboardResultCache_(
        spreadsheet,
        sourceResult,
        filters,
        cacheViewKey
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

  // Keep every official branch in the dashboard, including branches with
  // zero sales during the selected period.
  initializeCanonicalBranches_(
    aggregation.branchTotals,
    sources.sales.canonicalBranches
  );

  // Capture only targets whose month belongs to the selected date range.
  aggregateMonthlyTargetsFixed_(
    sources.sales,
    filters,
    aggregation
  );

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

  // Column J is the authoritative company monthly target in the source Sheet.
  // For an All regions / All branches request, reconcile any missing branch
  // target so the dashboard grand total matches the Sheet monthly total.
  const targetReconciliation = reconcileCompanyMonthlyTarget_(
    spreadsheet,
    filters,
    branchSummaries
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
  response.health.targetReconciliation = targetReconciliation;

  try {
    writeDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      cacheViewKey,
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

/**
 * Records one target per branch and month, but only for months contained in
 * the selected reporting period.
 *
 * Examples:
 * - July 1 to July 31: July target only.
 * - June 1 to July 31: June target plus July target.
 */
function aggregateMonthlyTargetsFixed_(
  salesSource,
  filters,
  aggregation
) {
  const selectedRegion =
    filters && filters.region
      ? filters.region
      : 'ALL';
  const selectedBranch =
    filters && filters.branch
      ? filters.branch
      : 'ALL';

  for (
    let rowIndex = 0;
    rowIndex < salesSource.rows.length;
    rowIndex += 1
  ) {
    const row = salesSource.rows[rowIndex];

    if (
      !row.branchKey ||
      Number(row.target || 0) <= 0 ||
      !row.year ||
      !row.month
    ) {
      continue;
    }

    if (
      !isTargetMonthInsideFilter_(
        row.year,
        row.month,
        filters
      )
    ) {
      continue;
    }

    const branchIdentity = resolveBranchIdentity_(
      row,
      salesSource.canonicalBranches
    );

    if (
      selectedRegion !== 'ALL' &&
      branchIdentity.region !== selectedRegion
    ) {
      continue;
    }

    if (
      selectedBranch !== 'ALL' &&
      row.branchKey !== selectedBranch
    ) {
      continue;
    }

    recordMonthlyTarget_(
      aggregation.monthlyTargets,
      row,
      branchIdentity
    );
  }
}

/**
 * Checks whether a YYYY-MM target period falls inside the selected date range.
 */
function isTargetMonthInsideFilter_(year, month, filters) {
  if (
    !filters ||
    !filters.startDate ||
    !filters.endDate
  ) {
    return true;
  }

  const numericYear = Number(year);
  const numericMonth = Number(month);

  if (
    !numericYear ||
    numericMonth < 1 ||
    numericMonth > 12
  ) {
    return false;
  }

  const targetMonthKey =
    numericYear * 100 + numericMonth;
  const startMonthKey = toYearMonthKey_(
    filters.startDate
  );
  const endMonthKey = toYearMonthKey_(
    filters.endDate
  );

  if (!startMonthKey || !endMonthKey) {
    return true;
  }

  return (
    targetMonthKey >= startMonthKey &&
    targetMonthKey <= endMonthKey
  );
}

/**
 * Converts a Date or a YYYY-MM-DD string to an integer such as 202607.
 */
function toYearMonthKey_(dateInput) {
  if (!dateInput) {
    return null;
  }

  if (
    dateInput instanceof Date ||
    typeof dateInput.getMonth === 'function'
  ) {
    return (
      dateInput.getFullYear() * 100 +
      (dateInput.getMonth() + 1)
    );
  }

  const dateText = String(dateInput).trim();
  const parts = dateText.split(/[-/]/);

  if (parts.length >= 2) {
    const year = Number(parts[0]);
    const month = Number(parts[1]);

    if (
      year &&
      month >= 1 &&
      month <= 12
    ) {
      return year * 100 + month;
    }
  }

  const parsedDate = new Date(dateText);

  if (!isNaN(parsedDate.getTime())) {
    return (
      parsedDate.getFullYear() * 100 +
      (parsedDate.getMonth() + 1)
    );
  }

  return null;
}

/**
 * Reconciles the branch-target total to the authoritative company target in
 * CATEGORY OF SALES V2 column J. This applies only when no region or branch
 * filter is selected.
 *
 * A positive difference is shown as an explicit "Unallocated monthly target"
 * row, rather than silently assigning the missing target to the wrong branch.
 */
function reconcileCompanyMonthlyTarget_(
  spreadsheet,
  filters,
  branchSummaries
) {
  const selectedRegion = filters && filters.region
    ? filters.region
    : 'ALL';
  const selectedBranch = filters && filters.branch
    ? filters.branch
    : 'ALL';

  if (selectedRegion !== 'ALL' || selectedBranch !== 'ALL') {
    return {
      applied: false,
      authoritativeTarget: null,
      branchTargetTotal: null,
      difference: 0
    };
  }

  const authoritativeTarget = readCompanyMonthlyTarget_(
    spreadsheet,
    filters
  );
  const branchTargetTotal = branchSummaries.reduce(
    function(total, branch) {
      return total + Number(branch.target || 0);
    },
    0
  );
  const difference = round2_(
    authoritativeTarget - branchTargetTotal
  );

  if (authoritativeTarget <= 0 || difference <= 0.5) {
    return {
      applied: false,
      authoritativeTarget: round2_(authoritativeTarget),
      branchTargetTotal: round2_(branchTargetTotal),
      difference: difference
    };
  }

  branchSummaries.push(
    createTargetReconciliationBranch_(difference)
  );

  return {
    applied: true,
    authoritativeTarget: round2_(authoritativeTarget),
    branchTargetTotal: round2_(branchTargetTotal),
    difference: difference
  };
}

/**
 * Reads the company target from column J, keeping one maximum value per month
 * and summing only months inside the selected filter range.
 */
function readCompanyMonthlyTarget_(spreadsheet, filters) {
  const sheet = spreadsheet.getSheetByName(
    DASHBOARD_CONFIG.SALES_SHEET
  );

  if (!sheet) {
    return 0;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }

  const rowCount = lastRow - 1;
  const periods = sheet.getRange(2, 1, rowCount, 2).getValues();
  const targets = sheet.getRange(2, 10, rowCount, 1).getValues();
  const monthlyTargets = {};
  const startMonthKey = toYearMonthKey_(filters.startDate);
  const endMonthKey = toYearMonthKey_(filters.endDate);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const year = Number(periods[rowIndex][0]);
    const month = Number(periods[rowIndex][1]);
    const target = Number(targets[rowIndex][0]) || 0;

    if (!year || month < 1 || month > 12 || target <= 0) {
      continue;
    }

    const monthKey = year * 100 + month;
    if (
      (startMonthKey && monthKey < startMonthKey) ||
      (endMonthKey && monthKey > endMonthKey)
    ) {
      continue;
    }

    if (
      !monthlyTargets[monthKey] ||
      target > monthlyTargets[monthKey]
    ) {
      monthlyTargets[monthKey] = target;
    }
  }

  return Object.keys(monthlyTargets).reduce(
    function(total, monthKey) {
      return total + monthlyTargets[monthKey];
    },
    0
  );
}

function createTargetReconciliationBranch_(difference) {
  return {
    branchKey: 'TARGET_RECONCILIATION',
    branchName: 'Unallocated monthly target',
    region: 'Target reconciliation',
    sales: 0,
    target: round2_(difference),
    targetAchievement: 0,
    transactions: 0,
    averageTicket: 0,
    customers: 0,
    expenses: 0,
    salesLessDisbursements: 0,
    tdcAllocated: null,
    tdcUsed: null,
    tdcPreviousAllocated: null,
    tdcPreviousUsed: null,
    tdcUtilization: null,
    tdcTrend: {
      status: 'INSUFFICIENT_DATA',
      changePercentagePoints: null,
      previousUtilization: null
    },
    pdcAllocated: null,
    pdcUsed: null,
    pdcPreviousAllocated: null,
    pdcPreviousUsed: null,
    pdcUtilization: null,
    pdcTrend: {
      status: 'INSUFFICIENT_DATA',
      changePercentagePoints: null,
      previousUtilization: null
    },
    capacityPeriod: '',
    previousCapacityPeriod: '',
    tdcCapacityPeriod: '',
    tdcPreviousCapacityPeriod: '',
    pdcCapacityPeriod: '',
    pdcPreviousCapacityPeriod: ''
  };
}

