/**
 * Legacy/base monthly target aggregation used before pivot overrides.
 */

/**
 * Pre-populates all official branches into branchTotals so location targets
 * are included even if they have 0 sales transactions in the selected period.
 */
function initializeCanonicalBranches_(branchTotals, canonicalBranches) {
  const branchKeys = Object.keys(canonicalBranches || {});

  for (let index = 0; index < branchKeys.length; index += 1) {
    const branchKey = branchKeys[index];
    const branch = canonicalBranches[branchKey] || {};

    const branchTotal = getBranchAggregate_(
      branchTotals,
      branchKey,
      branch.branchName || branchKey,
      branch.region || 'Unspecified'
    );

    if (branch.monthlyTarget || branch.target) {
      branchTotal.target = Number(branch.monthlyTarget || branch.target) || 0;
    }
  }
}

/**
 * Scans salesSource for monthly targets matching the selected filter period,
 * ensuring targets from other months (like July) are not added to June.
 */
function aggregateMonthlyTargets_(salesSource, filters, aggregation) {
  const selectedRegion = filters && filters.region ? filters.region : 'ALL';
  const selectedBranch = filters && filters.branch ? filters.branch : 'ALL';

  for (let rowIndex = 0; rowIndex < salesSource.rows.length; rowIndex += 1) {
    const row = salesSource.rows[rowIndex];

    if (
      !row.branchKey ||
      Number(row.target || 0) <= 0 ||
      !row.year ||
      !row.month ||
      !isMonthInFilter_(row.year, row.month, filters)
    ) {
      continue;
    }

    const branchIdentity = resolveBranchIdentity_(
      row,
      salesSource.canonicalBranches
    );

    if (
      selectedRegion !== 'ALL' &&
      branchIdentity.region !== selectedRegion
    ) {
      continue;
    }

    if (
      selectedBranch !== 'ALL' &&
      row.branchKey !== selectedBranch
    ) {
      continue;
    }

    recordMonthlyTarget_(
      aggregation.monthlyTargets,
      row,
      branchIdentity
    );
  }
}

/**
 * Returns true when a target month intersects the selected reporting range.
 */
function isMonthInFilter_(year, month, filters) {
  if (!filters || !filters.startDate || !filters.endDate) {
    return true;
  }

  const targetPeriod = Number(year) * 100 + Number(month);
  const startPeriod = getYearMonthValue_(filters.startDate);
  const endPeriod = getYearMonthValue_(filters.endDate);

  if (!targetPeriod || !startPeriod || !endPeriod) {
    return false;
  }

  return targetPeriod >= startPeriod && targetPeriod <= endPeriod;
}

function getYearMonthValue_(dateInput) {
  if (!dateInput) return null;

  if (
    dateInput instanceof Date ||
    typeof dateInput.getMonth === 'function'
  ) {
    return (
      dateInput.getFullYear() * 100 +
      dateInput.getMonth() + 1
    );
  }

  const parts = String(dateInput).trim().split(/[-/]/);

  if (parts.length >= 2) {
    const year = Number(parts[0]);
    const month = Number(parts[1]);

    if (year && month >= 1 && month <= 12) {
      return year * 100 + month;
    }
  }

  const parsedDate = new Date(dateInput);

  if (!isNaN(parsedDate.getTime())) {
    return (
      parsedDate.getFullYear() * 100 +
      parsedDate.getMonth() + 1
    );
  }

  return null;
}

function recordMonthlyTarget_(
  monthlyTargets,
  salesRow,
  branchIdentity
) {
  if (salesRow.target <= 0) {
    return;
  }

  const targetKey =
    salesRow.branchKey +
    '|' +
    salesRow.year +
    '-' +
    pad2_(salesRow.month);
  const savedTarget = monthlyTargets[targetKey];
  if (savedTarget && savedTarget.target >= salesRow.target) {
    return;
  }

  monthlyTargets[targetKey] = {
    branchKey: salesRow.branchKey,
    branchName: branchIdentity.branchName,
    region: branchIdentity.region,
    target: salesRow.target
  };
}

function applyMonthlyTargets_(aggregation) {
  const targetKeys = Object.keys(aggregation.monthlyTargets);

  for (
    let targetIndex = 0;
    targetIndex < targetKeys.length;
    targetIndex += 1
  ) {
    const target = aggregation.monthlyTargets[
      targetKeys[targetIndex]
    ];
    const branchTotal = getBranchAggregate_(
      aggregation.branchTotals,
      target.branchKey,
      target.branchName,
      target.region
    );
    branchTotal.target += target.target;
  }
}
