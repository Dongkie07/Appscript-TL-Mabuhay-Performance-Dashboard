/**
 * TDC/PDC utilization request orchestration and weekly source aggregation.
 */

function buildSlotUtilizationData_(requestedFilters) {
  const processingStartedAt = Date.now();
  const spreadsheet = getSpreadsheet_();
  const timezone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const sourceResult = getDashboardSourcesCached_(
    spreadsheet,
    false
  );
  const salesSource = sourceResult.sources.sales;

  assertSalesDatesExist_(salesSource);

  const filters = normalizeFilters_(
    requestedFilters || {},
    salesSource.minDate,
    salesSource.maxDate
  );
  const cachedResponse = readDashboardResultCache_(
    spreadsheet,
    sourceResult,
    filters,
    'SLOT_UTILIZATION_ANALYTICS_V3_DATA_QUALITY'
  );
  if (cachedResponse) {
    return prepareCachedDashboardResponse_(
      cachedResponse,
      sourceResult,
      timezone,
      processingStartedAt
    );
  }

  const capacitySnapshots = Object.create(null);
  const weeklyBusiness = Object.create(null);
  let rowsMatched = 0;
  for (
    let rowIndex = 0;
    rowIndex < salesSource.rows.length;
    rowIndex += 1
  ) {
    const salesRow = salesSource.rows[rowIndex];
    if (!salesRow.date || !salesRow.branchKey) {
      continue;
    }

    const branchIdentity = resolveBranchIdentity_(
      salesRow,
      salesSource.canonicalBranches
    );
    if (
      !matchesFilters_(
        salesRow.date,
        branchIdentity.region,
        salesRow.branchKey,
        filters
      )
    ) {
      continue;
    }

    recordWeeklyBranchBusiness_(
      weeklyBusiness,
      salesRow
    );
    if (hasCapacityData_(salesRow)) {
      rowsMatched += 1;
    }

    updateDetailedCapacitySnapshot_(
      capacitySnapshots,
      salesRow,
      branchIdentity.branchName,
      branchIdentity.region
    );
  }

  const response = {
    meta: {
      spreadsheetName: spreadsheet.getName(),
      readOnly: true,
      processingMs: Date.now() - processingStartedAt,
      sourceCacheStatus: sourceResult.cacheStatus,
      sourceCachedAt: Utilities.formatDate(
        sourceResult.cachedAt,
        timezone,
        'yyyy-MM-dd HH:mm:ss'
      ),
      resultCacheStatus: 'MISS'
    },
    filtersApplied: buildAppliedFilters_(filters, timezone),
    capacity: buildCapacityView_(
      capacitySnapshots,
      weeklyBusiness,
      salesSource.canonicalBranches,
      filters
    ),
    health: {
      salesRowsRead: salesSource.rows.length,
      capacityRowsMatched: rowsMatched
    }
  };
  try {
    writeDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      'SLOT_UTILIZATION_ANALYTICS_V3_DATA_QUALITY',
      response
    );
  } catch (cacheError) {
    console.warn(
      'Slot utilization result cache write failed: ' +
      cacheError
    );
  }

  return response;
}

function recordWeeklyBranchBusiness_(
  weeklyBusiness,
  salesRow
) {
  if (!salesRow.year || !salesRow.week) {
    return;
  }

  const branchKey = salesRow.branchKey;
  const periodKey =
    salesRow.year * 100 + salesRow.week;
  let branchWeeks = weeklyBusiness[branchKey];

  if (!branchWeeks) {
    branchWeeks = Object.create(null);
    weeklyBusiness[branchKey] = branchWeeks;
  }

  let weeklyRecord = branchWeeks[periodKey];

  if (!weeklyRecord) {
    weeklyRecord = {
      sales: 0,
      transactions: 0,
      serviceGroups: Object.create(null)
    };
    branchWeeks[periodKey] = weeklyRecord;
  }

  weeklyRecord.sales += Number(salesRow.amount) || 0;
  weeklyRecord.transactions +=
    Number(salesRow.transactions) || 0;
  if (
    salesRow.serviceGroup &&
    salesRow.serviceGroup !== 'Unspecified'
  ) {
    weeklyRecord.serviceGroups[
      salesRow.serviceGroup
    ] = true;
  }
}

function updateDetailedCapacitySnapshot_(
  capacitySnapshots,
  salesRow,
  branchName,
  region
) {
  if (!hasCapacityData_(salesRow)) {
    return;
  }

  const periodKey =
    salesRow.year * 100 + salesRow.week;
  let branchHistory =
    capacitySnapshots[salesRow.branchKey];
  if (!branchHistory) {
    branchHistory = {
      snapshots: Object.create(null)
    };
    capacitySnapshots[salesRow.branchKey] =
      branchHistory;
  }

  const snapshotKey = String(periodKey);
  const incomingSnapshot = createCapacitySnapshot_(
    periodKey,
    salesRow,
    branchName,
    region
  );
  const savedSnapshot =
    branchHistory.snapshots[snapshotKey];

  if (savedSnapshot) {
    mergeCapacitySnapshot_(
      savedSnapshot,
      incomingSnapshot
    );
    return;
  }

  branchHistory.snapshots[snapshotKey] =
    incomingSnapshot;
}
