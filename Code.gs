/**
 * Web app entry points.
 */

function doGet() {
  const pageTemplate = HtmlService.createTemplateFromFile('Index');

  return pageTemplate
    .evaluate()
    .setTitle(DASHBOARD_CONFIG.TITLE);
}

function include(fileName) {
  return HtmlService
    .createHtmlOutputFromFile(fileName)
    .getContent();
}

function getDashboardData(requestedFilters) {
  return buildDashboardData_(requestedFilters || {});
}

function getSlotUtilizationData(requestedFilters) {
  return buildSlotUtilizationData_(requestedFilters || {});
}

function clearDashboardCache() {
  const spreadsheet = getSpreadsheet_();
  clearDashboardSourceCache_(spreadsheet);

  return {
    cleared: true,
    spreadsheetName: spreadsheet.getName()
  };
}
