/**
 * Reads DISBURSEMENT using header-based column discovery.
 */

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
