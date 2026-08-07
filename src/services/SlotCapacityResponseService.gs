/**
 * TDC/PDC branch, trend, and summary response builders.
 */

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
