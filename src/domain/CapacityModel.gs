/**
 * Reusable slot-capacity aggregation model.
 */

function getBranchAggregate_(
  branchTotals,
  branchKey,
  branchName,
  region
) {
  if (!branchTotals[branchKey]) {
    branchTotals[branchKey] = {
      branchName: branchName || 'Unspecified',
      region: region || 'Unspecified',
      sales: 0,
      target: 0,
      transactions: 0,
      customers: 0,
      expenses: 0,
      tdcAllocated: null,
      tdcUsed: null,
      tdcPreviousAllocated: null,
      tdcPreviousUsed: null,
      pdcAllocated: null,
      pdcUsed: null,
      pdcPreviousAllocated: null,
      pdcPreviousUsed: null,
      capacityPeriod: '',
      previousCapacityPeriod: '',
      tdcCapacityPeriod: '',
      tdcPreviousCapacityPeriod: '',
      pdcCapacityPeriod: '',
      pdcPreviousCapacityPeriod: ''
    };
  }

  return branchTotals[branchKey];
}

function updateCapacitySnapshot_(
  capacitySnapshots,
  salesRow,
  branchName,
  region
) {
  if (!hasCapacityData_(salesRow)) {
    return;
  }

  const hasValidWeek =
    Number.isFinite(Number(salesRow.week)) &&
    Number(salesRow.week) > 0;

  const periodKey = hasValidWeek
    ? `W:${salesRow.year}:${Number(salesRow.week)}`
    : `M:${salesRow.year}:${Number(salesRow.month) || 0}`;

  const periodSortKey = salesRow.date
    ? salesRow.date.getTime()
    : 0;

  let branchHistory =
    capacitySnapshots[salesRow.branchKey];

  if (!branchHistory) {
    branchHistory = {
      latest: null,
      previous: null,
      snapshots: Object.create(null)
    };
    capacitySnapshots[salesRow.branchKey] = branchHistory;
  }

  const snapshotKey = String(periodKey);
  const savedSnapshot =
    branchHistory.snapshots[snapshotKey];
  const incomingSnapshot = createCapacitySnapshot_(
    periodKey,
    periodSortKey,
    salesRow,
    branchName,
    region
  );

  if (savedSnapshot) {
    mergeCapacitySnapshot_(
      savedSnapshot,
      incomingSnapshot
    );
    return;
  }

  branchHistory.snapshots[snapshotKey] =
    incomingSnapshot;

  if (
    !branchHistory.latest ||
    periodSortKey > branchHistory.latest.periodSortKey
  ) {
    branchHistory.previous = branchHistory.latest;
    branchHistory.latest = incomingSnapshot;
    return;
  }

  if (periodSortKey === branchHistory.latest.periodSortKey) {
    mergeCapacitySnapshot_(
      branchHistory.latest,
      incomingSnapshot
    );
    return;
  }

  if (
    !branchHistory.previous ||
    periodSortKey > branchHistory.previous.periodSortKey
  ) {
    branchHistory.previous = incomingSnapshot;
    return;
  }

  if (periodSortKey === branchHistory.previous.periodSortKey) {
    mergeCapacitySnapshot_(
      branchHistory.previous,
      incomingSnapshot
    );
  }
}

function createCapacitySnapshot_(
  periodKey,
  periodSortKey,
  salesRow,
  branchName,
  region
) {
  return {
    periodKey: periodKey,
    periodSortKey: periodSortKey,
    periodLabel: createCapacityPeriodLabel_(salesRow),
    branchName: branchName,
    region: region,
    tdcAllocated: salesRow.tdcAllocated,
    tdcUsed: salesRow.tdcUsed,
    pdcAllocated: salesRow.pdcAllocated,
    pdcUsed: salesRow.pdcUsed
  };
}

function mergeCapacitySnapshot_(
  savedSnapshot,
  incomingSnapshot
) {
  savedSnapshot.tdcAllocated = maxNullable_(
    savedSnapshot.tdcAllocated,
    incomingSnapshot.tdcAllocated
  );
  savedSnapshot.tdcUsed = maxNullable_(
    savedSnapshot.tdcUsed,
    incomingSnapshot.tdcUsed
  );
  savedSnapshot.pdcAllocated = maxNullable_(
    savedSnapshot.pdcAllocated,
    incomingSnapshot.pdcAllocated
  );
  savedSnapshot.pdcUsed = maxNullable_(
    savedSnapshot.pdcUsed,
    incomingSnapshot.pdcUsed
  );
}

function hasCapacityData_(salesRow) {
  return (
    salesRow.tdcAllocated !== null ||
    salesRow.tdcUsed !== null ||
    salesRow.pdcAllocated !== null ||
    salesRow.pdcUsed !== null
  );
}

function createCapacityPeriodLabel_(salesRow) {
  if (salesRow.week) {
    return (
      'Week ' +
      salesRow.week +
      ', ' +
      salesRow.year
    );
  }

  return (
    salesRow.year +
    '-' +
    pad2_(salesRow.month)
  );
}
