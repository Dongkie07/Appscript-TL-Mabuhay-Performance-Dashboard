/**
 * Reusable trend and top-series helpers.
 */

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
  const sunday = copyDate_(date);
  const daysSinceSunday = sunday.getDay();

  sunday.setDate(
    sunday.getDate() - daysSinceSunday
  );

  return {
    key: Utilities.formatDate(
      sunday,
      timezone,
      'yyyy-MM-dd'
    ),
    label: Utilities.formatDate(
      sunday,
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
