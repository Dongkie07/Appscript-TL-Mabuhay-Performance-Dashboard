/**
 * TDC/PDC data-quality and freshness reporting.
 */

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
