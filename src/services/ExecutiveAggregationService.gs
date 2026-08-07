/**
 * Executive sales aggregation and date-range indexing.
 */

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
