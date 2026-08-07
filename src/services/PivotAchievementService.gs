/**
 * Reproduces the redesigned SLSAch% company/region/branch calculations.
 */

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
        ? nullableRound2_(selected.achievement)
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
  aggregate.achievement = percentageOrNull_(
    aggregate.actual,
    aggregate.target
  );
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
