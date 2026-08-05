/**
 * Reads and normalizes spreadsheet data.
 *
 * This file uses read methods only. It never writes to the spreadsheet.
 */

function readDashboardSources_(spreadsheet) {
  /*
   * Read each reusable source once during a cold cache build. The current
   * SLSAch% pivots are sourced directly from CATEGORY OF SALES V2, so the
   * normalized sales rows also carry the company, region, and branch target
   * contribution fields used by those pivots.
   */
  return {
    sales: readSalesSource_(spreadsheet),
    expenses: readExpenseSource_(spreadsheet),
    customers: readCustomerSource_(spreadsheet)
  };
}

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
    .getRange(2, 26, dataRowCount, 18)
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
  const inputHeaders = salesSheet
    .getRange(1, 52, 1, 11)
    .getDisplayValues()[0];

  assertHeaderValue_(salesSheet, 'J1', coreHeaders[9], 'MONTHLY DS TARGET');
  assertHeaderValue_(salesSheet, 'K1', coreHeaders[10], 'MONTHLY REGION SALES TARGET');
  assertHeaderValue_(salesSheet, 'L1', coreHeaders[11], 'MONTHLY BRANCH SALES TARGET');
  assertHeaderValue_(salesSheet, 'M1', coreHeaders[12], '%ACH DS');
  assertHeaderValue_(salesSheet, 'N1', coreHeaders[13], '%ACH REGION');
  assertHeaderValue_(salesSheet, 'O1', coreHeaders[14], '%ACH BRANCH');
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
    inputRow[3] || coreRow[7] || collectionBranchName
  );
  const sourceBranchKey = normalizeKey_(sourceBranchName);
  const sourceRegion = normalizeRegion_(coreRow[6]);
  const target = nonNegativeNumber_(coreRow[11]);
  const transactions = nonNegativeNumber_(inputRow[8]);
  const amount = numberOrZero_(inputRow[9]);
  const tdcAllocated = nullableNonNegativeNumber_(capacityRow[0]);
  const tdcUsed = nullableNonNegativeNumber_(capacityRow[1]);
  const pdcAllocated = nullableNonNegativeNumber_(capacityRow[10]);
  const pdcUsed = nullableNonNegativeNumber_(capacityRow[11]);
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

/**
 * Reads the normalized source behind the SLSAch% pivot.
 *
 * The dashboard intentionally uses the pivot's authoritative fields:
 *   N = monthly target
 *   P = actual collections
 *   Q = branch achievement percentage
 *
 * The compact rows are stored in the shared source cache so changing filters
 * does not trigger another wide slsTGT read.
 */
function readOfficialTargetSource_(spreadsheet, salesSource) {
  const targetSheet = findOfficialTargetSheet_(spreadsheet);

  if (!targetSheet || targetSheet.getLastRow() < 2) {
    return {
      source: 'slsTGT',
      rows: []
    };
  }

  const dataRowCount = getActualDataRowCountByColumn_(
    targetSheet,
    1,
    targetSheet.getLastRow()
  );

  if (dataRowCount < 1) {
    return {
      source: targetSheet.getName(),
      rows: []
    };
  }

  const values = targetSheet
    .getRange(2, 1, dataRowCount, 17)
    .getValues();
  const rows = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const sourceRow = values[rowIndex];
    const year = positiveInteger_(sourceRow[0]);
    const month = positiveInteger_(sourceRow[1]);
    const branchName = cleanText_(sourceRow[5]);
    const branchKey = normalizeKey_(branchName);

    if (!year || !month || !branchKey) {
      continue;
    }

    const canonical =
      salesSource &&
      salesSource.canonicalBranches &&
      salesSource.canonicalBranches[branchKey];

    rows.push({
      year: year,
      month: month,
      period: year * 100 + month,
      region:
        normalizeRegion_(sourceRow[3]) ||
        (canonical && canonical.region
          ? canonical.region
          : 'Unspecified'),
      branchName: branchName,
      branchKey: branchKey,
      target: nonNegativeNumber_(sourceRow[13]),
      actual: nonNegativeNumber_(sourceRow[15]),
      achievement: nullableNumericSourceValue_(sourceRow[16])
    });
  }

  rows.sort(function sortOfficialRows(first, second) {
    if (first.period !== second.period) {
      return first.period - second.period;
    }

    return first.branchName.localeCompare(second.branchName);
  });

  return {
    source: targetSheet.getName(),
    rows: rows
  };
}

function findOfficialTargetSheet_(spreadsheet) {
  const preferredNames = [
    DASHBOARD_CONFIG.TARGET_SHEET,
    'slsTGT',
    ' slsTGT'
  ].filter(Boolean);

  for (let index = 0; index < preferredNames.length; index += 1) {
    const exactSheet = spreadsheet.getSheetByName(preferredNames[index]);

    if (exactSheet) {
      return exactSheet;
    }
  }

  const sheets = spreadsheet.getSheets();

  for (let index = 0; index < sheets.length; index += 1) {
    if (
      sheets[index]
        .getName()
        .replace(/\s+/g, '')
        .toLowerCase() === 'slstgt'
    ) {
      return sheets[index];
    }
  }

  return null;
}

function nullableNumericSourceValue_(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}


function readExpenseSource_(spreadsheet) {
  const sourceTimeZone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const expenseSheet = requireSheet_(
    spreadsheet,
    DASHBOARD_CONFIG.EXPENSE_SHEET
  );
  const lastColumn = Math.max(1, expenseSheet.getLastColumn());
  const headers = expenseSheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0];
  const columns = {
    region: findHeaderIndex_(headers, ['REGION']),
    branch: findHeaderIndex_(headers, ['BRANCH']),
    date: findHeaderIndex_(headers, ['DISBURSED DATE']),
    amount: findHeaderIndex_(headers, [
      'LIQUIDATED EXPENSE',
      'EXPENSE AMOUNT',
      'AMOUNT'
    ]),
    expenseType: findHeaderIndex_(headers, [
      'TYPE OF EXPENSE',
      'GL DESCRIPTION'
    ])
  };

  assertRequiredHeaderIndex_(expenseSheet, columns.branch, 'BRANCH');
  assertRequiredHeaderIndex_(expenseSheet, columns.date, 'DISBURSED DATE');
  assertRequiredHeaderIndex_(expenseSheet, columns.amount, 'LIQUIDATED EXPENSE');

  const lastRow = expenseSheet.getLastRow();
  if (lastRow < 2) return { rows: [] };

  const dataRowCount = getActualDataRowCountByColumn_(
    expenseSheet,
    columns.date + 1,
    lastRow
  );
  if (dataRowCount < 1) return { rows: [] };

  const values = expenseSheet
    .getRange(2, 1, dataRowCount, lastColumn)
    .getValues();
  const rows = [];
  const dateCache = Object.create(null);

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = createExpenseRow_(
      values[rowIndex],
      columns,
      sourceTimeZone,
      dateCache
    );

    if (row) rows.push(row);
  }

  return { rows: rows };
}

function createExpenseRow_(
  sourceRow,
  columns,
  sourceTimeZone,
  dateCache
) {
  const branchName = cleanText_(sourceRow[columns.branch]);
  const date = asSheetDateCached_(
    sourceRow[columns.date],
    sourceTimeZone,
    dateCache
  );
  const amount = numberOrZero_(sourceRow[columns.amount]);
  const expenseType = columns.expenseType >= 0
    ? cleanText_(sourceRow[columns.expenseType])
    : '';
  const region = columns.region >= 0
    ? normalizeRegion_(sourceRow[columns.region])
    : 'Unspecified';

  if (!branchName && !date && amount === 0 && !expenseType) {
    return null;
  }

  return {
    region: region,
    branchName: branchName,
    branchKey: normalizeKey_(branchName),
    date: date,
    amount: amount,
    expenseType: expenseType || 'Unclassified'
  };
}

function findHeaderIndex_(headers, aliases) {
  const normalizedAliases = aliases.map(function normalizeAlias(alias) {
    return cleanText_(alias).toUpperCase();
  });

  for (let index = 0; index < headers.length; index += 1) {
    const header = cleanText_(headers[index]).toUpperCase();

    for (let aliasIndex = 0; aliasIndex < normalizedAliases.length; aliasIndex += 1) {
      const alias = normalizedAliases[aliasIndex];

      if (header === alias || header.indexOf(alias) !== -1) {
        return index;
      }
    }
  }

  return -1;
}

function assertRequiredHeaderIndex_(sheet, index, expectedText) {
  if (index >= 0) return;

  throw new Error(
    'Column check failed in "' + sheet.getName() +
    '". A header containing "' + expectedText + '" was not found.'
  );
}

function readCustomerSource_(spreadsheet) {
  const sourceTimeZone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const customerSheet = requireSheet_(
    spreadsheet,
    DASHBOARD_CONFIG.CUSTOMER_SHEET
  );

  const customerHeaders = customerSheet
    .getRange(1, 4, 1, 8)
    .getDisplayValues()[0];
  assertHeaderValue_(customerSheet, 'E1', customerHeaders[1], 'BRANCH');
  assertHeaderValue_(customerSheet, 'F1', customerHeaders[2], 'TRANSACTION DATE');
  assertHeaderValue_(customerSheet, 'I1', customerHeaders[5], 'COUNTA');

  const lastRow = customerSheet.getLastRow();
  if (lastRow < 2) return { rows: [] };

  const dataRowCount = getActualDataRowCountByColumn_(
    customerSheet,
    6,
    lastRow
  );
  if (dataRowCount < 1) return { rows: [] };

  const values = customerSheet
    .getRange(2, 4, dataRowCount, 8)
    .getValues();
  const rows = [];
  const dateCache = Object.create(null);

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = createCustomerRow_(
      values[rowIndex],
      sourceTimeZone,
      dateCache
    );

    if (row) rows.push(row);
  }

  return { rows: rows };
}

function createCustomerRow_(sourceRow, sourceTimeZone, dateCache) {
  const branchName = cleanText_(sourceRow[1]);
  const date = asSheetDateCached_(
    sourceRow[2],
    sourceTimeZone,
    dateCache
  );
  const customerCount = nonNegativeNumber_(sourceRow[5]);
  const rawCustomerType = sourceRow[7] || sourceRow[3];

  if (!branchName && !date && customerCount === 0 && !cleanText_(rawCustomerType)) {
    return null;
  }

  return {
    region: normalizeRegion_(sourceRow[0]),
    branchName: branchName,
    branchKey: normalizeKey_(branchName),
    date: date,
    customerCount: customerCount,
    customerType: normalizeCustomerType_(rawCustomerType)
  };
}

function getSpreadsheet_() {
  if (DASHBOARD_CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(
      DASHBOARD_CONFIG.SPREADSHEET_ID
    );
  }

  const activeSpreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  if (activeSpreadsheet) return activeSpreadsheet;

  throw new Error(
    'No spreadsheet is attached. Bind this Apps Script project to the Google Sheet, ' +
    'or set DASHBOARD_CONFIG.SPREADSHEET_ID.'
  );
}

function requireSheet_(spreadsheet, sheetName) {
  const requiredSheet = spreadsheet.getSheetByName(sheetName);
  if (requiredSheet) return requiredSheet;

  throw new Error(
    'Required tab "' + sheetName + '" was not found in "' +
    spreadsheet.getName() + '".'
  );
}

/**
 * Returns the number of real data rows based on one required column. This
 * prevents formula-filled helper columns from forcing very large batch reads.
 */
function getActualDataRowCountByColumn_(sheet, columnNumber, sheetLastRow) {
  const candidateCount = Math.max(0, Number(sheetLastRow) - 1);

  if (candidateCount < 1) return 0;

  const values = sheet
    .getRange(2, columnNumber, candidateCount, 1)
    .getValues();

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index][0];

    if (
      value instanceof Date ||
      (value !== null && value !== undefined && String(value).trim() !== '')
    ) {
      return index + 1;
    }
  }

  return 0;
}

function assertHeaderValue_(sheet, cellReference, actualValue, expectedText) {
  const actualHeader = cleanText_(actualValue).toUpperCase();
  const expectedHeader = expectedText.toUpperCase();

  if (actualHeader.indexOf(expectedHeader) !== -1) return;

  throw new Error(
    'Column check failed in "' + sheet.getName() + '" at ' +
    cellReference + '. Expected a header containing "' +
    expectedText + '", but found "' + actualHeader + '".'
  );
}

function validateHeader_(sheet, cellReference, expectedText) {
  assertHeaderValue_(
    sheet,
    cellReference,
    sheet.getRange(cellReference).getDisplayValue(),
    expectedText
  );
}

function asSheetDateCached_(value, sourceTimeZone, dateCache) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const cache = dateCache || Object.create(null);
  const cacheKey = value instanceof Date
    ? 'D|' + value.getTime()
    : 'V|' + String(value);

  if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
    return cache[cacheKey];
  }

  const normalized = asSheetDate_(value, sourceTimeZone);
  cache[cacheKey] = normalized;
  return normalized;
}

function asSheetDate_(value, sourceTimeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const dateText = Utilities.formatDate(
      value,
      sourceTimeZone || Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
    const parts = dateText.split('-');

    return new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );
  }

  return asDate_(value);
}
