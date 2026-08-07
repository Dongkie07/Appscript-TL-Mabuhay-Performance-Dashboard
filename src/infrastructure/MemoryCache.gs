/**
 * Execution-local memory cache for repeated work inside one server runtime.
 */

function dashboardMemoryTtlMs_(seconds) {
  return Math.max(1, Number(seconds) || 1) * 1000;
}

function readDashboardMemorySource_(cacheKey) {
  const saved = DASHBOARD_MEMORY_SOURCE_CACHE_;

  if (
    !saved ||
    saved.cacheKey !== cacheKey ||
    Date.now() - saved.savedAtMs >=
      dashboardMemoryTtlMs_(DASHBOARD_CONFIG.SOURCE_CACHE_SECONDS)
  ) {
    return null;
  }

  return {
    sources: saved.sources,
    cacheStatus: 'HIT',
    cachedAt: new Date(saved.cachedAtMs)
  };
}

function writeDashboardMemorySource_(cacheKey, sourceResult) {
  if (!sourceResult || !sourceResult.sources) return;

  const cachedAt = sourceResult.cachedAt instanceof Date
    ? sourceResult.cachedAt
    : new Date(sourceResult.cachedAt || Date.now());

  DASHBOARD_MEMORY_SOURCE_CACHE_ = {
    cacheKey: cacheKey,
    sources: sourceResult.sources,
    cachedAtMs: cachedAt.getTime(),
    savedAtMs: Date.now()
  };
}

function clearDashboardMemoryCaches_() {
  DASHBOARD_MEMORY_SOURCE_CACHE_ = null;
  DASHBOARD_MEMORY_RESULT_CACHE_ = Object.create(null);
  DASHBOARD_MEMORY_RESULT_ORDER_ = [];
}

function readDashboardMemoryResult_(baseKey) {
  const saved = DASHBOARD_MEMORY_RESULT_CACHE_[baseKey];

  if (
    !saved ||
    Date.now() - saved.savedAtMs >=
      dashboardMemoryTtlMs_(DASHBOARD_CONFIG.RESULT_CACHE_SECONDS)
  ) {
    if (saved) delete DASHBOARD_MEMORY_RESULT_CACHE_[baseKey];
    return null;
  }

  try {
    return JSON.parse(saved.serialized);
  } catch (error) {
    delete DASHBOARD_MEMORY_RESULT_CACHE_[baseKey];
    return null;
  }
}

function writeDashboardMemoryResult_(baseKey, serialized) {
  DASHBOARD_MEMORY_RESULT_CACHE_[baseKey] = {
    serialized: serialized,
    savedAtMs: Date.now()
  };
  DASHBOARD_MEMORY_RESULT_ORDER_ =
    DASHBOARD_MEMORY_RESULT_ORDER_.filter(function keepOtherKey(key) {
      return key !== baseKey;
    });
  DASHBOARD_MEMORY_RESULT_ORDER_.push(baseKey);

  const maximumEntries = 12;

  while (DASHBOARD_MEMORY_RESULT_ORDER_.length > maximumEntries) {
    const oldestKey = DASHBOARD_MEMORY_RESULT_ORDER_.shift();
    delete DASHBOARD_MEMORY_RESULT_CACHE_[oldestKey];
  }
}
