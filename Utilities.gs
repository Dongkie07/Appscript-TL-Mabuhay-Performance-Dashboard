/**
 * Small reusable helpers shared by the repository and dashboard service.
 */

function normalizeFilters_(requested, minDate, maxDate) {
  let startDate = asDate_(requested.startDate);
  let endDate = asDate_(requested.endDate);

  if (!startDate || !endDate) {
    const defaultDates = createDefaultDateRange_(
      minDate,
      maxDate
    );

    startDate = defaultDates.startDate;
    endDate = defaultDates.endDate;
  }

  startDate = clampStartDate_(startDate, minDate);
  endDate = clampEndDate_(endDate, maxDate);

  if (startDate > endDate) {
    const originalStartDate = startDate;

    startDate = endDate;
    endDate = originalStartDate;
  }

  return {
    startDate: startDate,
    endDate: endDate,
    region: cleanText_(requested.region) || 'ALL',
    branch: normalizeKey_(requested.branch) || 'ALL'
  };
}

function createDefaultDateRange_(minDate, maxDate) {
  if (DASHBOARD_CONFIG.DEFAULT_WINDOW === 'LATEST_MONTH') {
    return {
      startDate: new Date(
        maxDate.getFullYear(),
        maxDate.getMonth(),
        1
      ),
      endDate: copyDate_(maxDate)
    };
  }

  return {
    startDate: copyDate_(minDate),
    endDate: copyDate_(maxDate)
  };
}

function clampStartDate_(startDate, minDate) {
  if (startDate < minDate) {
    return copyDate_(minDate);
  }

  return startDate;
}

function clampEndDate_(endDate, maxDate) {
  if (endDate > maxDate) {
    return copyDate_(maxDate);
  }

  return endDate;
}

function copyDate_(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function matchesFilters_(
  date,
  region,
  branchKey,
  filters
) {
  if (!date) {
    return false;
  }

  if (
    date < filters.startDate ||
    date > filters.endDate
  ) {
    return false;
  }

  if (
    filters.region !== 'ALL' &&
    region !== filters.region
  ) {
    return false;
  }

  if (
    filters.branch !== 'ALL' &&
    branchKey !== filters.branch
  ) {
    return false;
  }

  return true;
}

function getBranchAggregate_(
  branchTotals,
  branchKey,
  branchName,
  region
) {
  if (!branchTotals[branchKey]) {
    branchTotals[branchKey] = {
      branchName: branchName || 'Unspecified',
      region: region || 'Unspecified',
      sales: 0,
      target: 0,
      transactions: 0,
      customers: 0,
      expenses: 0,
      tdcAllocated: null,
      tdcUsed: null,
      tdcPreviousAllocated: null,
      tdcPreviousUsed: null,
      pdcAllocated: null,
      pdcUsed: null,
      pdcPreviousAllocated: null,
      pdcPreviousUsed: null,
      capacityPeriod: '',
      previousCapacityPeriod: '',
      tdcCapacityPeriod: '',
      tdcPreviousCapacityPeriod: '',
      pdcCapacityPeriod: '',
      pdcPreviousCapacityPeriod: ''
    };
  }

  return branchTotals[branchKey];
}

function updateCapacitySnapshot_(
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
      latest: null,
      previous: null,
      snapshots: Object.create(null)
    };
    capacitySnapshots[salesRow.branchKey] = branchHistory;
  }

  const snapshotKey = String(periodKey);
  const savedSnapshot =
    branchHistory.snapshots[snapshotKey];
  const incomingSnapshot = createCapacitySnapshot_(
    periodKey,
    salesRow,
    branchName,
    region
  );

  if (savedSnapshot) {
    mergeCapacitySnapshot_(
      savedSnapshot,
      incomingSnapshot
    );
    return;
  }

  branchHistory.snapshots[snapshotKey] =
    incomingSnapshot;

  if (
    !branchHistory.latest ||
    periodKey > branchHistory.latest.periodKey
  ) {
    branchHistory.previous = branchHistory.latest;
    branchHistory.latest = incomingSnapshot;
    return;
  }

  if (periodKey === branchHistory.latest.periodKey) {
    mergeCapacitySnapshot_(
      branchHistory.latest,
      incomingSnapshot
    );
    return;
  }

  if (
    !branchHistory.previous ||
    periodKey > branchHistory.previous.periodKey
  ) {
    branchHistory.previous = incomingSnapshot;
    return;
  }

  if (periodKey === branchHistory.previous.periodKey) {
    mergeCapacitySnapshot_(
      branchHistory.previous,
      incomingSnapshot
    );
  }
}

function createCapacitySnapshot_(
  periodKey,
  salesRow,
  branchName,
  region
) {
  return {
    periodKey: periodKey,
    periodLabel: createCapacityPeriodLabel_(salesRow),
    branchName: branchName,
    region: region,
    tdcAllocated: salesRow.tdcAllocated,
    tdcUsed: salesRow.tdcUsed,
    pdcAllocated: salesRow.pdcAllocated,
    pdcUsed: salesRow.pdcUsed
  };
}

function mergeCapacitySnapshot_(
  savedSnapshot,
  incomingSnapshot
) {
  savedSnapshot.tdcAllocated = maxNullable_(
    savedSnapshot.tdcAllocated,
    incomingSnapshot.tdcAllocated
  );
  savedSnapshot.tdcUsed = maxNullable_(
    savedSnapshot.tdcUsed,
    incomingSnapshot.tdcUsed
  );
  savedSnapshot.pdcAllocated = maxNullable_(
    savedSnapshot.pdcAllocated,
    incomingSnapshot.pdcAllocated
  );
  savedSnapshot.pdcUsed = maxNullable_(
    savedSnapshot.pdcUsed,
    incomingSnapshot.pdcUsed
  );
}

function hasCapacityData_(salesRow) {
  return (
    salesRow.tdcAllocated !== null ||
    salesRow.tdcUsed !== null ||
    salesRow.pdcAllocated !== null ||
    salesRow.pdcUsed !== null
  );
}

function createCapacityPeriodLabel_(salesRow) {
  if (salesRow.week) {
    return (
      'Week ' +
      salesRow.week +
      ', ' +
      salesRow.year
    );
  }

  return (
    salesRow.year +
    '-' +
    pad2_(salesRow.month)
  );
}

function chooseTrendBucket_(startDate, endDate) {
  const millisecondsPerDay = 86400000;
  const selectedDayCount =
    Math.floor(
      (endDate - startDate) / millisecondsPerDay
    ) + 1;

  if (selectedDayCount <= 45) {
    return 'DAY';
  }

  if (selectedDayCount <= 180) {
    return 'WEEK';
  }

  return 'MONTH';
}

function createTrendBucket_(date, mode, timezone) {
  if (mode === 'DAY') {
    return {
      key: Utilities.formatDate(
        date,
        timezone,
        'yyyy-MM-dd'
      ),
      label: Utilities.formatDate(
        date,
        timezone,
        'MMM d'
      )
    };
  }

  if (mode === 'WEEK') {
    return createWeeklyTrendBucket_(date, timezone);
  }

  return {
    key: Utilities.formatDate(
      date,
      timezone,
      'yyyy-MM'
    ),
    label: Utilities.formatDate(
      date,
      timezone,
      'MMM yyyy'
    )
  };
}

function createWeeklyTrendBucket_(date, timezone) {
  const monday = copyDate_(date);
  const daysSinceMonday =
    (monday.getDay() + 6) % 7;

  monday.setDate(
    monday.getDate() - daysSinceMonday
  );

  return {
    key: Utilities.formatDate(
      monday,
      timezone,
      'yyyy-MM-dd'
    ),
    label: Utilities.formatDate(
      monday,
      timezone,
      'MMM d'
    )
  };
}

function topSeries_(valueMap, limit) {
  const labels = Object.keys(valueMap);
  const series = [];

  for (
    let labelIndex = 0;
    labelIndex < labels.length;
    labelIndex += 1
  ) {
    const label = labels[labelIndex];

    series.push({
      label: label,
      value: round2_(valueMap[label])
    });
  }

  series.sort(compareSeriesValues_);

  if (series.length <= limit) {
    return series;
  }

  return combineExtraSeriesItems_(series, limit);
}

function compareSeriesValues_(firstItem, secondItem) {
  return secondItem.value - firstItem.value;
}

function combineExtraSeriesItems_(series, limit) {
  const visibleItems = series.slice(0, limit);
  const extraItems = series.slice(limit);
  let otherTotal = 0;

  for (
    let itemIndex = 0;
    itemIndex < extraItems.length;
    itemIndex += 1
  ) {
    otherTotal += extraItems[itemIndex].value;
  }

  visibleItems.push({
    label: 'Other',
    value: round2_(otherTotal)
  });

  return visibleItems;
}

function addToMap_(valueMap, label, amount) {
  const safeLabel = cleanText_(label) || 'Unspecified';
  const currentValue = valueMap[safeLabel] || 0;

  valueMap[safeLabel] =
    currentValue + numberOrZero_(amount);
}

function normalizeServiceGroup_(value) {
  const cleanValue = cleanText_(value);
  const uppercaseValue = cleanValue.toUpperCase();

  if (!uppercaseValue) {
    return 'Unspecified';
  }

  if (uppercaseValue.indexOf('OTDC') !== -1) {
    return 'OTDC';
  }

  if (uppercaseValue.indexOf('TDC') !== -1) {
    return 'TDC';
  }

  if (uppercaseValue.indexOf('PDC') !== -1) {
    return 'PDC';
  }

  if (uppercaseValue.indexOf('DDC') !== -1) {
    return 'DDC';
  }

  if (uppercaseValue.indexOf('CDE') !== -1) {
    return 'CDE';
  }

  if (uppercaseValue.indexOf('DEP') !== -1) {
    return 'DEP';
  }

  if (
    uppercaseValue === 'DL' ||
    uppercaseValue.indexOf('LICENSE') !== -1
  ) {
    return 'DL';
  }

  return cleanValue;
}

function normalizeCustomerType_(value) {
  const cleanValue = cleanText_(value);

  if (!cleanValue) {
    return 'Unspecified';
  }

  const uppercaseValue = cleanValue.toUpperCase();

  if (uppercaseValue.indexOf('WALK') !== -1) {
    return 'Walk-In';
  }

  if (
    uppercaseValue.indexOf('COMPANY') !== -1 ||
    uppercaseValue.indexOf('CORPORATE') !== -1
  ) {
    return 'Company / Corporate';
  }

  if (uppercaseValue.indexOf('REFERR') !== -1) {
    return 'Referral';
  }

  return cleanValue;
}

function normalizeRegion_(value) {
  const cleanValue = cleanText_(value);
  const uppercaseValue = cleanValue.toUpperCase();

  if (!uppercaseValue) {
    return 'Unspecified';
  }

  if (
    uppercaseValue === 'NIR' ||
    uppercaseValue.indexOf('NEGROS ISLAND') !== -1
  ) {
    return 'NIR';
  }

  const numberMatch = uppercaseValue.match(/\d+/);

  if (numberMatch) {
    return 'Region ' + Number(numberMatch[0]);
  }

  return cleanValue;
}

function normalizeKey_(value) {
  return cleanText_(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function cleanText_(value) {
  const safeValue = value === null || value === undefined
    ? ''
    : value;

  return String(safeValue)
    .replace(/\s+/g, ' ')
    .trim();
}

function asDate_(value) {
  if (
    value instanceof Date &&
    !isNaN(value.getTime())
  ) {
    return copyDate_(value);
  }

  if (
    typeof value === 'number' &&
    isFinite(value) &&
    value > 20000
  ) {
    return dateFromExcelSerial_(value);
  }

  const textValue = cleanText_(value);
  const isoDateMatch = textValue.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/
  );

  if (isoDateMatch) {
    return new Date(
      Number(isoDateMatch[1]),
      Number(isoDateMatch[2]) - 1,
      Number(isoDateMatch[3])
    );
  }

  if (!textValue) {
    return null;
  }

  const parsedDate = new Date(textValue);

  if (isNaN(parsedDate.getTime())) {
    return null;
  }

  return copyDate_(parsedDate);
}

function dateFromExcelSerial_(excelSerial) {
  const excelEpoch = new Date(1899, 11, 30);

  excelEpoch.setDate(
    excelEpoch.getDate() + Math.floor(excelSerial)
  );

  return copyDate_(excelEpoch);
}

function yearFromDate_(date) {
  return date ? date.getFullYear() : 0;
}

function monthFromDate_(date) {
  return date ? date.getMonth() + 1 : 0;
}

function latestDate_(currentDate, candidateDate) {
  if (!currentDate || candidateDate > currentDate) {
    return candidateDate;
  }

  return currentDate;
}

function numberOrZero_(value) {
  const normalizedValue =
    typeof value === 'string'
      ? value.replace(/[₱,%\s,]/g, '')
      : value;
  const parsedNumber = Number(normalizedValue);

  return isFinite(parsedNumber) ? parsedNumber : 0;
}

function nonNegativeNumber_(value) {
  return Math.max(0, numberOrZero_(value));
}

function nullableNonNegativeNumber_(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const parsedNumber = numberOrZero_(value);

  return parsedNumber >= 0 ? parsedNumber : null;
}

function positiveInteger_(value) {
  const parsedInteger = Math.floor(
    numberOrZero_(value)
  );

  return parsedInteger > 0 ? parsedInteger : 0;
}

function divideOrDefault_(numerator, denominator, fallback) {
  if (denominator > 0) {
    return numerator / denominator;
  }

  return fallback;
}

function percentageOrNull_(numerator, denominator) {
  if (denominator > 0) {
    return (numerator / denominator) * 100;
  }

  return null;
}

function maxNullable_(firstValue, secondValue) {
  if (firstValue === null) {
    return secondValue;
  }

  if (secondValue === null) {
    return firstValue;
  }

  return Math.max(firstValue, secondValue);
}

function round2_(value) {
  const safeNumber = numberOrZero_(value);

  return (
    Math.round(
      (safeNumber + Number.EPSILON) * 100
    ) / 100
  );
}

function nullableRound2_(value) {
  if (value === null || !isFinite(value)) {
    return null;
  }

  return round2_(value);
}

function formatDate_(date, timezone) {
  return Utilities.formatDate(
    date,
    timezone,
    'yyyy-MM-dd'
  );
}

function pad2_(value) {
  return String(value).padStart(2, '0');
}

function regionSort_(firstRegion, secondRegion) {
  if (firstRegion === 'NIR') {
    return -1;
  }

  if (secondRegion === 'NIR') {
    return 1;
  }

  const firstRegionNumber = extractRegionNumber_(
    firstRegion
  );
  const secondRegionNumber = extractRegionNumber_(
    secondRegion
  );

  if (firstRegionNumber !== secondRegionNumber) {
    return firstRegionNumber - secondRegionNumber;
  }

  return firstRegion.localeCompare(secondRegion);
}

function extractRegionNumber_(region) {
  const numberMatch = region.match(/\d+/);

  return numberMatch ? Number(numberMatch[0]) : 999;
}
