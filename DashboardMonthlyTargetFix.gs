/**
 * Code-only monthly target correction.
 *
 * The employee encoding sheets are not changed. The dashboard continues to
 * use CATEGORY OF SALES V2 for actual sales, transactions and branch identity,
 * but monthly targets are read directly from the existing " slsTGT" tab:
 *
 *   A = Year
 *   B = Month
 *   D = Region
 *   F = Branch Name
 *   N = Final Monthly Target (Gross Collection)
 *
 * One target is kept per branch/month. If duplicate target rows exist, the
 * largest target for that branch/month is used rather than double-counting it.
 */
function buildDashboardDataWithMonthlyTargetFix_(requestedFilters) {
  const response = buildDashboardData_(requestedFilters || {});

  applyDirectMonthlyTargetsToResponse_(response);

  return response;
}

/**
 * Replaces every target value in the dashboard response with the matching
 * value from the direct target source.
 */
function applyDirectMonthlyTargetsToResponse_(response) {
  if (!response || !response.filtersApplied) {
    throw new Error(
      'The dashboard response did not contain normalized filters.'
    );
  }

  const spreadsheet = getSpreadsheet_();
  const targetResult = readDirectMonthlyTargets_(
    spreadsheet,
    response.filtersApplied
  );
  const branches = Array.isArray(response.branches)
    ? response.branches
    : [];
  const existingBranches = Object.create(null);

  for (
    let branchIndex = 0;
    branchIndex < branches.length;
    branchIndex += 1
  ) {
    const branch = branches[branchIndex];
    const branchKey = directTargetNormalizeKey_(
      branch.branchKey || branch.branchName
    );
    const targetRecord = targetResult.selectedBranches[branchKey];
    const target = targetRecord
      ? targetRecord.target
      : 0;

    branch.branchKey = branchKey;
    branch.target = directTargetRound2_(target);
    branch.targetAchievement = directTargetPercentage_(
      branch.sales,
      branch.target
    );
    existingBranches[branchKey] = true;
  }

  // Include branches that have an official target but have no matching sales
  // row yet. They appear with zero actual sales instead of disappearing from
  // the company or regional monthly total.
  const targetBranchKeys = Object.keys(
    targetResult.selectedBranches
  );

  for (
    let targetIndex = 0;
    targetIndex < targetBranchKeys.length;
    targetIndex += 1
  ) {
    const branchKey = targetBranchKeys[targetIndex];
    const targetRecord =
      targetResult.selectedBranches[branchKey];

    if (
      existingBranches[branchKey] ||
      targetRecord.target <= 0
    ) {
      continue;
    }

    branches.push(
      createDirectTargetOnlyBranch_(targetRecord)
    );
  }

  branches.sort(compareDirectTargetBranches_);
  response.branches = branches;

  response.kpis = response.kpis || {};
  response.kpis.target = directTargetRound2_(
    targetResult.selectedTarget
  );
  response.kpis.targetAchievement =
    directTargetPercentage_(
      response.kpis.sales,
      response.kpis.target
    );

  updateDirectTargetTopBranchChart_(response);
  addDirectTargetOptions_(response, targetResult.periodBranches);

  response.health = response.health || {};
  response.health.branchesMatched = branches.length;
  response.health.monthlyTargetSource = {
    sheet: targetResult.sheetName,
    range: 'A:N',
    yearColumn: 'A',
    monthColumn: 'B',
    regionColumn: 'D',
    branchColumn: 'F',
    targetColumn: 'N',
    rowsRead: targetResult.rowsRead,
    uniqueBranchMonthsMatched:
      targetResult.uniqueBranchMonthsMatched,
    selectedTarget: directTargetRound2_(
      targetResult.selectedTarget
    ),
    periodStartMonth: targetResult.startMonthKey,
    periodEndMonth: targetResult.endMonthKey
  };
}

/**
 * Reads target rows once and prepares:
 *
 * periodBranches   = all target branches inside the selected month range,
 *                    used to keep branch/region options complete.
 * selectedBranches = the same rows after applying region and branch filters.
 */
function readDirectMonthlyTargets_(spreadsheet, filtersApplied) {
  const targetSheet = getDirectMonthlyTargetSheet_(spreadsheet);
  const lastRow = targetSheet.getLastRow();
  const startMonthKey = directTargetYearMonthKey_(
    filtersApplied.startDate
  );
  const endMonthKey = directTargetYearMonthKey_(
    filtersApplied.endDate
  );
  const selectedRegion = directTargetCleanText_(
    filtersApplied.region
  ) || 'ALL';
  const selectedBranch = directTargetNormalizeKey_(
    filtersApplied.branch
  ) || 'ALL';

  if (lastRow < 3) {
    return {
      sheetName: targetSheet.getName(),
      rowsRead: 0,
      uniqueBranchMonthsMatched: 0,
      startMonthKey: startMonthKey,
      endMonthKey: endMonthKey,
      selectedTarget: 0,
      periodBranches: Object.create(null),
      selectedBranches: Object.create(null)
    };
  }

  const values = targetSheet
    .getRange(3, 1, lastRow - 2, 14)
    .getValues();
  const uniqueBranchMonths = Object.create(null);

  for (
    let rowIndex = 0;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row = values[rowIndex];
    const year = Math.floor(directTargetNumber_(row[0]));
    const month = Math.floor(directTargetNumber_(row[1]));
    const branchName = directTargetCleanText_(row[5]);
    const branchKey = directTargetNormalizeKey_(branchName);
    const region = directTargetNormalizeRegion_(row[3]);
    const target = Math.max(
      0,
      directTargetNumber_(row[13])
    );

    if (
      !year ||
      month < 1 ||
      month > 12 ||
      !branchKey
    ) {
      continue;
    }

    const monthKey = year * 100 + month;

    if (
      (startMonthKey && monthKey < startMonthKey) ||
      (endMonthKey && monthKey > endMonthKey)
    ) {
      continue;
    }

    const recordKey = monthKey + '|' + branchKey;
    const savedRecord = uniqueBranchMonths[recordKey];

    if (!savedRecord || target > savedRecord.target) {
      uniqueBranchMonths[recordKey] = {
        monthKey: monthKey,
        branchKey: branchKey,
        branchName: branchName,
        region: region,
        target: target
      };
    }
  }

  const periodBranches = Object.create(null);
  const selectedBranches = Object.create(null);
  const uniqueKeys = Object.keys(uniqueBranchMonths);
  let selectedTarget = 0;
  let uniqueBranchMonthsMatched = 0;

  for (
    let uniqueIndex = 0;
    uniqueIndex < uniqueKeys.length;
    uniqueIndex += 1
  ) {
    const record = uniqueBranchMonths[uniqueKeys[uniqueIndex]];

    addDirectTargetRecord_(periodBranches, record);

    const matchesRegion =
      selectedRegion === 'ALL' ||
      record.region === selectedRegion;
    const matchesBranch =
      selectedBranch === 'ALL' ||
      record.branchKey === selectedBranch;

    if (!matchesRegion || !matchesBranch) {
      continue;
    }

    addDirectTargetRecord_(selectedBranches, record);
    selectedTarget += record.target;
    uniqueBranchMonthsMatched += 1;
  }

  return {
    sheetName: targetSheet.getName(),
    rowsRead: values.length,
    uniqueBranchMonthsMatched: uniqueBranchMonthsMatched,
    startMonthKey: startMonthKey,
    endMonthKey: endMonthKey,
    selectedTarget: directTargetRound2_(selectedTarget),
    periodBranches: periodBranches,
    selectedBranches: selectedBranches
  };
}

function getDirectMonthlyTargetSheet_(spreadsheet) {
  const exactName = ' slsTGT';
  const fallbackName = 'slsTGT';
  const sheet =
    spreadsheet.getSheetByName(exactName) ||
    spreadsheet.getSheetByName(fallbackName);

  if (sheet) {
    return sheet;
  }

  throw new Error(
    'Monthly target tab not found. Expected a Sheet named " slsTGT".'
  );
}

function addDirectTargetRecord_(branchMap, record) {
  let branch = branchMap[record.branchKey];

  if (!branch) {
    branch = {
      branchKey: record.branchKey,
      branchName: record.branchName,
      region: record.region,
      target: 0,
      monthKeys: []
    };
    branchMap[record.branchKey] = branch;
  }

  branch.target += record.target;
  branch.monthKeys.push(record.monthKey);
}

/**
 * Adds target-only branches to filter options without duplicating branches
 * that are already supplied by CATEGORY OF SALES V2.
 */
function addDirectTargetOptions_(response, periodBranches) {
  response.options = response.options || {
    regions: [],
    branches: []
  };
  response.options.regions = Array.isArray(
    response.options.regions
  )
    ? response.options.regions
    : [];
  response.options.branches = Array.isArray(
    response.options.branches
  )
    ? response.options.branches
    : [];

  const savedRegions = Object.create(null);
  const savedBranches = Object.create(null);

  for (
    let regionIndex = 0;
    regionIndex < response.options.regions.length;
    regionIndex += 1
  ) {
    savedRegions[
      response.options.regions[regionIndex]
    ] = true;
  }

  for (
    let branchIndex = 0;
    branchIndex < response.options.branches.length;
    branchIndex += 1
  ) {
    const option = response.options.branches[branchIndex];
    savedBranches[
      directTargetNormalizeKey_(
        option.branchKey || option.branchName
      )
    ] = true;
  }

  const targetBranchKeys = Object.keys(periodBranches);

  for (
    let targetIndex = 0;
    targetIndex < targetBranchKeys.length;
    targetIndex += 1
  ) {
    const targetBranch =
      periodBranches[targetBranchKeys[targetIndex]];

    if (!savedRegions[targetBranch.region]) {
      response.options.regions.push(targetBranch.region);
      savedRegions[targetBranch.region] = true;
    }

    if (
      targetBranch.target > 0 &&
      !savedBranches[targetBranch.branchKey]
    ) {
      response.options.branches.push({
        branchKey: targetBranch.branchKey,
        branchName: targetBranch.branchName,
        region: targetBranch.region
      });
      savedBranches[targetBranch.branchKey] = true;
    }
  }

  response.options.regions.sort(compareDirectTargetRegions_);
  response.options.branches.sort(
    function sortDirectTargetOptions(first, second) {
      return String(first.branchName || '').localeCompare(
        String(second.branchName || '')
      );
    }
  );
}

function updateDirectTargetTopBranchChart_(response) {
  response.charts = response.charts || {};
  const branches = Array.isArray(response.branches)
    ? response.branches.slice(0, 10)
    : [];

  response.charts.topBranches = branches.map(
    function mapDirectTargetTopBranch(branch) {
      return {
        label: branch.branchName,
        value: directTargetRound2_(branch.sales),
        target: directTargetRound2_(branch.target)
      };
    }
  );
}

function createDirectTargetOnlyBranch_(targetRecord) {
  return {
    branchKey: targetRecord.branchKey,
    branchName: targetRecord.branchName,
    region: targetRecord.region,
    sales: 0,
    target: directTargetRound2_(targetRecord.target),
    targetAchievement: 0,
    transactions: 0,
    averageTicket: 0,
    customers: 0,
    expenses: 0,
    salesLessDisbursements: 0,
    tdcAllocated: null,
    tdcUsed: null,
    tdcPreviousAllocated: null,
    tdcPreviousUsed: null,
    tdcUtilization: null,
    tdcTrend: createDirectTargetEmptyTrend_(),
    pdcAllocated: null,
    pdcUsed: null,
    pdcPreviousAllocated: null,
    pdcPreviousUsed: null,
    pdcUtilization: null,
    pdcTrend: createDirectTargetEmptyTrend_(),
    capacityPeriod: '',
    previousCapacityPeriod: '',
    tdcCapacityPeriod: '',
    tdcPreviousCapacityPeriod: '',
    pdcCapacityPeriod: '',
    pdcPreviousCapacityPeriod: ''
  };
}

function createDirectTargetEmptyTrend_() {
  return {
    status: 'INSUFFICIENT_DATA',
    changePercentagePoints: null,
    previousUtilization: null
  };
}

function compareDirectTargetBranches_(firstBranch, secondBranch) {
  const salesDifference =
    directTargetNumber_(secondBranch.sales) -
    directTargetNumber_(firstBranch.sales);

  if (salesDifference !== 0) {
    return salesDifference;
  }

  return String(firstBranch.branchName || '').localeCompare(
    String(secondBranch.branchName || '')
  );
}

function compareDirectTargetRegions_(firstRegion, secondRegion) {
  if (firstRegion === 'NIR') {
    return -1;
  }

  if (secondRegion === 'NIR') {
    return 1;
  }

  const firstNumberMatch = String(firstRegion).match(/\d+/);
  const secondNumberMatch = String(secondRegion).match(/\d+/);
  const firstNumber = firstNumberMatch
    ? Number(firstNumberMatch[0])
    : 999;
  const secondNumber = secondNumberMatch
    ? Number(secondNumberMatch[0])
    : 999;

  if (firstNumber !== secondNumber) {
    return firstNumber - secondNumber;
  }

  return String(firstRegion).localeCompare(String(secondRegion));
}

function directTargetNormalizeRegion_(value) {
  const cleaned = directTargetCleanText_(value);
  const uppercase = cleaned.toUpperCase();

  if (!uppercase) {
    return 'Unspecified';
  }

  if (
    uppercase === 'NIR' ||
    uppercase.indexOf('NEGROS ISLAND') !== -1
  ) {
    return 'NIR';
  }

  const numberMatch = uppercase.match(/\d+/);

  if (numberMatch) {
    return 'Region ' + Number(numberMatch[0]);
  }

  return cleaned;
}

function directTargetNormalizeKey_(value) {
  return directTargetCleanText_(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function directTargetCleanText_(value) {
  const safeValue =
    value === null || value === undefined
      ? ''
      : value;

  return String(safeValue)
    .replace(/\s+/g, ' ')
    .trim();
}

function directTargetNumber_(value) {
  const normalized =
    typeof value === 'string'
      ? value.replace(/[₱,%\s,]/g, '')
      : value;
  const parsed = Number(normalized);

  return isFinite(parsed) ? parsed : 0;
}

function directTargetRound2_(value) {
  const number = directTargetNumber_(value);

  return (
    Math.round(
      (number + Number.EPSILON) * 100
    ) / 100
  );
}

function directTargetPercentage_(numerator, denominator) {
  const safeDenominator = directTargetNumber_(denominator);

  if (safeDenominator <= 0) {
    return null;
  }

  return directTargetRound2_(
    directTargetNumber_(numerator) /
      safeDenominator *
      100
  );
}

function directTargetYearMonthKey_(dateInput) {
  if (!dateInput) {
    return null;
  }

  if (
    dateInput instanceof Date &&
    !isNaN(dateInput.getTime())
  ) {
    return (
      dateInput.getFullYear() * 100 +
      dateInput.getMonth() +
      1
    );
  }

  const dateText = directTargetCleanText_(dateInput);
  const match = dateText.match(/^(\d{4})-(\d{1,2})/);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);

    if (year && month >= 1 && month <= 12) {
      return year * 100 + month;
    }
  }

  const parsedDate = new Date(dateText);

  if (!isNaN(parsedDate.getTime())) {
    return (
      parsedDate.getFullYear() * 100 +
      parsedDate.getMonth() +
      1
    );
  }

  return null;
}
