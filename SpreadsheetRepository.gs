/**
 * Reads and normalizes spreadsheet data.
 *
 * This file uses read methods only. It never writes to the spreadsheet.
 */

function readDashboardSources_(spreadsheet) {
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

  const dataRowCount = lastRow - 1;

  // Each required source range is read exactly once per fresh source load.
  const coreValues = salesSheet
    .getRange(2, 1, dataRowCount, 12)
    .getValues();
  const capacityValues = salesSheet
    .getRange(2, 26, dataRowCount, 18)
    .getValues();
  const inputValues = salesSheet
    .getRange(2, 53, dataRowCount, 10)
    .getValues();

  return normalizeSalesRows_(
    coreValues,
    capacityValues,
    inputValues,
    sourceTimeZone
  );
}

function validateSalesHeaders_(salesSheet) {
  validateHeader_(salesSheet, 'BB1', 'TRANSACTION DATE');
  validateHeader_(salesSheet, 'BC1', 'SOURCE');
  validateHeader_(salesSheet, 'BF1', 'SERVICE');
  validateHeader_(salesSheet, 'BH1', 'COUNTA');
  validateHeader_(salesSheet, 'BI1', 'AMOUNT');
}

function createEmptySalesSource_() {
  return {
    rows: [],
    minDate: null,
    maxDate: null,
    canonicalBranches: Object.create(null),
    regions: Object.create(null)
  };
}

function normalizeSalesRows_(
  coreValues,
  capacityValues,
  inputValues,
  sourceTimeZone
) {
  const salesSource = createEmptySalesSource_();

  for (let rowIndex = 0; rowIndex < inputValues.length; rowIndex += 1) {
    const salesRow = createSalesRow_(
      coreValues[rowIndex],
      capacityValues[rowIndex],
      inputValues[rowIndex],
      sourceTimeZone
    );

    salesSource.rows.push(salesRow);
    updateSalesDateRange_(salesSource, salesRow.date);
    registerCanonicalBranch_(salesSource, salesRow);
  }

  return salesSource;
}

function createSalesRow_(
  coreRow,
  capacityRow,
  inputRow,
  sourceTimeZone
) {
  const transactionDate = asSheetDate_(
    inputRow[1],
    sourceTimeZone
  );
  const branchName = cleanText_(
    inputRow[2] || coreRow[7] || inputRow[0]
  );
  const year =
    positiveInteger_(coreRow[0]) ||
    yearFromDate_(transactionDate);
  const month =
    positiveInteger_(coreRow[1]) ||
    monthFromDate_(transactionDate);

  return {
    date: transactionDate,
    year: year,
    month: month,
    week: positiveInteger_(coreRow[2]),
    branchName: branchName,
    branchKey: normalizeKey_(branchName),
    region: normalizeRegion_(coreRow[6]),
    serviceGroup: normalizeServiceGroup_(
      coreRow[3] || inputRow[5]
    ),
    target: nonNegativeNumber_(coreRow[11]),
    transactions: nonNegativeNumber_(inputRow[7]),
    amount: numberOrZero_(inputRow[8]),
    tdcAllocated: nullableNonNegativeNumber_(capacityRow[0]),
    tdcUsed: nullableNonNegativeNumber_(capacityRow[1]),
    pdcAllocated: nullableNonNegativeNumber_(capacityRow[10]),
    pdcUsed: nullableNonNegativeNumber_(capacityRow[11])
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

function isUnspecifiedRegion_(region) {
  return !region || region === 'Unspecified';
}

function readExpenseSource_(spreadsheet) {
  const sourceTimeZone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const expenseSheet = requireSheet_(
    spreadsheet,
    DASHBOARD_CONFIG.EXPENSE_SHEET
  );

  validateHeader_(expenseSheet, 'E1', 'BRANCH');
  validateHeader_(expenseSheet, 'F1', 'DISBURSED DATE');
  validateHeader_(expenseSheet, 'J1', 'EXPENSE');

  const lastRow = expenseSheet.getLastRow();
  if (lastRow < 2) return { rows: [] };

  const values = expenseSheet
    .getRange(2, 4, lastRow - 1, 9)
    .getValues();
  const rows = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    rows.push(createExpenseRow_(values[rowIndex], sourceTimeZone));
  }

  return { rows: rows };
}

function createExpenseRow_(sourceRow, sourceTimeZone) {
  const branchName = cleanText_(sourceRow[1]);

  return {
    region: normalizeRegion_(sourceRow[0]),
    branchName: branchName,
    branchKey: normalizeKey_(branchName),
    date: asSheetDate_(sourceRow[2], sourceTimeZone),
    amount: numberOrZero_(sourceRow[6]),
    expenseType:
      cleanText_(sourceRow[8] || sourceRow[7]) ||
      'Unclassified'
  };
}

function readCustomerSource_(spreadsheet) {
  const sourceTimeZone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const customerSheet = requireSheet_(
    spreadsheet,
    DASHBOARD_CONFIG.CUSTOMER_SHEET
  );

  validateHeader_(customerSheet, 'E1', 'BRANCH');
  validateHeader_(customerSheet, 'F1', 'TRANSACTION DATE');
  validateHeader_(customerSheet, 'I1', 'COUNTA');

  const lastRow = customerSheet.getLastRow();
  if (lastRow < 2) return { rows: [] };

  const values = customerSheet
    .getRange(2, 4, lastRow - 1, 8)
    .getValues();
  const rows = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    rows.push(createCustomerRow_(values[rowIndex], sourceTimeZone));
  }

  return { rows: rows };
}

function createCustomerRow_(sourceRow, sourceTimeZone) {
  const branchName = cleanText_(sourceRow[1]);

  return {
    region: normalizeRegion_(sourceRow[0]),
    branchName: branchName,
    branchKey: normalizeKey_(branchName),
    date: asSheetDate_(sourceRow[2], sourceTimeZone),
    customerCount: nonNegativeNumber_(sourceRow[5]),
    customerType: normalizeCustomerType_(
      sourceRow[7] || sourceRow[3]
    )
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

function validateHeader_(sheet, cellReference, expectedText) {
  const actualHeader = cleanText_(
    sheet.getRange(cellReference).getDisplayValue()
  ).toUpperCase();
  const expectedHeader = expectedText.toUpperCase();

  if (actualHeader.indexOf(expectedHeader) !== -1) return;

  throw new Error(
    'Column check failed in "' + sheet.getName() + '" at ' +
    cellReference + '. Expected a header containing "' +
    expectedText + '", but found "' + actualHeader + '".'
  );
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
