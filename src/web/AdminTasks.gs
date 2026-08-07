/**
 * Manual administration and cache-warming tasks.
 */

function clearDashboardCache() {
  const spreadsheet = getSpreadsheet_();
  clearDashboardSourceCache_(spreadsheet);

  return {
    cleared: true,
    spreadsheetName: spreadsheet.getName()
  };
}

/**
 * Refreshes the normalized source cache and prepares the most common
 * dashboard, executive, utilization, and slot-sharing views.
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

  const latestMonthFilters = Object.assign({}, commonFilters, {
    startDate: formatDate_(monthStart, timezone)
  });

  buildSlotUtilizationData_(latestMonthFilters);
  buildSlotSharingData_(latestMonthFilters);

  return {
    warmed: true,
    spreadsheetName: spreadsheet.getName(),
    dataThrough: formatDate_(maximumDate, timezone),
    latestMonthStart: formatDate_(monthStart, timezone),
    yearStart: formatDate_(yearStart, timezone),
    sourceCacheStatus: sourceResult.cacheStatus,
    warmedViews: [
      'latest-month-dashboard',
      'year-to-date-executive',
      'latest-month-slot-utilization',
      'latest-month-slot-sharing'
    ],
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
