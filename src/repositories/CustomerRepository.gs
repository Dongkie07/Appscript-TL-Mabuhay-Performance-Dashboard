/**
 * Reads CUSTOMER TYPE V2.
 */

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
