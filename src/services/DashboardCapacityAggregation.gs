/**
 * Capacity snapshot aggregation for the overview.
 */

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
