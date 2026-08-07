/**
 * Sales aggregation for the base dashboard.
 */

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
