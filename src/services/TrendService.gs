/**
 * Daily, Sunday-week, monthly, and yearly trend grouping.
 */

function executiveGetAllTrendBuckets_(date, timezone, cache) {
  const cacheKey = String(date.getTime());

  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const buckets = {
    DAY: executiveCreateTrendBucket_(date, 'DAY', timezone),
    WEEK: executiveCreateTrendBucket_(date, 'WEEK', timezone),
    MONTH: executiveCreateTrendBucket_(date, 'MONTH', timezone),
    YEAR: executiveCreateTrendBucket_(date, 'YEAR', timezone)
  };

  cache[cacheKey] = buckets;
  return buckets;
}

function executiveAddTrendBucket_(
  trendMap,
  bucket,
  amount,
  transactions
) {
  if (!trendMap[bucket.key]) {
    trendMap[bucket.key] = {
      key: bucket.key,
      label: bucket.label,
      sales: 0,
      transactions: 0
    };
  }

  trendMap[bucket.key].sales += amount;
  trendMap[bucket.key].transactions += transactions;
}

function executiveAddTrendPoint_(
  trendMap,
  date,
  amount,
  transactions,
  trendMode,
  timezone
) {
  const bucket = executiveCreateTrendBucket_(
    date,
    trendMode,
    timezone
  );

  executiveAddTrendBucket_(
    trendMap,
    bucket,
    amount,
    transactions
  );
}

function executiveCreateTrendBucket_(date, trendMode, timezone) {
  if (trendMode === 'YEAR') {
    return {
      key: Utilities.formatDate(date, timezone, 'yyyy'),
      label: Utilities.formatDate(date, timezone, 'yyyy')
    };
  }

  if (trendMode === 'MONTH') {
    return {
      key: Utilities.formatDate(date, timezone, 'yyyy-MM'),
      label: Utilities.formatDate(date, timezone, 'MMM yyyy')
    };
  }

  if (trendMode === 'WEEK') {
    const weekStart = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    // DlySLSTrd uses Sunday through Saturday reporting weeks.
    const daysFromSunday = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - daysFromSunday);

    return {
      key: Utilities.formatDate(weekStart, timezone, 'yyyy-MM-dd'),
      label:
        'Week of ' + Utilities.formatDate(weekStart, timezone, 'MMM d')
    };
  }

  return {
    key: Utilities.formatDate(date, timezone, 'yyyy-MM-dd'),
    label: Utilities.formatDate(date, timezone, 'MMM d')
  };
}

function executiveResolveTrendMode_(requestedMode, startDate, endDate) {
  const normalized = cleanText_(requestedMode).toUpperCase();

  if (
    normalized === 'DAY' ||
    normalized === 'WEEK' ||
    normalized === 'MONTH' ||
    normalized === 'YEAR'
  ) {
    return normalized;
  }

  const days = Math.max(
    1,
    Math.round((endDate - startDate) / 86400000) + 1
  );

  if (days <= 45) {
    return 'DAY';
  }

  if (days <= 180) {
    return 'WEEK';
  }

  if (days <= 1095) {
    return 'MONTH';
  }

  return 'YEAR';
}

function executiveBuildTrendSeries_(trendMap) {
  const keys = Object.keys(trendMap).sort();
  const series = [];

  for (let index = 0; index < keys.length; index += 1) {
    const point = trendMap[keys[index]];

    series.push({
      key: point.key,
      label: point.label,
      sales: round2_(point.sales),
      transactions: round2_(point.transactions)
    });
  }

  return series;
}
