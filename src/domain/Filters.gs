/**
 * Date, region, and branch filter normalization.
 */

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
