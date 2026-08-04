/**
 * Web app entry points.
 */
function doGet() {
  const pageTemplate = HtmlService.createTemplateFromFile('Index');

  return pageTemplate
    .evaluate()
    .setTitle(DASHBOARD_CONFIG.TITLE);
}

/**
 * Includes an HTML file inside Index.html.
 *
 * MonthlySalesFeature is appended automatically after JavaScript.html,
 * so Index.html does not need to be edited.
 */
function include(fileName) {
  let content = HtmlService
    .createHtmlOutputFromFile(fileName)
    .getContent();

  if (fileName === 'JavaScript') {
    content += '\n' + HtmlService
      .createHtmlOutputFromFile('MonthlySalesFeature')
      .getContent();
  }

  return content;
}

/**
 * Main dashboard endpoint.
 *
 * Uses the corrected dashboard builder so monthly sales targets follow
 * the selected reporting month or selected multi-month date range.
 */
function getDashboardData(requestedFilters) {
  return buildDashboardDataWithMonthlyTargetFix_(
    requestedFilters || {}
  );
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
