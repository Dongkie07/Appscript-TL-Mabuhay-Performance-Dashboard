/**
 * Shared spreadsheet repository helpers.
 */

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
