/**
 * Expense, customer, branch summary, and total aggregation.
 */

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
      expenseRow.typeOfExpense,
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
