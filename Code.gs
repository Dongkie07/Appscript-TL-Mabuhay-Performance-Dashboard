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
 * so Index.html does not need to be changed.
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
 * The normal dashboard response is built first. Its monthly targets are then
 * replaced using the authoritative branch targets from the " slsTGT" tab.
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
