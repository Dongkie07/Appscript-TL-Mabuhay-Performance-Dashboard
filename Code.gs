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

function clearDashboardCache() {
  const spreadsheet = getSpreadsheet_();
  clearDashboardSourceCache_(spreadsheet);

  return {
    cleared: true,
    spreadsheetName: spreadsheet.getName()
  };
}

/**
 * Refreshes the normalized source cache and prepares the two most common
 * executive views: latest month and year-to-date.
 *
 * Run manually once to authorize it, or install the 15-minute trigger below.
 */
function warmDashboardCache() {
  const spreadsheet = getSpreadsheet_();
  const timezone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const sourceResult = getDashboardSourcesCached_(spreadsheet, true);
  const salesSource = sourceResult.sources.sales;
  const maximumDate = salesSource.maxDate;

  if (!(maximumDate instanceof Date)) {
    throw new Error('No valid sales date was found for cache warming.');
  }

  const monthStart = new Date(
    maximumDate.getFullYear(),
    maximumDate.getMonth(),
    1
  );
  const yearStart = new Date(maximumDate.getFullYear(), 0, 1);
  const commonFilters = {
    endDate: formatDate_(maximumDate, timezone),
    region: 'ALL',
    branch: 'ALL'
  };

  buildDashboardDataWithMonthlyTargetFix_(
    Object.assign({}, commonFilters, {
      startDate: formatDate_(monthStart, timezone)
    })
  );

  buildExecutiveSalesSupport_(
    Object.assign({}, commonFilters, {
      startDate: formatDate_(yearStart, timezone)
    })
  );

  return {
    warmed: true,
    spreadsheetName: spreadsheet.getName(),
    dataThrough: formatDate_(maximumDate, timezone),
    latestMonthStart: formatDate_(monthStart, timezone),
    yearStart: formatDate_(yearStart, timezone),
    sourceCacheStatus: sourceResult.cacheStatus,
    warmedAt: Utilities.formatDate(
      new Date(),
      timezone,
      'yyyy-MM-dd HH:mm:ss'
    )
  };
}

/**
 * Installs one shared cache-warming trigger that runs every 15 minutes.
 * Run this function once from the Apps Script editor and approve permissions.
 */
function installDashboardWarmCacheTrigger() {
  removeDashboardWarmCacheTrigger();

  const trigger = ScriptApp
    .newTrigger('warmDashboardCache')
    .timeBased()
    .everyMinutes(15)
    .create();

  return {
    installed: true,
    handler: trigger.getHandlerFunction(),
    uniqueId: trigger.getUniqueId()
  };
}

function removeDashboardWarmCacheTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  for (let index = 0; index < triggers.length; index += 1) {
    if (triggers[index].getHandlerFunction() === 'warmDashboardCache') {
      ScriptApp.deleteTrigger(triggers[index]);
      removed += 1;
    }
  }

  return {
    removed: removed
  };
}
