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
  const resultType = 'EXECUTIVE_PERF_V12_NEW_SLSACH';

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

function executiveBuildReconciliation_(aggregation, officialResult) {
  return {
    reportedServiceSales: round2_(aggregation.includedAmount),
    nonSalesReceipts: round2_(aggregation.nonAmount),
    reprints: round2_(aggregation.reprintAmount),
    otherExcluded: round2_(aggregation.otherExcludedAmount),
    excludedTotal: round2_(
      aggregation.nonAmount +
      aggregation.reprintAmount +
      aggregation.otherExcludedAmount
    ),
    encodedCollections: round2_(aggregation.encodedAmount),
    encodedRows: aggregation.includedRows + aggregation.excludedRows,
    encodedTransactions: round2_(aggregation.encodedTransactions),
    officialActualCollections: round2_(officialResult.selectedActual),
    includedRows: aggregation.includedRows,
    excludedRows: aggregation.excludedRows,
    nonRows: aggregation.nonRows,
    reprintRows: aggregation.reprintRows
  };
}

function executiveCreateAggregation_() {
  return {
    trends: {
      DAY: Object.create(null),
      WEEK: Object.create(null),
      MONTH: Object.create(null),
      YEAR: Object.create(null)
    },
    encodedTrends: {
      DAY: Object.create(null),
      WEEK: Object.create(null),
      MONTH: Object.create(null),
      YEAR: Object.create(null)
    },
    serviceMix: Object.create(null),
    branches: Object.create(null),
    includedAmount: 0,
    encodedAmount: 0,
    encodedTransactions: 0,
    nonAmount: 0,
    reprintAmount: 0,
    otherExcludedAmount: 0,
    includedRows: 0,
    excludedRows: 0,
    nonRows: 0,
    reprintRows: 0
  };
}

function executiveAggregateSales_(
  salesSource,
  filters,
  timezone,
  aggregation,
  sharedTrendBucketCache
) {
  const trendBucketCache =
    sharedTrendBucketCache || Object.create(null);
  const rowBounds = executiveFindSalesDateBounds_(
    salesSource,
    filters.startDate,
    filters.endDate
  );

  for (
    let rowIndex = rowBounds.start;
    rowIndex < rowBounds.end;
    rowIndex += 1
  ) {
    const salesRow = salesSource.rows[rowIndex];

    if (!salesRow.date) {
      continue;
    }

    const identity = executiveGetCollectionIdentity_(
      salesRow,
      salesSource
    );

    if (
      !identity.branchKey ||
      !matchesFilters_(
        salesRow.date,
        identity.region,
        identity.branchKey,
        filters
      )
    ) {
      continue;
    }

    const amount = numberOrZero_(salesRow.amount);
    const transactions = nonNegativeNumber_(salesRow.transactions);
    const classification = executiveClassifyService_(
      salesRow.generalServiceType || salesRow.serviceGroup
    );
    const trendBuckets = executiveGetAllTrendBuckets_(
      salesRow.date,
      timezone,
      trendBucketCache
    );

    // Keep the complete encoded total for Overview compatibility.
    aggregation.encodedAmount += amount;
    aggregation.encodedTransactions += transactions;

    executiveAddTrendBucket_(
      aggregation.encodedTrends.DAY,
      trendBuckets.DAY,
      amount,
      transactions
    );
    executiveAddTrendBucket_(
      aggregation.encodedTrends.WEEK,
      trendBuckets.WEEK,
      amount,
      transactions
    );
    executiveAddTrendBucket_(
      aggregation.encodedTrends.MONTH,
      trendBuckets.MONTH,
      amount,
      transactions
    );
    executiveAddTrendBucket_(
      aggregation.encodedTrends.YEAR,
      trendBuckets.YEAR,
      amount,
      transactions
    );

    if (classification.excluded) {
      aggregation.excludedRows += 1;

      if (classification.code === 'NON') {
        aggregation.nonAmount += amount;
        aggregation.nonRows += 1;
      } else if (classification.code === 'REPRINT') {
        aggregation.reprintAmount += amount;
        aggregation.reprintRows += 1;
      } else {
        aggregation.otherExcludedAmount += amount;
      }

      continue;
    }

    aggregation.includedRows += 1;
    aggregation.includedAmount += amount;

    const branch = executiveGetBranchAggregate_(
      aggregation.branches,
      identity.branchKey,
      identity.branchName,
      identity.region
    );

    branch.sales += amount;
    branch.transactions += transactions;

    addToMap_(
      aggregation.serviceMix,
      salesRow.serviceGroup,
      amount
    );

    executiveAddTrendBucket_(
      aggregation.trends.DAY,
      trendBuckets.DAY,
      amount,
      transactions
    );
    executiveAddTrendBucket_(
      aggregation.trends.WEEK,
      trendBuckets.WEEK,
      amount,
      transactions
    );
    executiveAddTrendBucket_(
      aggregation.trends.MONTH,
      trendBuckets.MONTH,
      amount,
      transactions
    );
    executiveAddTrendBucket_(
      aggregation.trends.YEAR,
      trendBuckets.YEAR,
      amount,
      transactions
    );
  }
}

function executiveGetCollectionIdentity_(salesRow, salesSource) {
  const branchKey =
    salesRow.collectionBranchKey ||
    salesRow.branchKey ||
    '';
  const collectionBranches =
    (salesSource && salesSource.collectionBranches) || {};
  const savedBranch = collectionBranches[branchKey] || {};
  const branchName =
    salesRow.collectionBranchName ||
    savedBranch.branchName ||
    salesRow.branchName ||
    branchKey;
  const region =
    salesRow.collectionRegion ||
    savedBranch.region ||
    salesRow.region ||
    'Unspecified';

  return {
    branchKey: branchKey,
    branchName: branchName,
    region: region
  };
}

/**
 * Finds the slice of date-sorted sales rows intersecting the selected range.
 * Falls back to a full scan when an older source-cache payload is encountered.
 */
function executiveFindSalesDateBounds_(salesSource, startDate, endDate) {
  const rows = salesSource && Array.isArray(salesSource.rows)
    ? salesSource.rows
    : [];
  const datedRowCount = Math.max(
    0,
    Math.min(
      Number(salesSource && salesSource.datedRowCount) || rows.length,
      rows.length
    )
  );

  if (
    !rows.length ||
    !(startDate instanceof Date) ||
    !(endDate instanceof Date) ||
    !(rows[0] && rows[0].date instanceof Date)
  ) {
    return { start: 0, end: rows.length };
  }

  return {
    start: executiveLowerBoundDate_(rows, startDate.getTime(), datedRowCount),
    end: executiveUpperBoundDate_(rows, endDate.getTime(), datedRowCount)
  };
}

function executiveLowerBoundDate_(rows, targetTime, endIndex) {
  let low = 0;
  let high = endIndex;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const rowTime = rows[middle].date.getTime();

    if (rowTime < targetTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function executiveUpperBoundDate_(rows, targetTime, endIndex) {
  let low = 0;
  let high = endIndex;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const rowTime = rows[middle].date.getTime();

    if (rowTime <= targetTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function executiveClassifyService_(serviceValue) {
  const normalized = cleanText_(serviceValue)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  if (
    normalized === 'NON' ||
    normalized === 'NON SALES RECEIPTS' ||
    normalized.indexOf('NON SALES') === 0
  ) {
    return {
      excluded: true,
      code: 'NON'
    };
  }

  if (
    normalized === 'REPRINT' ||
    normalized.indexOf('REPRINT') === 0
  ) {
    return {
      excluded: true,
      code: 'REPRINT'
    };
  }

  return {
    excluded: false,
    code: normalized || 'UNSPECIFIED'
  };
}

function executiveGetBranchAggregate_(
  branchMap,
  branchKey,
  branchName,
  region
) {
  if (!branchMap[branchKey]) {
    branchMap[branchKey] = {
      branchKey: branchKey,
      branchName: branchName || branchKey,
      region: region || 'Unspecified',
      sales: 0,
      transactions: 0
    };
  }

  return branchMap[branchKey];
}

/**
 * Reproduces the current SLSAch% pivot calculations from CATEGORY OF SALES V2.
 * NON and REPRINT rows are excluded exactly as configured in the pivots.
 */
function executiveCalculatePivotAchievement_(salesSource, filters) {
  const byBranch = Object.create(null);
  const byRegion = Object.create(null);
  const identities = Object.create(null);
  const company = executiveCreatePivotAggregate_();
  const rowBounds = executiveFindSalesDateBounds_(
    salesSource,
    filters.startDate,
    filters.endDate
  );

  for (
    let rowIndex = rowBounds.start;
    rowIndex < rowBounds.end;
    rowIndex += 1
  ) {
    const salesRow = salesSource.rows[rowIndex];

    if (!salesRow.date) continue;

    const identity = executiveGetCollectionIdentity_(
      salesRow,
      salesSource
    );

    if (
      !identity.branchKey ||
      !matchesFilters_(
        salesRow.date,
        identity.region,
        identity.branchKey,
        filters
      )
    ) {
      continue;
    }

    const classification = executiveClassifyService_(
      salesRow.generalServiceType || salesRow.serviceGroup
    );

    if (classification.excluded) continue;

    const period =
      (positiveInteger_(salesRow.year) || salesRow.date.getFullYear()) * 100 +
      (positiveInteger_(salesRow.month) || salesRow.date.getMonth() + 1);
    const amount = numberOrZero_(salesRow.amount);
    const transactions = nonNegativeNumber_(salesRow.transactions);

    executiveAddPivotRow_(
      company,
      period,
      salesRow.companyTarget,
      amount,
      transactions,
      salesRow.companyAchievementContribution
    );

    if (!byRegion[identity.region]) {
      byRegion[identity.region] = executiveCreatePivotAggregate_();
    }

    executiveAddPivotRow_(
      byRegion[identity.region],
      period,
      salesRow.regionTarget,
      amount,
      transactions,
      salesRow.regionAchievementContribution
    );

    if (!byBranch[identity.branchKey]) {
      byBranch[identity.branchKey] = executiveCreatePivotAggregate_();
    }

    executiveAddPivotRow_(
      byBranch[identity.branchKey],
      period,
      salesRow.branchTarget,
      amount,
      transactions,
      salesRow.branchAchievementContribution
    );

    identities[identity.branchKey] = {
      branchName: identity.branchName,
      region: identity.region
    };
  }

  executiveFinalizePivotAggregate_(company);
  Object.keys(byRegion).forEach(function finalizeRegion(region) {
    executiveFinalizePivotAggregate_(byRegion[region]);
  });
  Object.keys(byBranch).forEach(function finalizeBranch(branchKey) {
    executiveFinalizePivotAggregate_(byBranch[branchKey]);
  });

  let selected = company;
  let scope = 'COMPANY';

  if (filters.branch !== 'ALL') {
    selected = byBranch[filters.branch] || executiveCreatePivotAggregate_();
    executiveFinalizePivotAggregate_(selected);
    scope = 'BRANCH';
  } else if (filters.region !== 'ALL') {
    selected = byRegion[filters.region] || executiveCreatePivotAggregate_();
    executiveFinalizePivotAggregate_(selected);
    scope = 'REGION';
  }

  const branchKeys = Object.keys(byBranch);

  return {
    byBranch: byBranch,
    byRegion: byRegion,
    identities: identities,
    company: company,
    source: DASHBOARD_CONFIG.SALES_SHEET,
    scope: scope,
    selectedTarget: round2_(selected.target),
    selectedActual: round2_(selected.actual),
    selectedTransactions: round2_(selected.transactions),
    selectedAchievement:
      selected.rowCount > 0
        ? round2_(selected.achievementContribution * 100)
        : null,
    achievementCount: branchKeys.length
  };
}

function executiveCreatePivotAggregate_() {
  return {
    targetByMonth: Object.create(null),
    target: 0,
    actual: 0,
    transactions: 0,
    achievementContribution: 0,
    rowCount: 0
  };
}

function executiveAddPivotRow_(
  aggregate,
  period,
  target,
  amount,
  transactions,
  achievementContribution
) {
  const numericTarget = nonNegativeNumber_(target);
  const periodKey = String(period || '');

  if (periodKey && numericTarget > 0) {
    const savedTarget = numberOrZero_(aggregate.targetByMonth[periodKey]);

    // The pivot repeats the same monthly target on every transaction row.
    // Keep one value per month instead of summing the repeated values.
    aggregate.targetByMonth[periodKey] = Math.max(
      savedTarget,
      numericTarget
    );
  }

  aggregate.actual += numberOrZero_(amount);
  aggregate.transactions += nonNegativeNumber_(transactions);
  aggregate.achievementContribution += numberOrZero_(
    achievementContribution
  );
  aggregate.rowCount += 1;
}

function executiveFinalizePivotAggregate_(aggregate) {
  if (!aggregate || aggregate.finalized === true) return aggregate;

  const periods = Object.keys(aggregate.targetByMonth || {});
  let target = 0;

  for (let index = 0; index < periods.length; index += 1) {
    target += numberOrZero_(aggregate.targetByMonth[periods[index]]);
  }

  aggregate.target = target;
  aggregate.achievement = aggregate.rowCount > 0
    ? aggregate.achievementContribution * 100
    : null;
  aggregate.finalized = true;
  return aggregate;
}

function executiveBuildRegionSummaries_(officialResult) {
  const byRegion = officialResult.byRegion || {};
  const identities = officialResult.identities || {};
  const branchCounts = Object.create(null);

  Object.keys(identities).forEach(function countBranch(branchKey) {
    const region = identities[branchKey].region || 'Unspecified';
    branchCounts[region] = (branchCounts[region] || 0) + 1;
  });

  return Object.keys(byRegion)
    .map(function mapRegion(region) {
      const aggregate = byRegion[region];

      return {
        region: region,
        sales: round2_(aggregate.actual),
        actualCollections: round2_(aggregate.actual),
        target: round2_(aggregate.target),
        targetAchievement: nullableRound2_(aggregate.achievement),
        transactions: round2_(aggregate.transactions),
        branchCount: branchCounts[region] || 0
      };
    })
    .sort(function sortRegions(first, second) {
      return regionSort_(first.region, second.region);
    });
}

function executiveBuildBranchSummaries_(
  salesSource,
  filters,
  aggregation,
  officialResult
) {
  const salesKeys = Object.keys(aggregation.branches || {});
  const officialKeys = Object.keys(officialResult.byBranch || {});
  const allKeysMap = Object.create(null);

  salesKeys.concat(officialKeys).forEach(function saveKey(branchKey) {
    allKeysMap[branchKey] = true;
  });

  const summaries = [];
  const allKeys = Object.keys(allKeysMap);

  for (let index = 0; index < allKeys.length; index += 1) {
    const branchKey = allKeys[index];
    const officialIdentity = officialResult.identities[branchKey] || {};
    const collectionCanonical =
      (salesSource.collectionBranches || {})[branchKey] || {};
    const salesAggregate = aggregation.branches[branchKey] || {};
    const official = officialResult.byBranch[branchKey] || {};
    const branchName =
      officialIdentity.branchName ||
      collectionCanonical.branchName ||
      salesAggregate.branchName ||
      branchKey;
    const region =
      officialIdentity.region ||
      collectionCanonical.region ||
      salesAggregate.region ||
      'Unspecified';

    if (filters.region !== 'ALL' && region !== filters.region) {
      continue;
    }

    if (filters.branch !== 'ALL' && branchKey !== filters.branch) {
      continue;
    }

    const sales = numberOrZero_(official.actual || salesAggregate.sales);
    const target = numberOrZero_(official.target);
    const transactions = nonNegativeNumber_(
      official.transactions || salesAggregate.transactions
    );
    const achievement = executiveNullableNumber_(official.achievement);

    if (
      sales <= 0 &&
      target <= 0 &&
      transactions <= 0 &&
      achievement === null
    ) {
      continue;
    }

    summaries.push({
      branchKey: branchKey,
      branchName: branchName,
      region: region,
      sales: round2_(sales),
      officialActualCollections: round2_(sales),
      target: round2_(target),
      targetAchievement: nullableRound2_(achievement),
      weightedTargetAchievement: nullableRound2_(
        percentageOrNull_(sales, target)
      ),
      reportedTargetProgress: nullableRound2_(
        percentageOrNull_(sales, target)
      ),
      achievementRecordCount: official.rowCount || 0,
      transactions: round2_(transactions),
      averageTicket: round2_(
        divideOrDefault_(sales, transactions, 0)
      )
    });
  }

  summaries.sort(function sortBranchSummaries(firstBranch, secondBranch) {
    if (secondBranch.sales !== firstBranch.sales) {
      return secondBranch.sales - firstBranch.sales;
    }

    return firstBranch.branchName.localeCompare(
      secondBranch.branchName
    );
  });

  return summaries;
}

function executiveBuildKpis_(
  branchSummaries,
  aggregation,
  officialResult
) {
  const encodedSales = round2_(aggregation.encodedAmount);
  const reportedServiceSales = round2_(aggregation.includedAmount);
  const target = round2_(officialResult.selectedTarget);
  const officialActual = round2_(officialResult.selectedActual);
  const officialTransactions = round2_(
    officialResult.selectedTransactions
  );

  return {
    // Complete encoded totals remain available to the Overview.
    sales: encodedSales,
    encodedCollections: encodedSales,
    encodedTransactions: round2_(aggregation.encodedTransactions),

    // Pivot-aligned service sales are used by Monthly Sales and branch detail.
    reportedServiceSales: reportedServiceSales,
    officialActualCollections: officialActual,
    target: target,
    targetAchievement: nullableRound2_(
      officialResult.selectedAchievement
    ),
    weightedTargetAchievement: nullableRound2_(
      percentageOrNull_(officialActual, target)
    ),
    reportedTargetProgress: nullableRound2_(
      percentageOrNull_(reportedServiceSales, target)
    ),
    branchAchievementCount: officialResult.achievementCount,
    transactions: officialTransactions,
    averageTicket: round2_(
      divideOrDefault_(officialActual, officialTransactions, 0)
    ),
    excludedCollections: round2_(
      aggregation.encodedAmount - aggregation.includedAmount
    )
  };
}

function executiveGetAllTrendBuckets_(date, timezone, cache) {
  const cacheKey = String(date.getTime());

  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const buckets = {
    DAY: executiveCreateTrendBucket_(date, 'DAY', timezone),
    WEEK: executiveCreateTrendBucket_(date, 'WEEK', timezone),
    MONTH: executiveCreateTrendBucket_(date, 'MONTH', timezone),
    YEAR: executiveCreateTrendBucket_(date, 'YEAR', timezone)
  };

  cache[cacheKey] = buckets;
  return buckets;
}

function executiveAddTrendBucket_(
  trendMap,
  bucket,
  amount,
  transactions
) {
  if (!trendMap[bucket.key]) {
    trendMap[bucket.key] = {
      key: bucket.key,
      label: bucket.label,
      sales: 0,
      transactions: 0
    };
  }

  trendMap[bucket.key].sales += amount;
  trendMap[bucket.key].transactions += transactions;
}

function executiveAddTrendPoint_(
  trendMap,
  date,
  amount,
  transactions,
  trendMode,
  timezone
) {
  const bucket = executiveCreateTrendBucket_(
    date,
    trendMode,
    timezone
  );

  executiveAddTrendBucket_(
    trendMap,
    bucket,
    amount,
    transactions
  );
}

function executiveCreateTrendBucket_(date, trendMode, timezone) {
  if (trendMode === 'YEAR') {
    return {
      key: Utilities.formatDate(date, timezone, 'yyyy'),
      label: Utilities.formatDate(date, timezone, 'yyyy')
    };
  }

  if (trendMode === 'MONTH') {
    return {
      key: Utilities.formatDate(date, timezone, 'yyyy-MM'),
      label: Utilities.formatDate(date, timezone, 'MMM yyyy')
    };
  }

  if (trendMode === 'WEEK') {
    const weekStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    const dayFromMonday = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - dayFromMonday);

    return {
      key: Utilities.formatDate(weekStart, timezone, 'yyyy-MM-dd'),
      label:
        'Week of ' + Utilities.formatDate(weekStart, timezone, 'MMM d')
    };
  }

  return {
    key: Utilities.formatDate(date, timezone, 'yyyy-MM-dd'),
    label: Utilities.formatDate(date, timezone, 'MMM d')
  };
}

function executiveResolveTrendMode_(requestedMode, startDate, endDate) {
  const normalized = cleanText_(requestedMode).toUpperCase();

  if (
    normalized === 'DAY' ||
    normalized === 'WEEK' ||
    normalized === 'MONTH' ||
    normalized === 'YEAR'
  ) {
    return normalized;
  }

  const days = Math.max(
    1,
    Math.round((endDate - startDate) / 86400000) + 1
  );

  if (days <= 45) {
    return 'DAY';
  }

  if (days <= 180) {
    return 'WEEK';
  }

  if (days <= 1095) {
    return 'MONTH';
  }

  return 'YEAR';
}

function executiveBuildTrendSeries_(trendMap) {
  const keys = Object.keys(trendMap).sort();
  const series = [];

  for (let index = 0; index < keys.length; index += 1) {
    const point = trendMap[keys[index]];

    series.push({
      key: point.key,
      label: point.label,
      sales: round2_(point.sales),
      transactions: round2_(point.transactions)
    });
  }

  return series;
}

function executiveBuildTopBranches_(branchSummaries, limit) {
  return branchSummaries
    .slice(0, limit)
    .map(function mapTopBranch(branch) {
      return {
        label: branch.branchName,
        value: branch.sales,
        target: branch.target
      };
    });
}

function executiveNullableNumber_(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

function applyExecutiveDataToDashboard_(dashboardData, executiveData) {
  dashboardData.meta = dashboardData.meta || {};
  dashboardData.kpis = dashboardData.kpis || {};
  dashboardData.charts = dashboardData.charts || {};
  dashboardData.health = dashboardData.health || {};
  dashboardData.branches = dashboardData.branches || [];

  /*
   * Keep the Overview encoded-collection total, but align target achievement
   * and branch performance with the current SLSAch% pivot calculations.
   */
  dashboardData.kpis.officialActualCollections =
    executiveData.kpis.officialActualCollections;
  dashboardData.kpis.target = executiveData.kpis.target;
  dashboardData.kpis.targetAchievement =
    executiveData.kpis.targetAchievement;
  dashboardData.kpis.weightedTargetAchievement =
    executiveData.kpis.weightedTargetAchievement;
  dashboardData.kpis.reportedTargetProgress =
    executiveData.kpis.reportedTargetProgress;
  dashboardData.kpis.branchAchievementCount =
    executiveData.kpis.branchAchievementCount;
  dashboardData.kpis.encodedCollections =
    executiveData.kpis.encodedCollections;
  dashboardData.kpis.excludedCollections =
    executiveData.kpis.excludedCollections;

  applyPivotBranchesToDashboard_(dashboardData, executiveData.branches || []);

  dashboardData.meta.salesReportingRule =
    'OVERVIEW_ENCODED_MONTHLY_AND_BRANCH_SLSACH';
  dashboardData.meta.targetAchievementMethod =
    'SLSACH_SUM_OF_M_N_O_CONTRIBUTIONS';
  dashboardData.health.salesRowsExcludedFromTrends =
    executiveData.reconciliation.excludedRows;

  dashboardData.executiveSales = {
    reconciliation: executiveData.reconciliation,
    officialAchievement: executiveData.officialAchievement,
    branchAchievementCount:
      executiveData.branchAchievementCount,
    weightedTargetAchievement:
      executiveData.kpis.weightedTargetAchievement,
    reportedTargetProgress:
      executiveData.kpis.reportedTargetProgress,
    regions: executiveData.regions,
    branches: executiveData.branches,
    trends: executiveData.trends,
    encodedTrends: executiveData.encodedTrends,
    cacheStatus: executiveData.cacheStatus,
    cachedAt: executiveData.cachedAt
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
