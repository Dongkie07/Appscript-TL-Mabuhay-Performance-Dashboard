/**
 * Executive sales reporting and official monthly-achievement alignment.
 *
 * Reporting rules:
 * 1. The Overview uses all encoded collections, including General Service Type
 *    NON and REPRINT, matching the broad encoded-collection view.
 * 2. The dedicated Sales Trends view excludes NON and REPRINT, matching the
 *    DlySLSTrd operational-sales pivot.
 * 3. Official target achievement is read directly from the existing slsTGT
 *    tab, matching the SLSAch% pivot:
 *      N = Final monthly target
 *      P = Branch actual collections
 *      Q = Branch sales achievement percentage
 * 4. Zero-percent non-operational branch rows are included in the official
 *    average because the supplied pivot includes them.
 * 5. Daily, weekly, monthly and yearly trends are prepared together and
 *    cached, so switching the chart view does not call the server again.
 *
 * This file is read-only. It does not edit any Google Sheet value or formula.
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
  const resultType = 'EXECUTIVE_ALL_TRENDS_PIVOT_V6';

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

  executiveAggregateSales_(
    salesSource,
    filters,
    timezone,
    aggregation
  );

  const officialResult = executiveReadOfficialAchievement_(
    spreadsheet,
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

  return {
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
    kpis: kpis,
    branchAchievementCount: kpis.branchAchievementCount,
    officialAchievement: {
      sourceSheet: officialResult.source,
      target: round2_(officialResult.selectedTarget),
      actualCollections: round2_(officialResult.selectedActual),
      averageBranchAchievement: nullableRound2_(
        officialResult.averageAchievement
      ),
      branchRecordCount: officialResult.achievementCount
    },
    reconciliation: {
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
      officialActualCollections: round2_(
        officialResult.selectedActual
      ),
      includedRows: aggregation.includedRows,
      excludedRows: aggregation.excludedRows,
      nonRows: aggregation.nonRows,
      reprintRows: aggregation.reprintRows
    },
    cacheStatus: sourceResult.cacheStatus || 'MISS',
    cachedAt:
      sourceResult.cachedAt instanceof Date
        ? sourceResult.cachedAt.toISOString()
        : String(sourceResult.cachedAt || '')
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

    const identity = resolveBranchIdentity_(
      salesRow,
      salesSource.canonicalBranches
    );

    if (
      !matchesFilters_(
        salesRow.date,
        identity.region,
        salesRow.branchKey,
        filters
      )
    ) {
      continue;
    }

    const amount = numberOrZero_(salesRow.amount);
    const transactions = nonNegativeNumber_(salesRow.transactions);
    const classification = executiveClassifyService_(
      salesRow.serviceGroup
    );

    aggregation.encodedAmount += amount;
    aggregation.encodedTransactions += transactions;

    ['DAY', 'WEEK', 'MONTH', 'YEAR'].forEach(
      function addEveryEncodedTrendMode(mode) {
        executiveAddTrendPoint_(
          aggregation.encodedTrends[mode],
          salesRow.date,
          amount,
          transactions,
          mode,
          timezone
        );
      }
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
      salesRow.branchKey,
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

    ['DAY', 'WEEK', 'MONTH', 'YEAR'].forEach(
      function addEveryTrendMode(mode) {
        executiveAddTrendPoint_(
          aggregation.trends[mode],
          salesRow.date,
          amount,
          transactions,
          mode,
          timezone
        );
      }
    );
  }
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
 * Reads the same source used by the SLSAch% pivot.
 *
 * The official pivot uses:
 *   N = target (sum)
 *   P = actual collections (sum)
 *   Q = branch achievement (average)
 *
 * Unlike the previous implementation, target=0 / achievement=0 rows are not
 * dropped. The pivot includes those numeric zero percentages in its average.
 */
function executiveReadOfficialAchievement_(
  spreadsheet,
  salesSource,
  filters
) {
  const targetSheet = executiveFindTargetSheet_(spreadsheet);

  if (!targetSheet || targetSheet.getLastRow() < 2) {
    return {
      byBranch: Object.create(null),
      identities: Object.create(null),
      source: 'CATEGORY OF SALES V2',
      selectedTarget: 0,
      selectedActual: 0,
      achievementSum: 0,
      achievementCount: 0,
      averageAchievement: null
    };
  }

  const values = targetSheet
    .getRange(2, 1, targetSheet.getLastRow() - 1, 17)
    .getValues();
  const byBranch = Object.create(null);
  const identities = Object.create(null);
  let selectedTarget = 0;
  let selectedActual = 0;
  let achievementSum = 0;
  let achievementCount = 0;

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const sourceRow = values[rowIndex];
    const year = positiveInteger_(sourceRow[0]);
    const month = positiveInteger_(sourceRow[1]);
    const rawRegion = normalizeRegion_(sourceRow[3]);
    const branchName = cleanText_(sourceRow[5]);
    const branchKey = normalizeKey_(branchName);

    if (
      !year ||
      !month ||
      !branchKey ||
      !executiveMonthIsSelected_(year, month, filters)
    ) {
      continue;
    }

    const canonical = salesSource.canonicalBranches[branchKey];
    const region = rawRegion ||
      (canonical && canonical.region
        ? canonical.region
        : 'Unspecified');

    if (
      filters.region !== 'ALL' &&
      region !== filters.region
    ) {
      continue;
    }

    if (
      filters.branch !== 'ALL' &&
      branchKey !== filters.branch
    ) {
      continue;
    }

    const target = nonNegativeNumber_(sourceRow[13]);
    const actual = nonNegativeNumber_(sourceRow[15]);
    const achievement = executiveNullableNumber_(sourceRow[16]);

    if (!byBranch[branchKey]) {
      byBranch[branchKey] = {
        target: 0,
        actual: 0,
        achievementSum: 0,
        achievementCount: 0,
        recordCount: 0
      };
    }

    const branch = byBranch[branchKey];
    branch.target += target;
    branch.actual += actual;
    branch.recordCount += 1;

    if (achievement !== null) {
      branch.achievementSum += achievement;
      branch.achievementCount += 1;
      achievementSum += achievement;
      achievementCount += 1;
    }

    selectedTarget += target;
    selectedActual += actual;
    identities[branchKey] = {
      branchName:
        canonical && canonical.branchName
          ? canonical.branchName
          : branchName,
      region: region
    };
  }

  return {
    byBranch: byBranch,
    identities: identities,
    source: targetSheet.getName(),
    selectedTarget: round2_(selectedTarget),
    selectedActual: round2_(selectedActual),
    achievementSum: achievementSum,
    achievementCount: achievementCount,
    averageAchievement:
      achievementCount > 0
        ? (achievementSum / achievementCount) * 100
        : null
  };
}

function executiveFindTargetSheet_(spreadsheet) {
  const preferredNames = [
    DASHBOARD_CONFIG.TARGET_SHEET,
    'slsTGT',
    ' slsTGT'
  ].filter(Boolean);

  for (let index = 0; index < preferredNames.length; index += 1) {
    const exactSheet = spreadsheet.getSheetByName(preferredNames[index]);

    if (exactSheet) {
      return exactSheet;
    }
  }

  const desiredName = 'slstgt';
  const sheets = spreadsheet.getSheets();

  for (let index = 0; index < sheets.length; index += 1) {
    const normalizedName = sheets[index]
      .getName()
      .replace(/\s+/g, '')
      .toLowerCase();

    if (normalizedName === desiredName) {
      return sheets[index];
    }
  }

  return null;
}

function executiveMonthIsSelected_(year, month, filters) {
  const targetPeriod = Number(year) * 100 + Number(month);
  const startPeriod =
    filters.startDate.getFullYear() * 100 +
    filters.startDate.getMonth() + 1;
  const endPeriod =
    filters.endDate.getFullYear() * 100 +
    filters.endDate.getMonth() + 1;

  return (
    targetPeriod >= startPeriod &&
    targetPeriod <= endPeriod
  );
}

function executiveBuildBranchSummaries_(
  salesSource,
  filters,
  aggregation,
  officialResult
) {
  const existingKeys = Object.keys(
    salesSource.canonicalBranches || {}
  );
  const salesKeys = Object.keys(aggregation.branches);
  const officialKeys = Object.keys(officialResult.byBranch);
  const allKeysMap = Object.create(null);

  existingKeys.concat(salesKeys, officialKeys).forEach(
    function saveKey(branchKey) {
      allKeysMap[branchKey] = true;
    }
  );

  const summaries = [];
  const allKeys = Object.keys(allKeysMap);

  for (let index = 0; index < allKeys.length; index += 1) {
    const branchKey = allKeys[index];
    const canonical = salesSource.canonicalBranches[branchKey] || {};
    const officialIdentity = officialResult.identities[branchKey] || {};
    const salesAggregate = aggregation.branches[branchKey] || {};
    const official = officialResult.byBranch[branchKey] || {};
    const branchName =
      canonical.branchName ||
      officialIdentity.branchName ||
      salesAggregate.branchName ||
      branchKey;
    const region =
      officialIdentity.region ||
      canonical.region ||
      salesAggregate.region ||
      'Unspecified';

    if (
      filters.region !== 'ALL' &&
      region !== filters.region
    ) {
      continue;
    }

    if (
      filters.branch !== 'ALL' &&
      branchKey !== filters.branch
    ) {
      continue;
    }

    const sales = numberOrZero_(salesAggregate.sales);
    const target = numberOrZero_(official.target);
    const officialActual = numberOrZero_(official.actual);
    const transactions = nonNegativeNumber_(salesAggregate.transactions);
    const achievementCount = nonNegativeNumber_(
      official.achievementCount
    );
    const officialAverage = achievementCount > 0
      ? (numberOrZero_(official.achievementSum) / achievementCount) * 100
      : null;

    if (
      sales <= 0 &&
      target <= 0 &&
      officialActual <= 0 &&
      transactions <= 0 &&
      !achievementCount
    ) {
      continue;
    }

    summaries.push({
      branchKey: branchKey,
      branchName: branchName,
      region: region,
      sales: round2_(sales),
      officialActualCollections: round2_(officialActual),
      target: round2_(target),
      targetAchievement: nullableRound2_(officialAverage),
      weightedTargetAchievement: nullableRound2_(
        percentageOrNull_(officialActual, target)
      ),
      reportedTargetProgress: nullableRound2_(
        percentageOrNull_(sales, target)
      ),
      achievementRecordCount: achievementCount,
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
  let totalTransactions = 0;

  for (
    let branchIndex = 0;
    branchIndex < branchSummaries.length;
    branchIndex += 1
  ) {
    totalTransactions += branchSummaries[branchIndex].transactions;
  }

  const reportedSales = round2_(aggregation.includedAmount);
  const target = round2_(officialResult.selectedTarget);
  const officialActual = round2_(officialResult.selectedActual);

  return {
    sales: reportedSales,
    officialActualCollections: officialActual,
    target: target,
    targetAchievement: nullableRound2_(
      officialResult.averageAchievement
    ),
    weightedTargetAchievement: nullableRound2_(
      percentageOrNull_(officialActual, target)
    ),
    reportedTargetProgress: nullableRound2_(
      percentageOrNull_(reportedSales, target)
    ),
    branchAchievementCount: officialResult.achievementCount,
    transactions: round2_(totalTransactions),
    averageTicket: round2_(
      divideOrDefault_(reportedSales, totalTransactions, 0)
    ),
    encodedCollections: round2_(aggregation.encodedAmount),
    encodedTransactions: round2_(aggregation.encodedTransactions),
    excludedCollections: round2_(
      aggregation.encodedAmount - aggregation.includedAmount
    )
  };
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

  /*
   * Keep the normal Overview values and charts produced by buildDashboardData_.
   * Those values include every encoded collection entry, including NON and
   * REPRINT. Only the official target/achievement fields are replaced here.
   *
   * The dedicated Sales Trends tab uses executiveData.trends, which excludes
   * NON and REPRINT to match the DlySLSTrd pivot.
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

  dashboardData.meta.salesReportingRule =
    'OVERVIEW_ALL_ENCODED_TRENDS_EXCLUDE_NON_AND_REPRINT';
  dashboardData.meta.targetAchievementMethod =
    'DIRECT_SLSACH_AVERAGE_INCLUDING_ZERO_ROWS';
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
    trends: executiveData.trends,
    encodedTrends: executiveData.encodedTrends,
    cacheStatus: executiveData.cacheStatus,
    cachedAt: executiveData.cachedAt
  };
}

