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


function buildSlotUtilizationData_(requestedFilters) {
  const processingStartedAt = Date.now();
  const spreadsheet = getSpreadsheet_();
  const timezone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const sourceResult = getDashboardSourcesCached_(
    spreadsheet,
    false
  );
  const salesSource = sourceResult.sources.sales;

  assertSalesDatesExist_(salesSource);

  const filters = normalizeFilters_(
    requestedFilters || {},
    salesSource.minDate,
    salesSource.maxDate
  );
  const cachedResponse = readDashboardResultCache_(
    spreadsheet,
    sourceResult,
    filters,
    'SLOT_UTILIZATION_ANALYTICS_V3_DATA_QUALITY'
  );

  if (cachedResponse) {
    return prepareCachedDashboardResponse_(
      cachedResponse,
      sourceResult,
      timezone,
      processingStartedAt
    );
  }

  const capacitySnapshots = Object.create(null);
  const weeklyBusiness = Object.create(null);
  let rowsMatched = 0;

  for (
    let rowIndex = 0;
    rowIndex < salesSource.rows.length;
    rowIndex += 1
  ) {
    const salesRow = salesSource.rows[rowIndex];

    if (!salesRow.date || !salesRow.branchKey) {
      continue;
    }

    const branchIdentity = resolveBranchIdentity_(
      salesRow,
      salesSource.canonicalBranches
    );

    if (
      !matchesFilters_(
        salesRow.date,
        branchIdentity.region,
        salesRow.branchKey,
        filters
      )
    ) {
      continue;
    }

    recordWeeklyBranchBusiness_(
      weeklyBusiness,
      salesRow
    );

    if (hasCapacityData_(salesRow)) {
      rowsMatched += 1;
    }

    updateDetailedCapacitySnapshot_(
      capacitySnapshots,
      salesRow,
      branchIdentity.branchName,
      branchIdentity.region
    );
  }

  const response = {
    meta: {
      spreadsheetName: spreadsheet.getName(),
      readOnly: true,
      processingMs: Date.now() - processingStartedAt,
      sourceCacheStatus: sourceResult.cacheStatus,
      sourceCachedAt: Utilities.formatDate(
        sourceResult.cachedAt,
        timezone,
        'yyyy-MM-dd HH:mm:ss'
      ),
      resultCacheStatus: 'MISS'
    },
    filtersApplied: buildAppliedFilters_(filters, timezone),
    capacity: buildCapacityView_(
      capacitySnapshots,
      weeklyBusiness,
      salesSource.canonicalBranches,
      filters
    ),
    health: {
      salesRowsRead: salesSource.rows.length,
      capacityRowsMatched: rowsMatched
    }
  };

  try {
    writeDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      'SLOT_UTILIZATION_ANALYTICS_V3_DATA_QUALITY',
      response
    );
  } catch (cacheError) {
    console.warn(
      'Slot utilization result cache write failed: ' +
      cacheError
    );
  }

  return response;
}


function recordWeeklyBranchBusiness_(
  weeklyBusiness,
  salesRow
) {
  if (!salesRow.year || !salesRow.week) {
    return;
  }

  const branchKey = salesRow.branchKey;
  const periodKey =
    salesRow.year * 100 + salesRow.week;
  let branchWeeks = weeklyBusiness[branchKey];

  if (!branchWeeks) {
    branchWeeks = Object.create(null);
    weeklyBusiness[branchKey] = branchWeeks;
  }

  let weeklyRecord = branchWeeks[periodKey];

  if (!weeklyRecord) {
    weeklyRecord = {
      sales: 0,
      transactions: 0,
      serviceGroups: Object.create(null)
    };
    branchWeeks[periodKey] = weeklyRecord;
  }

  weeklyRecord.sales += Number(salesRow.amount) || 0;
  weeklyRecord.transactions +=
    Number(salesRow.transactions) || 0;

  if (
    salesRow.serviceGroup &&
    salesRow.serviceGroup !== 'Unspecified'
  ) {
    weeklyRecord.serviceGroups[
      salesRow.serviceGroup
    ] = true;
  }
}

function updateDetailedCapacitySnapshot_(
  capacitySnapshots,
  salesRow,
  branchName,
  region
) {
  if (!hasCapacityData_(salesRow)) {
    return;
  }

  const periodKey =
    salesRow.year * 100 + salesRow.week;
  let branchHistory =
    capacitySnapshots[salesRow.branchKey];

  if (!branchHistory) {
    branchHistory = {
      snapshots: Object.create(null)
    };
    capacitySnapshots[salesRow.branchKey] =
      branchHistory;
  }

  const snapshotKey = String(periodKey);
  const incomingSnapshot = createCapacitySnapshot_(
    periodKey,
    salesRow,
    branchName,
    region
  );
  const savedSnapshot =
    branchHistory.snapshots[snapshotKey];

  if (savedSnapshot) {
    mergeCapacitySnapshot_(
      savedSnapshot,
      incomingSnapshot
    );
    return;
  }

  branchHistory.snapshots[snapshotKey] =
    incomingSnapshot;
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

function createAggregationState_(trendBucketMode) {
  return {
    branchTotals: Object.create(null),
    serviceMix: Object.create(null),
    customerMix: Object.create(null),
    expenseMix: Object.create(null),
    salesTrend: Object.create(null),
    monthlyTargets: Object.create(null),
    capacityOverview: Object.create(null),
    trendBucketMode: trendBucketMode,
    salesRowsMatched: 0,
    expenseRowsMatched: 0,
    customerRowsMatched: 0,
    selectedMaxDate: null
  };
}

function aggregateSalesRows_(
  salesSource,
  filters,
  timezone,
  aggregation
) {
  for (
    let rowIndex = 0;
    rowIndex < salesSource.rows.length;
    rowIndex += 1
  ) {
    const salesRow = salesSource.rows[rowIndex];

    if (!salesRow.date || !salesRow.branchKey) {
      continue;
    }

    const branchIdentity = resolveBranchIdentity_(
      salesRow,
      salesSource.canonicalBranches
    );

    if (
      !matchesFilters_(
        salesRow.date,
        branchIdentity.region,
        salesRow.branchKey,
        filters
      )
    ) {
      continue;
    }

    aggregation.salesRowsMatched += 1;
    aggregation.selectedMaxDate = latestDate_(
      aggregation.selectedMaxDate,
      salesRow.date
    );

    addSalesToBranch_(
      aggregation.branchTotals,
      salesRow,
      branchIdentity
    );
    addToMap_(
      aggregation.serviceMix,
      salesRow.serviceGroup,
      salesRow.amount
    );
    addSalesToTrend_(
      aggregation.salesTrend,
      salesRow,
      aggregation.trendBucketMode,
      timezone
    );
    recordMonthlyTarget_(
      aggregation.monthlyTargets,
      salesRow,
      branchIdentity
    );
    updateOverviewCapacity_(
      aggregation.capacityOverview,
      salesRow,
      branchIdentity.branchName,
      branchIdentity.region
    );
  }
}

function resolveBranchIdentity_(row, canonicalBranches) {
  const canonicalBranch = canonicalBranches[row.branchKey];

  if (!canonicalBranch) {
    return {
      branchName: row.branchName,
      region: row.region
    };
  }

  return {
    branchName: canonicalBranch.branchName || row.branchName,
    region: canonicalBranch.region || row.region
  };
}

function addSalesToBranch_(
  branchTotals,
  salesRow,
  branchIdentity
) {
  const branchTotal = getBranchAggregate_(
    branchTotals,
    salesRow.branchKey,
    branchIdentity.branchName,
    branchIdentity.region
  );

  branchTotal.sales += salesRow.amount;
  branchTotal.transactions += salesRow.transactions;
}

function addSalesToTrend_(
  salesTrend,
  salesRow,
  trendBucketMode,
  timezone
) {
  const trendBucket = createTrendBucket_(
    salesRow.date,
    trendBucketMode,
    timezone
  );

  if (!salesTrend[trendBucket.key]) {
    salesTrend[trendBucket.key] = {
      key: trendBucket.key,
      label: trendBucket.label,
      sales: 0,
      transactions: 0
    };
  }

  salesTrend[trendBucket.key].sales += salesRow.amount;
  salesTrend[trendBucket.key].transactions +=
    salesRow.transactions;
}

function recordMonthlyTarget_(
  monthlyTargets,
  salesRow,
  branchIdentity
) {
  if (salesRow.target <= 0) {
    return;
  }

  const targetKey =
    salesRow.branchKey +
    '|' +
    salesRow.year +
    '-' +
    pad2_(salesRow.month);
  const savedTarget = monthlyTargets[targetKey];

  if (savedTarget && savedTarget.target >= salesRow.target) {
    return;
  }

  monthlyTargets[targetKey] = {
    branchKey: salesRow.branchKey,
    branchName: branchIdentity.branchName,
    region: branchIdentity.region,
    target: salesRow.target
  };
}

function applyMonthlyTargets_(aggregation) {
  const targetKeys = Object.keys(aggregation.monthlyTargets);

  for (
    let targetIndex = 0;
    targetIndex < targetKeys.length;
    targetIndex += 1
  ) {
    const target = aggregation.monthlyTargets[
      targetKeys[targetIndex]
    ];
    const branchTotal = getBranchAggregate_(
      aggregation.branchTotals,
      target.branchKey,
      target.branchName,
      target.region
    );

    branchTotal.target += target.target;
  }
}


function updateOverviewCapacity_(
  capacityOverview,
  salesRow,
  branchName,
  region
) {
  const branchKey = salesRow.branchKey;
  let branchCapacity = capacityOverview[branchKey];

  if (!branchCapacity) {
    branchCapacity = {
      branchName: branchName,
      region: region,
      tdc: { latest: null, previous: null },
      pdc: { latest: null, previous: null }
    };
    capacityOverview[branchKey] = branchCapacity;
  }

  updateOverviewCourse_(branchCapacity.tdc, salesRow, 'tdc');
  updateOverviewCourse_(branchCapacity.pdc, salesRow, 'pdc');
}

function updateOverviewCourse_(courseHistory, salesRow, prefix) {
  const allocated = salesRow[prefix + 'Allocated'];
  const used = salesRow[prefix + 'Used'];

  if (allocated === null && used === null) {
    return;
  }

  const incoming = {
    periodKey: salesRow.year * 100 + salesRow.week,
    periodLabel: createCapacityPeriodLabel_(salesRow),
    allocated: allocated,
    used: used
  };

  if (!courseHistory.latest) {
    courseHistory.latest = incoming;
    return;
  }

  if (incoming.periodKey === courseHistory.latest.periodKey) {
    mergeOverviewCourseSnapshot_(courseHistory.latest, incoming);
    return;
  }

  if (incoming.periodKey > courseHistory.latest.periodKey) {
    courseHistory.previous = courseHistory.latest;
    courseHistory.latest = incoming;
    return;
  }

  if (!courseHistory.previous) {
    courseHistory.previous = incoming;
    return;
  }

  if (incoming.periodKey === courseHistory.previous.periodKey) {
    mergeOverviewCourseSnapshot_(courseHistory.previous, incoming);
    return;
  }

  if (incoming.periodKey > courseHistory.previous.periodKey) {
    courseHistory.previous = incoming;
  }
}

function mergeOverviewCourseSnapshot_(saved, incoming) {
  saved.allocated = maxNullable_(saved.allocated, incoming.allocated);
  saved.used = maxNullable_(saved.used, incoming.used);
}

function applyOverviewCapacity_(aggregation) {
  const branchKeys = Object.keys(aggregation.capacityOverview);

  for (let index = 0; index < branchKeys.length; index += 1) {
    const branchKey = branchKeys[index];
    const capacity = aggregation.capacityOverview[branchKey];
    const branchTotal = getBranchAggregate_(
      aggregation.branchTotals,
      branchKey,
      capacity.branchName,
      capacity.region
    );

    applyOverviewCourseToBranch_(branchTotal, capacity.tdc, 'tdc');
    applyOverviewCourseToBranch_(branchTotal, capacity.pdc, 'pdc');

    const tdcKey = capacity.tdc.latest
      ? capacity.tdc.latest.periodKey
      : 0;
    const pdcKey = capacity.pdc.latest
      ? capacity.pdc.latest.periodKey
      : 0;
    const latestCourse = tdcKey >= pdcKey
      ? capacity.tdc
      : capacity.pdc;

    if (latestCourse.latest) {
      branchTotal.capacityPeriod = latestCourse.latest.periodLabel;
      branchTotal.previousCapacityPeriod = latestCourse.previous
        ? latestCourse.previous.periodLabel
        : '';
    }
  }
}

function applyOverviewCourseToBranch_(
  branchTotal,
  courseHistory,
  prefix
) {
  if (!courseHistory.latest) {
    return;
  }

  branchTotal[prefix + 'Allocated'] =
    courseHistory.latest.allocated;
  branchTotal[prefix + 'Used'] = courseHistory.latest.used;
  branchTotal[prefix + 'CapacityPeriod'] =
    courseHistory.latest.periodLabel;

  if (!courseHistory.previous) {
    return;
  }

  branchTotal[prefix + 'PreviousAllocated'] =
    courseHistory.previous.allocated;
  branchTotal[prefix + 'PreviousUsed'] =
    courseHistory.previous.used;
  branchTotal[prefix + 'PreviousCapacityPeriod'] =
    courseHistory.previous.periodLabel;
}

function applyCapacitySnapshots_(aggregation) {
  const branchKeys = Object.keys(
    aggregation.capacitySnapshots
  );

  for (
    let branchIndex = 0;
    branchIndex < branchKeys.length;
    branchIndex += 1
  ) {
    const branchKey = branchKeys[branchIndex];
    const history = aggregation.capacitySnapshots[branchKey];
    const orderedSnapshots =
      getOrderedCapacitySnapshots_(history);

    if (!orderedSnapshots.length) {
      continue;
    }

    const snapshot = orderedSnapshots[0];
    const branchTotal = getBranchAggregate_(
      aggregation.branchTotals,
      branchKey,
      snapshot.branchName,
      snapshot.region
    );

    branchTotal.capacityPeriod = snapshot.periodLabel;
    branchTotal.previousCapacityPeriod =
      orderedSnapshots.length > 1
        ? orderedSnapshots[1].periodLabel
        : '';

    applyCourseCapacityHistory_(
      branchTotal,
      orderedSnapshots,
      'tdc'
    );
    applyCourseCapacityHistory_(
      branchTotal,
      orderedSnapshots,
      'pdc'
    );
  }
}

function getOrderedCapacitySnapshots_(history) {
  if (!history) {
    return [];
  }

  const snapshots = [];

  if (history.snapshots) {
    const snapshotKeys = Object.keys(history.snapshots);

    for (
      let snapshotIndex = 0;
      snapshotIndex < snapshotKeys.length;
      snapshotIndex += 1
    ) {
      snapshots.push(
        history.snapshots[snapshotKeys[snapshotIndex]]
      );
    }
  } else {
    if (history.latest) {
      snapshots.push(history.latest);
    }

    if (history.previous) {
      snapshots.push(history.previous);
    }
  }

  snapshots.sort(function sortNewestFirst(
    firstSnapshot,
    secondSnapshot
  ) {
    return secondSnapshot.periodKey - firstSnapshot.periodKey;
  });

  return snapshots;
}

function getCourseCapacitySnapshots_(
  orderedSnapshots,
  coursePrefix
) {
  const courseSnapshots = [];
  const allocatedProperty =
    coursePrefix + 'Allocated';
  const usedProperty = coursePrefix + 'Used';

  for (
    let snapshotIndex = 0;
    snapshotIndex < orderedSnapshots.length;
    snapshotIndex += 1
  ) {
    const snapshot = orderedSnapshots[snapshotIndex];

    if (
      snapshot[allocatedProperty] !== null ||
      snapshot[usedProperty] !== null
    ) {
      courseSnapshots.push(snapshot);
    }
  }

  return courseSnapshots;
}

function applyCourseCapacityHistory_(
  branchTotal,
  orderedSnapshots,
  coursePrefix
) {
  const courseSnapshots = getCourseCapacitySnapshots_(
    orderedSnapshots,
    coursePrefix
  );

  if (!courseSnapshots.length) {
    return;
  }

  const allocatedProperty =
    coursePrefix + 'Allocated';
  const usedProperty = coursePrefix + 'Used';
  const previousAllocatedProperty =
    coursePrefix + 'PreviousAllocated';
  const previousUsedProperty =
    coursePrefix + 'PreviousUsed';
  const periodProperty =
    coursePrefix + 'CapacityPeriod';
  const previousPeriodProperty =
    coursePrefix + 'PreviousCapacityPeriod';
  const latestSnapshot = courseSnapshots[0];
  const previousSnapshot =
    courseSnapshots.length > 1
      ? courseSnapshots[1]
      : null;

  branchTotal[allocatedProperty] =
    latestSnapshot[allocatedProperty];
  branchTotal[usedProperty] =
    latestSnapshot[usedProperty];
  branchTotal[periodProperty] =
    latestSnapshot.periodLabel;

  if (!previousSnapshot) {
    return;
  }

  branchTotal[previousAllocatedProperty] =
    previousSnapshot[allocatedProperty];
  branchTotal[previousUsedProperty] =
    previousSnapshot[usedProperty];
  branchTotal[previousPeriodProperty] =
    previousSnapshot.periodLabel;
}

function aggregateExpenseRows_(
  expenseSource,
  canonicalBranches,
  filters,
  aggregation
) {
  for (
    let rowIndex = 0;
    rowIndex < expenseSource.rows.length;
    rowIndex += 1
  ) {
    const expenseRow = expenseSource.rows[rowIndex];

    if (!expenseRow.date || !expenseRow.branchKey) {
      continue;
    }

    const branchIdentity = resolveBranchIdentity_(
      expenseRow,
      canonicalBranches
    );

    if (
      !matchesFilters_(
        expenseRow.date,
        branchIdentity.region,
        expenseRow.branchKey,
        filters
      )
    ) {
      continue;
    }

    aggregation.expenseRowsMatched += 1;

    const branchTotal = getBranchAggregate_(
      aggregation.branchTotals,
      expenseRow.branchKey,
      branchIdentity.branchName,
      branchIdentity.region
    );

    branchTotal.expenses += expenseRow.amount;

    addToMap_(
      aggregation.expenseMix,
      expenseRow.expenseType,
      expenseRow.amount
    );
  }
}

function aggregateCustomerRows_(
  customerSource,
  canonicalBranches,
  filters,
  aggregation
) {
  for (
    let rowIndex = 0;
    rowIndex < customerSource.rows.length;
    rowIndex += 1
  ) {
    const customerRow = customerSource.rows[rowIndex];

    if (!customerRow.date || !customerRow.branchKey) {
      continue;
    }

    const branchIdentity = resolveBranchIdentity_(
      customerRow,
      canonicalBranches
    );

    if (
      !matchesFilters_(
        customerRow.date,
        branchIdentity.region,
        customerRow.branchKey,
        filters
      )
    ) {
      continue;
    }

    aggregation.customerRowsMatched += 1;

    const branchTotal = getBranchAggregate_(
      aggregation.branchTotals,
      customerRow.branchKey,
      branchIdentity.branchName,
      branchIdentity.region
    );

    branchTotal.customers += customerRow.customerCount;

    addToMap_(
      aggregation.customerMix,
      customerRow.customerType,
      customerRow.customerCount
    );
  }
}

function buildBranchSummaries_(branchTotals) {
  const branchKeys = Object.keys(branchTotals);
  const branchSummaries = [];

  for (
    let branchIndex = 0;
    branchIndex < branchKeys.length;
    branchIndex += 1
  ) {
    const branchKey = branchKeys[branchIndex];
    const branchTotal = branchTotals[branchKey];

    branchSummaries.push(
      createBranchSummary_(branchKey, branchTotal)
    );
  }

  branchSummaries.sort(compareBranchSales_);

  return branchSummaries;
}

function createBranchSummary_(branchKey, branchTotal) {
  const averageTicket = divideOrDefault_(
    branchTotal.sales,
    branchTotal.transactions,
    0
  );
  const targetAchievement = percentageOrNull_(
    branchTotal.sales,
    branchTotal.target
  );
  const tdcUtilization = percentageOrNull_(
    branchTotal.tdcUsed,
    branchTotal.tdcAllocated
  );
  const pdcUtilization = percentageOrNull_(
    branchTotal.pdcUsed,
    branchTotal.pdcAllocated
  );
  const tdcPreviousUtilization = percentageOrNull_(
    branchTotal.tdcPreviousUsed,
    branchTotal.tdcPreviousAllocated
  );
  const pdcPreviousUtilization = percentageOrNull_(
    branchTotal.pdcPreviousUsed,
    branchTotal.pdcPreviousAllocated
  );

  return {
    branchKey: branchKey,
    branchName: branchTotal.branchName,
    region: branchTotal.region,
    sales: round2_(branchTotal.sales),
    target: round2_(branchTotal.target),
    targetAchievement: nullableRound2_(
      targetAchievement
    ),
    transactions: round2_(branchTotal.transactions),
    averageTicket: round2_(averageTicket),
    customers: round2_(branchTotal.customers),
    expenses: round2_(branchTotal.expenses),
    salesLessDisbursements: round2_(
      branchTotal.sales - branchTotal.expenses
    ),
    tdcAllocated: nullableRound2_(
      branchTotal.tdcAllocated
    ),
    tdcUsed: nullableRound2_(branchTotal.tdcUsed),
    tdcPreviousAllocated: nullableRound2_(
      branchTotal.tdcPreviousAllocated
    ),
    tdcPreviousUsed: nullableRound2_(
      branchTotal.tdcPreviousUsed
    ),
    tdcUtilization: nullableRound2_(tdcUtilization),
    tdcTrend: createUtilizationTrend_(
      tdcUtilization,
      tdcPreviousUtilization
    ),
    pdcAllocated: nullableRound2_(
      branchTotal.pdcAllocated
    ),
    pdcUsed: nullableRound2_(branchTotal.pdcUsed),
    pdcPreviousAllocated: nullableRound2_(
      branchTotal.pdcPreviousAllocated
    ),
    pdcPreviousUsed: nullableRound2_(
      branchTotal.pdcPreviousUsed
    ),
    pdcUtilization: nullableRound2_(pdcUtilization),
    pdcTrend: createUtilizationTrend_(
      pdcUtilization,
      pdcPreviousUtilization
    ),
    capacityPeriod: branchTotal.capacityPeriod || '',
    previousCapacityPeriod:
      branchTotal.previousCapacityPeriod || '',
    tdcCapacityPeriod:
      branchTotal.tdcCapacityPeriod || '',
    tdcPreviousCapacityPeriod:
      branchTotal.tdcPreviousCapacityPeriod || '',
    pdcCapacityPeriod:
      branchTotal.pdcCapacityPeriod || '',
    pdcPreviousCapacityPeriod:
      branchTotal.pdcPreviousCapacityPeriod || ''
  };
}

function createUtilizationTrend_(
  currentUtilization,
  previousUtilization
) {
  if (
    currentUtilization === null ||
    previousUtilization === null
  ) {
    return {
      status: 'INSUFFICIENT_DATA',
      changePercentagePoints: null,
      previousUtilization: nullableRound2_(
        previousUtilization
      )
    };
  }

  const changePercentagePoints =
    currentUtilization - previousUtilization;
  let status = 'STABLE';

  if (changePercentagePoints > 5) {
    status = 'GROWING';
  } else if (changePercentagePoints < -5) {
    status = 'DECLINING';
  }

  return {
    status: status,
    changePercentagePoints: round2_(
      changePercentagePoints
    ),
    previousUtilization: round2_(
      previousUtilization
    )
  };
}

function compareBranchSales_(firstBranch, secondBranch) {
  if (secondBranch.sales !== firstBranch.sales) {
    return secondBranch.sales - firstBranch.sales;
  }

  return firstBranch.branchName.localeCompare(
    secondBranch.branchName
  );
}

function calculateDashboardTotals_(branchSummaries) {
  const totals = createEmptyDashboardTotals_();

  for (
    let branchIndex = 0;
    branchIndex < branchSummaries.length;
    branchIndex += 1
  ) {
    addBranchToDashboardTotals_(
      totals,
      branchSummaries[branchIndex]
    );
  }

  return totals;
}

function createEmptyDashboardTotals_() {
  return {
    sales: 0,
    target: 0,
    transactions: 0,
    customers: 0,
    expenses: 0,
    tdcAllocated: 0,
    tdcUsed: 0,
    tdcTrendCurrentAllocated: 0,
    tdcTrendCurrentUsed: 0,
    tdcTrendPreviousAllocated: 0,
    tdcTrendPreviousUsed: 0,
    pdcAllocated: 0,
    pdcUsed: 0,
    pdcTrendCurrentAllocated: 0,
    pdcTrendCurrentUsed: 0,
    pdcTrendPreviousAllocated: 0,
    pdcTrendPreviousUsed: 0
  };
}

function addBranchToDashboardTotals_(totals, branchSummary) {
  totals.sales += branchSummary.sales;
  totals.target += branchSummary.target;
  totals.transactions += branchSummary.transactions;
  totals.customers += branchSummary.customers;
  totals.expenses += branchSummary.expenses;

  if (branchSummary.tdcAllocated !== null) {
    totals.tdcAllocated += branchSummary.tdcAllocated;
    totals.tdcUsed += branchSummary.tdcUsed || 0;
  }

  if (
    branchSummary.tdcAllocated !== null &&
    branchSummary.tdcPreviousAllocated !== null
  ) {
    totals.tdcTrendCurrentAllocated +=
      branchSummary.tdcAllocated;
    totals.tdcTrendCurrentUsed +=
      branchSummary.tdcUsed || 0;
    totals.tdcTrendPreviousAllocated +=
      branchSummary.tdcPreviousAllocated;
    totals.tdcTrendPreviousUsed +=
      branchSummary.tdcPreviousUsed || 0;
  }

  if (branchSummary.pdcAllocated !== null) {
    totals.pdcAllocated += branchSummary.pdcAllocated;
    totals.pdcUsed += branchSummary.pdcUsed || 0;
  }

  if (
    branchSummary.pdcAllocated !== null &&
    branchSummary.pdcPreviousAllocated !== null
  ) {
    totals.pdcTrendCurrentAllocated +=
      branchSummary.pdcAllocated;
    totals.pdcTrendCurrentUsed +=
      branchSummary.pdcUsed || 0;
    totals.pdcTrendPreviousAllocated +=
      branchSummary.pdcPreviousAllocated;
    totals.pdcTrendPreviousUsed +=
      branchSummary.pdcPreviousUsed || 0;
  }
}

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

function getSelectedOfficialBranchKeys_(
  canonicalBranches,
  filters
) {
  const branchKeys = Object.keys(canonicalBranches || {});
  const selectedRegion = filters && filters.region
    ? filters.region
    : 'ALL';
  const selectedBranch = filters && filters.branch
    ? filters.branch
    : 'ALL';

  return branchKeys.filter(function filterOfficialBranch(branchKey) {
    const branch = canonicalBranches[branchKey] || {};
    const matchesRegion =
      selectedRegion === 'ALL' || branch.region === selectedRegion;
    const matchesBranch =
      selectedBranch === 'ALL' || branchKey === selectedBranch;

    return matchesRegion && matchesBranch;
  });
}

function countSelectedOfficialBranches_(
  canonicalBranches,
  filters
) {
  return getSelectedOfficialBranchKeys_(
    canonicalBranches,
    filters
  ).length;
}

function createEmptyCapacityBranchView_(
  branchKey,
  officialBranch
) {
  const latest = {
    periodKey: null,
    periodLabel: '',
    allocated: null,
    used: null,
    idle: null,
    aboveAllocation: null,
    utilization: null
  };

  return {
    branchKey: branchKey,
    branchName: officialBranch.branchName || branchKey,
    region: officialBranch.region || 'Unspecified',
    latest: latest,
    previous: null,
    trend: createUtilizationTrend_(null, null),
    dataQuality: buildCapacityDataQuality_(latest),
    freshness: createCapacityFreshness_(null, null),
    weeklyHistory: [],
    serviceGroups: [],
    periodAverage: {
      allocated: 0,
      used: 0,
      idle: 0,
      utilization: null,
      reports: 0
    }
  };
}

function buildCapacityDataQuality_(latest) {
  const allocated = latest ? latest.allocated : null;
  const used = latest ? latest.used : null;
  const hasRecord = Boolean(
    latest &&
    (
      latest.periodKey !== null ||
      latest.periodLabel ||
      allocated !== null ||
      used !== null
    )
  );

  if (!hasRecord) {
    return {
      code: 'NO_RECORD',
      label: 'No slot record found',
      action: 'Verify the branch record in the source Sheet'
    };
  }

  if (allocated === null && used !== null) {
    return {
      code: 'MISSING_ALLOCATION',
      label: 'Usage encoded, but allocation is missing',
      action: 'Encode the weekly allocation'
    };
  }

  if (allocated === 0 && used !== null && used > 0) {
    return {
      code: 'ZERO_ALLOCATION_WITH_USAGE',
      label: 'Usage encoded, but allocation is zero',
      action: 'Correct the allocation before using the percentage'
    };
  }

  if (allocated === 0) {
    return {
      code: 'ZERO_ALLOCATION',
      label: 'Weekly allocation is zero',
      action: 'Confirm or encode the weekly allocation'
    };
  }

  if (allocated > 0 && used === null) {
    return {
      code: 'MISSING_USAGE',
      label: 'Allocation encoded, but usage is missing',
      action: 'Encode used slots or confirm a recorded zero'
    };
  }

  if (latest.utilization === null) {
    return {
      code: 'NO_USABLE_PERCENTAGE',
      label: 'No usable utilization percentage',
      action: 'Check the allocation and usage values'
    };
  }

  return {
    code: 'OK',
    label: 'Usable utilization record',
    action: 'No data correction required'
  };
}

function applyCapacityFreshness_(branches) {
  let latestPeriodKey = null;
  let latestPeriodLabel = '';

  for (
    let branchIndex = 0;
    branchIndex < branches.length;
    branchIndex += 1
  ) {
    const latest = branches[branchIndex].latest || {};

    if (
      latest.periodKey !== null &&
      (
        latestPeriodKey === null ||
        latest.periodKey > latestPeriodKey
      )
    ) {
      latestPeriodKey = latest.periodKey;
      latestPeriodLabel = latest.periodLabel || '';
    }
  }

  const summary = {
    latestPeriodKey: latestPeriodKey,
    latestPeriodLabel: latestPeriodLabel,
    currentBranches: 0,
    branchesBehindLatest: 0,
    staleBranches: 0,
    branchesWithoutRecord: 0
  };

  for (
    let branchIndex = 0;
    branchIndex < branches.length;
    branchIndex += 1
  ) {
    const branch = branches[branchIndex];

    branch.freshness = createCapacityFreshness_(
      branch.latest ? branch.latest.periodKey : null,
      latestPeriodKey
    );

    if (branch.freshness.status === 'NO_RECORD') {
      summary.branchesWithoutRecord += 1;
    } else if (branch.freshness.status === 'CURRENT') {
      summary.currentBranches += 1;
    } else {
      summary.branchesBehindLatest += 1;

      if (branch.freshness.status === 'STALE') {
        summary.staleBranches += 1;
      }
    }
  }

  return summary;
}

function createCapacityFreshness_(
  currentPeriodKey,
  latestPeriodKey
) {
  if (
    currentPeriodKey === null ||
    currentPeriodKey === undefined ||
    latestPeriodKey === null ||
    latestPeriodKey === undefined
  ) {
    return {
      status: 'NO_RECORD',
      lagWeeks: null,
      label: 'No record'
    };
  }

  const currentYear = Math.floor(currentPeriodKey / 100);
  const currentWeek = currentPeriodKey % 100;
  const latestYear = Math.floor(latestPeriodKey / 100);
  const latestWeek = latestPeriodKey % 100;
  const lagWeeks = Math.max(
    0,
    (latestYear - currentYear) * 53 +
      (latestWeek - currentWeek)
  );

  if (lagWeeks === 0) {
    return {
      status: 'CURRENT',
      lagWeeks: 0,
      label: 'Current'
    };
  }

  if (lagWeeks === 1) {
    return {
      status: 'BEHIND',
      lagWeeks: 1,
      label: '1 week behind'
    };
  }

  return {
    status: 'STALE',
    lagWeeks: lagWeeks,
    label: 'Stale — ' + lagWeeks + ' weeks behind'
  };
}

function createCapacitySummaryTotals_() {
  return {
    latestAllocated: 0,
    latestUsed: 0,
    currentComparableAllocated: 0,
    currentComparableUsed: 0,
    previousComparableAllocated: 0,
    previousComparableUsed: 0,
    periodAllocated: 0,
    periodUsed: 0,
    periodReports: 0,
    branchesWithData: 0,
    branchesWithUtilization: 0,
    comparableBranches: 0,
    growingBranches: 0,
    stableBranches: 0,
    decliningBranches: 0
  };
}

function buildCapacityBranchView_(
  branchKey,
  courseSnapshots,
  coursePrefix,
  weeklyBusiness
) {
  const latestSnapshot = courseSnapshots[0];
  const previousSnapshot =
    courseSnapshots.length > 1
      ? courseSnapshots[1]
      : null;
  const latest = buildCapacitySnapshotView_(
    latestSnapshot,
    coursePrefix
  );
  const previous = previousSnapshot
    ? buildCapacitySnapshotView_(
        previousSnapshot,
        coursePrefix
      )
    : null;
  const periodTotals = calculateCoursePeriodTotals_(
    courseSnapshots,
    coursePrefix
  );
  const trend = createUtilizationTrend_(
    latest.utilization,
    previous ? previous.utilization : null
  );
  const weeklyHistory = buildCapacityWeeklyHistory_(
    branchKey,
    courseSnapshots,
    coursePrefix,
    weeklyBusiness
  );

  return {
    branchKey: branchKey,
    branchName: latestSnapshot.branchName,
    region: latestSnapshot.region,
    latest: latest,
    previous: previous,
    trend: trend,
    dataQuality: buildCapacityDataQuality_(latest),
    freshness: createCapacityFreshness_(
      latest.periodKey,
      latest.periodKey
    ),
    weeklyHistory: weeklyHistory,
    serviceGroups: collectCapacityServiceGroups_(
      weeklyHistory
    ),
    periodAverage: {
      allocated: round2_(periodTotals.allocated),
      used: round2_(periodTotals.used),
      idle: round2_(
        Math.max(
          periodTotals.allocated - periodTotals.used,
          0
        )
      ),
      utilization: nullableRound2_(
        percentageOrNull_(
          periodTotals.used,
          periodTotals.allocated
        )
      ),
      reports: periodTotals.reports
    }
  };
}


function buildCapacityWeeklyHistory_(
  branchKey,
  courseSnapshots,
  coursePrefix,
  weeklyBusiness
) {
  const orderedOldestFirst =
    courseSnapshots.slice().sort(
      function sortCapacityHistory(
        firstSnapshot,
        secondSnapshot
      ) {
        return (
          firstSnapshot.periodKey -
          secondSnapshot.periodKey
        );
      }
    );
  const branchBusiness =
    weeklyBusiness[branchKey] ||
    Object.create(null);
  const history = [];

  for (
    let snapshotIndex = 0;
    snapshotIndex < orderedOldestFirst.length;
    snapshotIndex += 1
  ) {
    const snapshot =
      orderedOldestFirst[snapshotIndex];
    const snapshotView = buildCapacitySnapshotView_(
      snapshot,
      coursePrefix
    );
    const business =
      branchBusiness[snapshot.periodKey] || null;

    history.push({
      periodKey: snapshotView.periodKey,
      periodLabel: snapshotView.periodLabel,
      allocated: snapshotView.allocated,
      used: snapshotView.used,
      idle: snapshotView.idle,
      aboveAllocation:
        snapshotView.aboveAllocation,
      utilization: snapshotView.utilization,
      sales: round2_(business ? business.sales : 0),
      transactions: round2_(
        business ? business.transactions : 0
      ),
      serviceGroups: business
        ? Object.keys(business.serviceGroups).sort()
        : []
    });
  }

  return history;
}

function collectCapacityServiceGroups_(weeklyHistory) {
  const serviceGroups = Object.create(null);

  for (
    let historyIndex = 0;
    historyIndex < weeklyHistory.length;
    historyIndex += 1
  ) {
    const rowGroups =
      weeklyHistory[historyIndex].serviceGroups || [];

    for (
      let groupIndex = 0;
      groupIndex < rowGroups.length;
      groupIndex += 1
    ) {
      serviceGroups[rowGroups[groupIndex]] = true;
    }
  }

  return Object.keys(serviceGroups).sort();
}

function buildCapacitySnapshotView_(
  snapshot,
  coursePrefix
) {
  const allocated =
    snapshot[coursePrefix + 'Allocated'];
  const used = snapshot[coursePrefix + 'Used'];
  const hasUsablePair =
    allocated !== null &&
    allocated > 0 &&
    used !== null;
  const utilization = hasUsablePair
    ? percentageOrNull_(used, allocated)
    : null;

  return {
    periodKey: snapshot.periodKey,
    periodLabel: snapshot.periodLabel,
    allocated: nullableRound2_(allocated),
    used: nullableRound2_(used),
    idle:
      allocated === null || used === null
        ? null
        : round2_(Math.max(allocated - used, 0)),
    aboveAllocation:
      allocated === null || used === null
        ? null
        : round2_(Math.max(used - allocated, 0)),
    utilization: nullableRound2_(utilization)
  };
}

function calculateCoursePeriodTotals_(
  courseSnapshots,
  coursePrefix
) {
  const totals = {
    allocated: 0,
    used: 0,
    reports: 0
  };
  const allocatedProperty =
    coursePrefix + 'Allocated';
  const usedProperty = coursePrefix + 'Used';

  for (
    let snapshotIndex = 0;
    snapshotIndex < courseSnapshots.length;
    snapshotIndex += 1
  ) {
    const snapshot = courseSnapshots[snapshotIndex];
    const allocated = snapshot[allocatedProperty];
    const used = snapshot[usedProperty];

    if (
      allocated === null ||
      allocated <= 0 ||
      used === null
    ) {
      continue;
    }

    totals.allocated += allocated;
    totals.used += used;
    totals.reports += 1;
  }

  return totals;
}

function addCapacityBranchToSummary_(
  summaryTotals,
  branchView
) {
  const latest = branchView.latest;
  const previous = branchView.previous;
  const periodAverage = branchView.periodAverage;
  const trend = branchView.trend;

  summaryTotals.branchesWithData += 1;
  summaryTotals.periodAllocated +=
    periodAverage.allocated;
  summaryTotals.periodUsed += periodAverage.used;
  summaryTotals.periodReports += periodAverage.reports;

  if (latest.utilization !== null) {
    summaryTotals.branchesWithUtilization += 1;
    summaryTotals.latestAllocated += latest.allocated;
    summaryTotals.latestUsed += latest.used || 0;
  }

  if (
    trend.changePercentagePoints === null ||
    !previous
  ) {
    return;
  }

  summaryTotals.comparableBranches += 1;
  summaryTotals.currentComparableAllocated +=
    latest.allocated;
  summaryTotals.currentComparableUsed +=
    latest.used || 0;
  summaryTotals.previousComparableAllocated +=
    previous.allocated;
  summaryTotals.previousComparableUsed +=
    previous.used || 0;

  if (trend.status === 'GROWING') {
    summaryTotals.growingBranches += 1;
  } else if (trend.status === 'DECLINING') {
    summaryTotals.decliningBranches += 1;
  } else {
    summaryTotals.stableBranches += 1;
  }
}

function finalizeCapacitySummary_(summaryTotals) {
  const latestUtilization = percentageOrNull_(
    summaryTotals.latestUsed,
    summaryTotals.latestAllocated
  );
  const periodUtilization = percentageOrNull_(
    summaryTotals.periodUsed,
    summaryTotals.periodAllocated
  );
  const currentComparableUtilization =
    percentageOrNull_(
      summaryTotals.currentComparableUsed,
      summaryTotals.currentComparableAllocated
    );
  const previousComparableUtilization =
    percentageOrNull_(
      summaryTotals.previousComparableUsed,
      summaryTotals.previousComparableAllocated
    );

  return {
    latest: {
      allocated: round2_(
        summaryTotals.latestAllocated
      ),
      used: round2_(summaryTotals.latestUsed),
      idle: round2_(
        Math.max(
          summaryTotals.latestAllocated -
            summaryTotals.latestUsed,
          0
        )
      ),
      utilization: nullableRound2_(
        latestUtilization
      )
    },
    periodAverage: {
      allocated: round2_(
        summaryTotals.periodAllocated
      ),
      used: round2_(summaryTotals.periodUsed),
      idle: round2_(
        Math.max(
          summaryTotals.periodAllocated -
            summaryTotals.periodUsed,
          0
        )
      ),
      utilization: nullableRound2_(
        periodUtilization
      ),
      reports: summaryTotals.periodReports
    },
    trend: createUtilizationTrend_(
      currentComparableUtilization,
      previousComparableUtilization
    ),
    coverage: {
      branchesWithData:
        summaryTotals.branchesWithData,
      branchesWithUtilization:
        summaryTotals.branchesWithUtilization,
      comparableBranches:
        summaryTotals.comparableBranches
    },
    movementCounts: {
      growing: summaryTotals.growingBranches,
      stable: summaryTotals.stableBranches,
      declining: summaryTotals.decliningBranches
    }
  };
}

function compareCapacityBranches_(
  firstBranch,
  secondBranch
) {
  return firstBranch.branchName.localeCompare(
    secondBranch.branchName
  );
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
