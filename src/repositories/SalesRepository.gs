/**
 * Reads and normalizes CATEGORY OF SALES V2.
 */

function readSalesSource_(spreadsheet) {
  const sourceTimeZone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const salesSheet = requireSheet_(
    spreadsheet,
    DASHBOARD_CONFIG.SALES_SHEET
  );

  validateSalesHeaders_(salesSheet);

  const lastRow = salesSheet.getLastRow();

  if (lastRow < 2) {
    return createEmptySalesSource_();
  }

  /*
   * Formula columns can make getLastRow() much larger than the actual encoded
   * data. Column BB is the required transaction date, so use it to trim the
   * three wide batch reads to real reporting rows only.
   */
  const dataRowCount = getActualDataRowCountByColumn_(
    salesSheet,
    54,
    lastRow
  );

  if (dataRowCount < 1) {
    return createEmptySalesSource_();
  }

  // Each required source range is read exactly once per fresh source load.
  const coreValues = salesSheet
    .getRange(2, 1, dataRowCount, 15)
    .getValues();
  const capacityValues = salesSheet
    .getRange(2, 24, dataRowCount, 14)
    .getValues();
  const inputValues = salesSheet
    .getRange(2, 52, dataRowCount, 11)
    .getValues();

  return normalizeSalesRows_(
    coreValues,
    capacityValues,
    inputValues,
    sourceTimeZone
  );
}

function validateSalesHeaders_(salesSheet) {
  const coreHeaders = salesSheet
    .getRange(1, 1, 1, 15)
    .getDisplayValues()[0];
  const capacityHeaders = salesSheet
    .getRange(1, 24, 1, 14)
    .getDisplayValues()[0];
  const inputHeaders = salesSheet
    .getRange(1, 52, 1, 11)
    .getDisplayValues()[0];

  assertHeaderValue_(salesSheet, 'H1', coreHeaders[7], 'FINAL BRANCH');
  assertHeaderValue_(salesSheet, 'J1', coreHeaders[9], 'MONTHLY DS TARGET');
  assertHeaderValue_(salesSheet, 'K1', coreHeaders[10], 'MONTHLY REGION SALES TARGET');
  assertHeaderValue_(salesSheet, 'L1', coreHeaders[11], 'MONTHLY BRANCH SALES TARGET');
  assertHeaderValue_(salesSheet, 'M1', coreHeaders[12], '%ACH DS');
  assertHeaderValue_(salesSheet, 'N1', coreHeaders[13], '%ACH REGION');
  assertHeaderValue_(salesSheet, 'O1', coreHeaders[14], '%ACH BRANCH');
  assertHeaderValue_(salesSheet, 'X1', capacityHeaders[0], 'TDC LENT');
  assertHeaderValue_(salesSheet, 'AH1', capacityHeaders[10], 'PDC LENT');
  assertHeaderValue_(salesSheet, 'AZ1', inputHeaders[0], 'REGION');
  assertHeaderValue_(salesSheet, 'BA1', inputHeaders[1], 'COLLECTION BRANCH');
  assertHeaderValue_(salesSheet, 'BB1', inputHeaders[2], 'TRANSACTION DATE');
  assertHeaderValue_(salesSheet, 'BC1', inputHeaders[3], 'SOURCE');
  assertHeaderValue_(salesSheet, 'BF1', inputHeaders[6], 'SERVICE');
  assertHeaderValue_(salesSheet, 'BH1', inputHeaders[8], 'COUNTA');
  assertHeaderValue_(salesSheet, 'BI1', inputHeaders[9], 'AMOUNT');
}

function createEmptySalesSource_() {
  return {
    rows: [],
    minDate: null,
    maxDate: null,
    datedRowCount: 0,
    canonicalBranches: Object.create(null),
    regions: Object.create(null),
    collectionBranches: Object.create(null),
    collectionRegions: Object.create(null)
  };
}

function normalizeSalesRows_(
  coreValues,
  capacityValues,
  inputValues,
  sourceTimeZone
) {
  const salesSource = createEmptySalesSource_();
  const dateCache = Object.create(null);

  for (let rowIndex = 0; rowIndex < inputValues.length; rowIndex += 1) {
    const salesRow = createSalesRow_(
      coreValues[rowIndex],
      capacityValues[rowIndex],
      inputValues[rowIndex],
      sourceTimeZone,
      dateCache
    );

    if (!salesRow) continue;

    salesSource.rows.push(salesRow);
    updateSalesDateRange_(salesSource, salesRow.date);
    registerCanonicalBranch_(salesSource, salesRow);
    registerCollectionBranch_(salesSource, salesRow);
  }

  /*
   * Date-sorted rows let filtered reports use binary-search boundaries instead
   * of inspecting years of records for every selected period. Rows without a
   * transaction date stay at the end because the monthly-target logic may
   * still need their year/month/branch fields.
   */
  salesSource.rows.sort(compareSalesRowsByDate_);
  salesSource.datedRowCount = countLeadingDatedSalesRows_(salesSource.rows);

  return salesSource;
}

function compareSalesRowsByDate_(firstRow, secondRow) {
  const firstTime = firstRow.date instanceof Date
    ? firstRow.date.getTime()
    : Number.POSITIVE_INFINITY;
  const secondTime = secondRow.date instanceof Date
    ? secondRow.date.getTime()
    : Number.POSITIVE_INFINITY;

  return firstTime - secondTime;
}

function countLeadingDatedSalesRows_(rows) {
  let count = 0;

  while (
    count < rows.length &&
    rows[count].date instanceof Date &&
    !isNaN(rows[count].date.getTime())
  ) {
    count += 1;
  }

  return count;
}

function createSalesRow_(
  coreRow,
  capacityRow,
  inputRow,
  sourceTimeZone,
  dateCache
) {
  /*
   * inputRow covers AZ:BJ:
   *   0 AZ collection region, 1 BA collection branch, 2 BB date,
   *   3 BC source branch, 6 BF service, 8 BH transactions,
   *   9 BI amount, 10 BJ remarks.
   */
  const transactionDate = asSheetDateCached_(
    inputRow[2],
    sourceTimeZone,
    dateCache
  );
  const collectionBranchName = cleanText_(inputRow[1]);
  const collectionBranchKey = normalizeKey_(collectionBranchName);
  const collectionRegion = normalizeRegion_(inputRow[0]);
  const sourceBranchName = cleanText_(
    coreRow[7] || inputRow[3] || collectionBranchName
  );
  const sourceBranchKey = normalizeKey_(sourceBranchName);
  const sourceRegion = normalizeRegion_(coreRow[6]);
  const target = nonNegativeNumber_(coreRow[11]);
  const transactions = nonNegativeNumber_(inputRow[8]);
  const amount = numberOrZero_(inputRow[9]);
  /* capacityRow covers X:AK. */
  const tdcLentSlots = nullableNonNegativeNumber_(capacityRow[0]);
  const tdcAllocated = nullableNonNegativeNumber_(capacityRow[2]);
  const tdcUsed = nullableNonNegativeNumber_(capacityRow[3]);
  const pdcLentSlots = nullableNonNegativeNumber_(capacityRow[10]);
  const pdcAllocated = nullableNonNegativeNumber_(capacityRow[12]);
  const pdcUsed = nullableNonNegativeNumber_(capacityRow[13]);
  const hasCapacity =
    tdcAllocated !== null ||
    tdcUsed !== null ||
    pdcAllocated !== null ||
    pdcUsed !== null;

  if (
    !transactionDate &&
    !sourceBranchName &&
    !collectionBranchName &&
    target === 0 &&
    transactions === 0 &&
    amount === 0 &&
    !hasCapacity
  ) {
    return null;
  }

  const year =
    positiveInteger_(coreRow[0]) ||
    yearFromDate_(transactionDate);
  const month =
    positiveInteger_(coreRow[1]) ||
    monthFromDate_(transactionDate);
  const generalServiceType = cleanText_(coreRow[3]);

  return {
    date: transactionDate,
    year: year,
    month: month,
    week: positiveInteger_(coreRow[2]),

    // Existing source-branch identity is preserved for slot utilization.
    branchName: sourceBranchName,
    branchKey: sourceBranchKey,
    region: sourceRegion,

    // Collection identity is the basis of the redesigned SLSAch% pivots.
    collectionBranchName: collectionBranchName || sourceBranchName,
    collectionBranchKey: collectionBranchKey || sourceBranchKey,
    collectionRegion:
      isUnspecifiedRegion_(collectionRegion)
        ? sourceRegion
        : collectionRegion,

    generalServiceType: generalServiceType,
    serviceCode: cleanText_(inputRow[6]),
    serviceGroup: normalizeServiceGroup_(
      generalServiceType || inputRow[6]
    ),

    companyTarget: nonNegativeNumber_(coreRow[9]),
    regionTarget: nonNegativeNumber_(coreRow[10]),
    branchTarget: target,
    target: target,
    companyAchievementContribution: numberOrZero_(coreRow[12]),
    regionAchievementContribution: numberOrZero_(coreRow[13]),
    branchAchievementContribution: numberOrZero_(coreRow[14]),

    transactions: transactions,
    amount: amount,
    remarks: cleanText_(inputRow[10]),
    tdcLentSlots: tdcLentSlots,
    pdcLentSlots: pdcLentSlots,
    tdcAllocated: tdcAllocated,
    tdcUsed: tdcUsed,
    pdcAllocated: pdcAllocated,
    pdcUsed: pdcUsed
  };
}

function updateSalesDateRange_(salesSource, date) {
  if (!date) return;
  if (!salesSource.minDate || date < salesSource.minDate) {
    salesSource.minDate = date;
  }
  if (!salesSource.maxDate || date > salesSource.maxDate) {
    salesSource.maxDate = date;
  }
}

function registerCanonicalBranch_(salesSource, salesRow) {
  if (!salesRow.branchKey) return;

  const savedBranch =
    salesSource.canonicalBranches[salesRow.branchKey];

  if (!savedBranch) {
    salesSource.canonicalBranches[salesRow.branchKey] = {
      branchName: salesRow.branchName,
      region: salesRow.region
    };
  } else if (
    isUnspecifiedRegion_(savedBranch.region) &&
    !isUnspecifiedRegion_(salesRow.region)
  ) {
    savedBranch.region = salesRow.region;
  }

  salesSource.regions[salesRow.region] = true;
}

function registerCollectionBranch_(salesSource, salesRow) {
  const branchKey = salesRow.collectionBranchKey;

  if (!branchKey) return;

  const savedBranch = salesSource.collectionBranches[branchKey];
  const region = salesRow.collectionRegion || 'Unspecified';

  if (!savedBranch) {
    salesSource.collectionBranches[branchKey] = {
      branchName: salesRow.collectionBranchName || branchKey,
      region: region
    };
  } else if (
    isUnspecifiedRegion_(savedBranch.region) &&
    !isUnspecifiedRegion_(region)
  ) {
    savedBranch.region = region;
  }

  salesSource.collectionRegions[region] = true;
}

function isUnspecifiedRegion_(region) {
  return !region || region === 'Unspecified';
}
