/**
 * TDC/PDC source-to-collection lender/borrower analytics.
 */

/**
 * Builds lender-to-borrower TDC/PDC slot-sharing analytics.
 *
 * Source/lender branch: Final Branch (SOURCE), with SOURCE input as fallback.
 * Borrower/collector: COLLECTION BRANCH.
 * Slot counts: Daily TDC Lent Slots and Daily PDC Lent Slots.
 */
function buildSlotSharingData_(requestedFilters) {
  const request = requestedFilters || {};
  const spreadsheet = getSpreadsheet_();
  const forceRefresh = request.forceRefresh === true;
  const sourceResult = getDashboardSourcesCached_(spreadsheet, forceRefresh);
  const salesSource = sourceResult.sources.sales;
  const filters = normalizeFilters_(
    request,
    salesSource.minDate,
    salesSource.maxDate
  );
  const resultType = 'SLOT_SHARING_V1';

  if (!forceRefresh) {
    const cached = readDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      resultType
    );

    if (cached) {
      cached.cacheStatus = 'HIT';
      return cached;
    }
  }

  const response = buildSlotSharingDataFromSources_(
    spreadsheet,
    salesSource,
    filters,
    sourceResult
  );

  try {
    writeDashboardResultCache_(
      spreadsheet,
      sourceResult,
      filters,
      resultType,
      response
    );
  } catch (cacheError) {
    console.warn('Slot-sharing result cache write failed: ' + cacheError);
  }

  return response;
}

function buildSlotSharingDataFromSources_(
  spreadsheet,
  salesSource,
  filters,
  sourceResult
) {
  const timezone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();
  const bounds = executiveFindSalesDateBounds_(
    salesSource,
    filters.startDate,
    filters.endDate
  );
  const relationshipMap = Object.create(null);
  const lenderMap = Object.create(null);
  const borrowerMap = Object.create(null);
  const summary = {
    tdcLentSlots: 0,
    pdcLentSlots: 0,
    transactions: 0,
    sales: 0,
    identifiedRecords: 0,
    unknownSourceRecords: 0,
    relationshipCount: 0
  };

  for (let rowIndex = bounds.start; rowIndex < bounds.end; rowIndex += 1) {
    const row = salesSource.rows[rowIndex];
    const service = getSlotSharingService_(row);

    if (!service) continue;

    const sourceName = cleanText_(row.branchName);
    const sourceKey = normalizeKey_(sourceName);
    const borrowerName = cleanText_(
      row.collectionBranchName || row.branchName
    );
    const borrowerKey = normalizeKey_(borrowerName);
    const sourceRegion = row.region || 'Unspecified';
    const borrowerRegion = row.collectionRegion || sourceRegion;
    const sourceKnown = isKnownSlotSource_(sourceName);
    const differentBranches =
      sourceKnown &&
      sourceKey &&
      borrowerKey &&
      sourceKey !== borrowerKey;
    const lentSlots = service === 'TDC'
      ? nonNegativeNumber_(row.tdcLentSlots)
      : nonNegativeNumber_(row.pdcLentSlots);

    /*
     * A row belongs to slot sharing when the source and collection branches
     * differ, or the source Sheet explicitly reports a positive lent-slot
     * count. Unknown-source rows are kept for data-quality follow-up.
     */
    if (!differentBranches && lentSlots <= 0) continue;

    if (!matchesSlotSharingFilters_(
      sourceRegion,
      sourceKey,
      borrowerRegion,
      borrowerKey,
      filters
    )) {
      continue;
    }

    if (!sourceKnown) {
      summary.unknownSourceRecords += 1;
    } else if (differentBranches) {
      summary.identifiedRecords += 1;
    }

    if (service === 'TDC') {
      summary.tdcLentSlots += lentSlots;
    } else {
      summary.pdcLentSlots += lentSlots;
    }

    summary.transactions += numberOrZero_(row.transactions);
    summary.sales += numberOrZero_(row.amount);

    const dateKey = formatDate_(row.date, timezone);
    const safeSourceKey = sourceKnown ? sourceKey : 'UNKNOWN_SOURCE';
    const mapKey = [
      dateKey,
      service,
      safeSourceKey,
      borrowerKey || 'UNSPECIFIED_BORROWER'
    ].join('|');

    if (!relationshipMap[mapKey]) {
      relationshipMap[mapKey] = {
        date: dateKey,
        service: service,
        lender: sourceKnown ? sourceName : 'Source branch pending',
        lenderKey: safeSourceKey,
        lenderRegion: sourceKnown ? sourceRegion : 'Unspecified',
        borrower: borrowerName || 'Unspecified',
        borrowerKey: borrowerKey || 'UNSPECIFIED_BORROWER',
        borrowerRegion: borrowerRegion || 'Unspecified',
        slots: 0,
        transactions: 0,
        sales: 0,
        sourceKnown: sourceKnown
      };
    }

    const relationship = relationshipMap[mapKey];
    relationship.slots += lentSlots;
    relationship.transactions += numberOrZero_(row.transactions);
    relationship.sales += numberOrZero_(row.amount);

    if (sourceKnown && differentBranches) {
      addSlotSharingPartyTotal_(
        lenderMap,
        sourceKey,
        sourceName,
        sourceRegion,
        lentSlots,
        row.transactions,
        row.amount
      );
    }

    addSlotSharingPartyTotal_(
      borrowerMap,
      borrowerKey || 'UNSPECIFIED_BORROWER',
      borrowerName || 'Unspecified',
      borrowerRegion,
      lentSlots,
      row.transactions,
      row.amount
    );
  }

  const relationships = Object.keys(relationshipMap)
    .map(function mapRelationship(key) {
      const item = relationshipMap[key];
      return {
        date: item.date,
        service: item.service,
        lender: item.lender,
        lenderKey: item.lenderKey,
        lenderRegion: item.lenderRegion,
        borrower: item.borrower,
        borrowerKey: item.borrowerKey,
        borrowerRegion: item.borrowerRegion,
        slots: round2_(item.slots),
        transactions: round2_(item.transactions),
        sales: round2_(item.sales),
        sourceKnown: item.sourceKnown
      };
    })
    .sort(compareSlotSharingRows_);

  summary.relationshipCount = relationships.length;

  return {
    filtersApplied: {
      startDate: formatDate_(filters.startDate, timezone),
      endDate: formatDate_(filters.endDate, timezone),
      region: filters.region,
      branch: filters.branch
    },
    summary: {
      tdcLentSlots: round2_(summary.tdcLentSlots),
      pdcLentSlots: round2_(summary.pdcLentSlots),
      totalLentSlots: round2_(
        summary.tdcLentSlots + summary.pdcLentSlots
      ),
      transactions: round2_(summary.transactions),
      sales: round2_(summary.sales),
      identifiedRecords: summary.identifiedRecords,
      unknownSourceRecords: summary.unknownSourceRecords,
      relationshipCount: summary.relationshipCount
    },
    topLenders: finalizeSlotSharingPartyTotals_(lenderMap, 10),
    topBorrowers: finalizeSlotSharingPartyTotals_(borrowerMap, 10),
    relationships: relationships.slice(0, DASHBOARD_CONFIG.SLOT_SHARING_ROW_LIMIT),
    truncated: relationships.length > DASHBOARD_CONFIG.SLOT_SHARING_ROW_LIMIT,
    sourceColumns: {
      lender: 'H Final Branch (SOURCE), BC SOURCE fallback',
      borrower: 'BA COLLECTION BRANCH',
      tdcSlots: 'X Daily TDC Lent Slots',
      pdcSlots: 'AH Daily PDC Lent Slots',
      transactions: 'BH',
      sales: 'BI'
    },
    cacheStatus: sourceResult.cacheStatus || 'MISS',
    cachedAt:
      sourceResult.cachedAt instanceof Date
        ? sourceResult.cachedAt.toISOString()
        : String(sourceResult.cachedAt || '')
  };
}

function getSlotSharingService_(row) {
  const serviceGroup = cleanText_(row.serviceGroup).toUpperCase();

  if (serviceGroup === 'TDC' || serviceGroup === 'OTDC') {
    return 'TDC';
  }

  if (serviceGroup === 'PDC') {
    return 'PDC';
  }

  return '';
}

function isKnownSlotSource_(branchName) {
  const value = cleanText_(branchName).toUpperCase();

  if (!value) return false;

  const invalidMarkers = [
    'NOT YET UPDATED',
    'SOURCE BRANCH PENDING',
    'PENDING SOURCE',
    'UNKNOWN',
    'UNSPECIFIED',
    'UNASSIGNED'
  ];

  for (let index = 0; index < invalidMarkers.length; index += 1) {
    if (value.indexOf(invalidMarkers[index]) !== -1) {
      return false;
    }
  }

  return true;
}

function matchesSlotSharingFilters_(
  lenderRegion,
  lenderKey,
  borrowerRegion,
  borrowerKey,
  filters
) {
  const regionMatches =
    filters.region === 'ALL' ||
    lenderRegion === filters.region ||
    borrowerRegion === filters.region;
  const branchMatches =
    filters.branch === 'ALL' ||
    lenderKey === filters.branch ||
    borrowerKey === filters.branch;

  return regionMatches && branchMatches;
}

function addSlotSharingPartyTotal_(
  map,
  key,
  name,
  region,
  slots,
  transactions,
  sales
) {
  if (!key) return;

  if (!map[key]) {
    map[key] = {
      branchKey: key,
      branchName: name || key,
      region: region || 'Unspecified',
      slots: 0,
      transactions: 0,
      sales: 0
    };
  }

  map[key].slots += numberOrZero_(slots);
  map[key].transactions += numberOrZero_(transactions);
  map[key].sales += numberOrZero_(sales);
}

function finalizeSlotSharingPartyTotals_(map, limit) {
  return Object.keys(map)
    .map(function mapParty(key) {
      return {
        branchKey: map[key].branchKey,
        branchName: map[key].branchName,
        region: map[key].region,
        slots: round2_(map[key].slots),
        transactions: round2_(map[key].transactions),
        sales: round2_(map[key].sales)
      };
    })
    .sort(function sortParties(first, second) {
      if (second.slots !== first.slots) {
        return second.slots - first.slots;
      }

      return second.sales - first.sales;
    })
    .slice(0, limit || 10);
}

function compareSlotSharingRows_(first, second) {
  if (first.date !== second.date) {
    return first.date < second.date ? 1 : -1;
  }

  if (first.service !== second.service) {
    return first.service.localeCompare(second.service);
  }

  if (first.lender !== second.lender) {
    return first.lender.localeCompare(second.lender);
  }

  return first.borrower.localeCompare(second.borrower);
}
