/**
 * Public web-app endpoints. Keep public functions small; delegate work to services.
 */

/**
 * Web app entry points.
 */
function doGet() {
  const pageTemplate = HtmlService.createTemplateFromFile('ui/Index');

  return pageTemplate
    .evaluate()
    .setTitle(DASHBOARD_CONFIG.TITLE);
}

/** Includes one HTML/CSS/JavaScript partial by its clasp path. */
function include(fileName) {
  return HtmlService
    .createHtmlOutputFromFile(fileName)
    .getContent();
}

/**
 * Main dashboard endpoint.
 */
function getDashboardData(requestedFilters) {
  return buildDashboardDataWithMonthlyTargetFix_(
    requestedFilters || {}
  );
}

/**
 * Returns monthly detail, reconciliation and all four trend groupings in one
 * cached response. Daily/weekly/monthly/yearly buttons then switch locally in
 * the browser without another Apps Script request.
 */
function getExecutiveSalesSupport(requestedFilters) {
  return buildExecutiveSalesSupport_(requestedFilters || {});
}

function getSlotUtilizationData(requestedFilters) {
  return buildSlotUtilizationData_(requestedFilters || {});
}

/** Returns lender-to-borrower TDC/PDC slot-sharing analytics. */
function getSlotSharingData(requestedFilters) {
  return buildSlotSharingData_(requestedFilters || {});
}
