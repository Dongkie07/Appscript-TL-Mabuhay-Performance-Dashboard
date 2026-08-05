
/**
 * Opportunistic in-memory L1 caches.
 *
 * Apps Script may reuse a warm V8 instance for several executions. These
 * objects are never treated as authoritative; they only avoid repeatedly
 * reading and JSON-parsing the same CacheService chunks when the instance is
 * reused or when one server request asks for the same sources more than once.
 */
var DASHBOARD_MEMORY_SOURCE_CACHE_ = null;
var DASHBOARD_MEMORY_RESULT_CACHE_ = Object.create(null);
var DASHBOARD_MEMORY_RESULT_ORDER_ = [];

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

/**
 * Chunked read-only source cache.
 *
 * Filters reuse normalized source rows from this cache. Only the manual
 * Refresh button bypasses it and reads the Sheet again.
 */

function getDashboardSourcesCached_(spreadsheet, forceRefresh) {
  const cache = getDashboardCache_();
  const cacheKey = createDashboardSourceCacheKey_(spreadsheet);

  if (forceRefresh) {
    clearDashboardMemoryCaches_();

    try {
      clearDashboardResultCaches_(spreadsheet);
    } catch (cacheError) {
      console.warn(
        'Dashboard result cache clear failed: ' + cacheError
      );
    }
  } else {
    const memoryResult = readDashboardMemorySource_(cacheKey);
    if (memoryResult) return memoryResult;

    const cachedResult = readDashboardSourceCache_(cache, cacheKey);

    if (cachedResult) {
      writeDashboardMemorySource_(cacheKey, cachedResult);
      return cachedResult;
    }
  }

  const lock = LockService.getScriptLock();
  const lockWaitMs = Math.max(
    1000,
    Math.min(
      DASHBOARD_CONFIG.CACHE_LOCK_TIMEOUT_MS || 12000,
      30000
    )
  );
  const hasLock = lock.tryLock(lockWaitMs);

  try {
    /*
     * Another execution may have populated the shared cache while this
     * execution was waiting. Re-check before touching Sheets.
     */
    if (!forceRefresh) {
      const memoryAfterLock = readDashboardMemorySource_(cacheKey);
      if (memoryAfterLock) return memoryAfterLock;

      const cachedAfterLock = readDashboardSourceCache_(cache, cacheKey);

      if (cachedAfterLock) {
        writeDashboardMemorySource_(cacheKey, cachedAfterLock);
        return cachedAfterLock;
      }
    }

    /*
     * If the lock could not be acquired, briefly give the cache-building
     * execution a chance to finish. This avoids a cold-cache stampede where
     * several viewers all read the workbook at the same time.
     */
    if (!hasLock && !forceRefresh) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        Utilities.sleep(250);
        const sharedResult = readDashboardSourceCache_(cache, cacheKey);

        if (sharedResult) {
          writeDashboardMemorySource_(cacheKey, sharedResult);
          return sharedResult;
        }
      }
    }

    const sources = readDashboardSources_(spreadsheet);
    const cachedAt = new Date();
    let cacheStatus = forceRefresh ? 'REFRESHED' : 'MISS';

    try {
      writeDashboardSourceCache_(
        cache,
        cacheKey,
        sources,
        cachedAt
      );
    } catch (cacheError) {
      console.warn('Dashboard source cache write failed: ' + cacheError);
      cacheStatus = 'BYPASSED';
    }

    const result = {
      sources: sources,
      cacheStatus: cacheStatus,
      cachedAt: cachedAt
    };

    writeDashboardMemorySource_(cacheKey, result);
    return result;
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function getDashboardCache_() {
  return CacheService.getDocumentCache() ||
    CacheService.getScriptCache();
}

function createDashboardSourceCacheKey_(spreadsheet) {
  return [
    'TL_DASH_SOURCE',
    DASHBOARD_CONFIG.SOURCE_CACHE_VERSION,
    spreadsheet.getId()
  ].join('_').replace(/[^A-Za-z0-9_\-]/g, '_');
}

function readDashboardSourceCache_(cache, baseKey) {
  const manifestText = cache.get(baseKey + '_manifest');
  if (!manifestText) return null;

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    clearDashboardCacheKeys_(cache, baseKey, 0);
    return null;
  }

  if (
    !manifest ||
    manifest.version !== DASHBOARD_CONFIG.SOURCE_CACHE_VERSION ||
    !manifest.chunkCount
  ) {
    return null;
  }

  const keys = [];
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    keys.push(baseKey + '_chunk_' + index);
  }

  const chunks = cache.getAll(keys);
  let serialized = '';

  for (let index = 0; index < keys.length; index += 1) {
    if (!chunks[keys[index]]) return null;
    serialized += chunks[keys[index]];
  }

  try {
    return {
      sources: deserializeDashboardSources_(serialized),
      cacheStatus: 'HIT',
      cachedAt: new Date(manifest.cachedAt)
    };
  } catch (error) {
    clearDashboardCacheKeys_(cache, baseKey, manifest.chunkCount);
    return null;
  }
}

function writeDashboardSourceCache_(
  cache,
  baseKey,
  sources,
  cachedAt
) {
  const serialized = serializeDashboardSources_(sources);
  const chunkSize = DASHBOARD_CONFIG.CACHE_CHUNK_CHARACTERS;
  const chunks = [];

  for (let offset = 0; offset < serialized.length; offset += chunkSize) {
    chunks.push(serialized.slice(offset, offset + chunkSize));
  }

  const ttl = DASHBOARD_CONFIG.SOURCE_CACHE_SECONDS;
  const batchSize = DASHBOARD_CONFIG.CACHE_WRITE_BATCH_SIZE || 20;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = {};
    const end = Math.min(start + batchSize, chunks.length);

    for (let index = start; index < end; index += 1) {
      batch[baseKey + '_chunk_' + index] = chunks[index];
    }

    cache.putAll(batch, ttl);
  }

  cache.put(
    baseKey + '_manifest',
    JSON.stringify({
      version: DASHBOARD_CONFIG.SOURCE_CACHE_VERSION,
      chunkCount: chunks.length,
      cachedAt: cachedAt.toISOString()
    }),
    ttl
  );
}

function serializeDashboardSources_(sources) {
  return JSON.stringify(sources, function dateReplacer(key, value) {
    if (this[key] instanceof Date) {
      return { __dashboardDate: this[key].toISOString() };
    }
    return value;
  });
}

function deserializeDashboardSources_(serialized) {
  return JSON.parse(serialized, function dateReviver(key, value) {
    if (value && value.__dashboardDate) {
      return new Date(value.__dashboardDate);
    }
    return value;
  });
}

function clearDashboardSourceCache_(spreadsheet) {
  const cache = getDashboardCache_();
  clearDashboardMemoryCaches_();

  try {
    clearDashboardResultCaches_(spreadsheet);
  } catch (cacheError) {
    console.warn(
      'Dashboard result cache clear failed: ' + cacheError
    );
  }
  const baseKey = createDashboardSourceCacheKey_(spreadsheet);
  const manifestText = cache.get(baseKey + '_manifest');
  let chunkCount = 0;

  if (manifestText) {
    try {
      chunkCount = JSON.parse(manifestText).chunkCount || 0;
    } catch (error) {
      chunkCount = 0;
    }
  }

  clearDashboardCacheKeys_(cache, baseKey, chunkCount);
}

function clearDashboardCacheKeys_(cache, baseKey, chunkCount) {
  const keys = [baseKey + '_manifest'];
  for (let index = 0; index < chunkCount; index += 1) {
    keys.push(baseKey + '_chunk_' + index);
  }
  cache.removeAll(keys);
}

/**
 * Filtered response cache.
 *
 * A completed Overview or TDC/PDC response is cached using the selected
 * filters plus the current source-cache timestamp. This means repeated filter
 * combinations can return without recalculating every normalized source row.
 * A manual Refresh creates a new source timestamp and clears the indexed
 * filtered responses.
 */

function readDashboardResultCache_(
  spreadsheet,
  sourceResult,
  filters,
  resultType
) {
  const cache = getDashboardCache_();
  const baseKey = createDashboardResultCacheKey_(
    spreadsheet,
    sourceResult,
    filters,
    resultType
  );
  const memoryResult = readDashboardMemoryResult_(baseKey);

  if (memoryResult) {
    return memoryResult;
  }

  const manifestText = cache.get(baseKey + '_manifest');

  if (!manifestText) {
    return null;
  }

  let manifest;

  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    clearDashboardCacheKeys_(cache, baseKey, 0);
    return null;
  }

  if (
    !manifest ||
    manifest.version !== DASHBOARD_CONFIG.RESULT_CACHE_VERSION ||
    !manifest.chunkCount
  ) {
    return null;
  }

  const keys = [];

  for (let index = 0; index < manifest.chunkCount; index += 1) {
    keys.push(baseKey + '_chunk_' + index);
  }

  const chunks = cache.getAll(keys);
  let serialized = '';

  for (let index = 0; index < keys.length; index += 1) {
    if (!chunks[keys[index]]) {
      return null;
    }

    serialized += chunks[keys[index]];
  }

  try {
    const parsed = JSON.parse(serialized);
    writeDashboardMemoryResult_(baseKey, serialized);
    return parsed;
  } catch (error) {
    clearDashboardCacheKeys_(
      cache,
      baseKey,
      manifest.chunkCount
    );
    return null;
  }
}

function writeDashboardResultCache_(
  spreadsheet,
  sourceResult,
  filters,
  resultType,
  response
) {
  const cache = getDashboardCache_();
  const baseKey = createDashboardResultCacheKey_(
    spreadsheet,
    sourceResult,
    filters,
    resultType
  );
  const serialized = JSON.stringify(response);
  writeDashboardMemoryResult_(baseKey, serialized);
  const chunkSize = DASHBOARD_CONFIG.CACHE_CHUNK_CHARACTERS;
  const chunks = [];

  for (
    let offset = 0;
    offset < serialized.length;
    offset += chunkSize
  ) {
    chunks.push(serialized.slice(offset, offset + chunkSize));
  }

  const ttl =
    DASHBOARD_CONFIG.RESULT_CACHE_SECONDS ||
    DASHBOARD_CONFIG.SOURCE_CACHE_SECONDS;
  const batchSize =
    DASHBOARD_CONFIG.CACHE_WRITE_BATCH_SIZE || 20;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = {};
    const end = Math.min(start + batchSize, chunks.length);

    for (let index = start; index < end; index += 1) {
      batch[baseKey + '_chunk_' + index] = chunks[index];
    }

    cache.putAll(batch, ttl);
  }

  cache.put(
    baseKey + '_manifest',
    JSON.stringify({
      version: DASHBOARD_CONFIG.RESULT_CACHE_VERSION,
      chunkCount: chunks.length
    }),
    ttl
  );

  registerDashboardResultCacheKey_(
    cache,
    spreadsheet,
    baseKey,
    chunks.length,
    ttl
  );
}

function createDashboardResultCacheKey_(
  spreadsheet,
  sourceResult,
  filters,
  resultType
) {
  const sourceTimestamp = sourceResult.cachedAt instanceof Date
    ? sourceResult.cachedAt.toISOString()
    : String(sourceResult.cachedAt || '');
  const keyMaterial = [
    DASHBOARD_CONFIG.RESULT_CACHE_VERSION,
    spreadsheet.getId(),
    sourceTimestamp,
    resultType,
    filters.startDate ? filters.startDate.getTime() : '',
    filters.endDate ? filters.endDate.getTime() : '',
    filters.region || 'ALL',
    filters.branch || 'ALL'
  ].join('|');

  return 'TL_DASH_RESULT_' + dashboardCacheDigest_(keyMaterial);
}

function dashboardCacheDigest_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  let digest = '';

  for (let index = 0; index < 16; index += 1) {
    const unsignedByte = (bytes[index] + 256) % 256;
    digest += ('0' + unsignedByte.toString(16)).slice(-2);
  }

  return digest;
}

function createDashboardResultIndexKey_(spreadsheet) {
  return (
    'TL_DASH_RESULT_INDEX_' +
    dashboardCacheDigest_(
      DASHBOARD_CONFIG.RESULT_CACHE_VERSION +
      '|' +
      spreadsheet.getId()
    )
  );
}

function registerDashboardResultCacheKey_(
  cache,
  spreadsheet,
  baseKey,
  chunkCount,
  ttl
) {
  const indexKey = createDashboardResultIndexKey_(spreadsheet);
  const savedIndex = cache.get(indexKey);
  let entries = [];

  if (savedIndex) {
    try {
      entries = JSON.parse(savedIndex);
    } catch (error) {
      entries = [];
    }
  }

  entries = entries.filter(function keepOtherEntry(entry) {
    return entry && entry.baseKey !== baseKey;
  });
  entries.push({
    baseKey: baseKey,
    chunkCount: chunkCount
  });

  if (entries.length > 80) {
    entries = entries.slice(entries.length - 80);
  }

  cache.put(indexKey, JSON.stringify(entries), ttl);
}

function clearDashboardResultCaches_(spreadsheet) {
  DASHBOARD_MEMORY_RESULT_CACHE_ = Object.create(null);
  DASHBOARD_MEMORY_RESULT_ORDER_ = [];

  const cache = getDashboardCache_();
  const indexKey = createDashboardResultIndexKey_(spreadsheet);
  const savedIndex = cache.get(indexKey);

  if (!savedIndex) {
    return;
  }

  let entries;

  try {
    entries = JSON.parse(savedIndex);
  } catch (error) {
    cache.remove(indexKey);
    return;
  }

  const keys = [indexKey];

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];

    if (!entry || !entry.baseKey) {
      continue;
    }

    keys.push(entry.baseKey + '_manifest');

    for (
      let chunkIndex = 0;
      chunkIndex < (entry.chunkCount || 0);
      chunkIndex += 1
    ) {
      keys.push(entry.baseKey + '_chunk_' + chunkIndex);
    }
  }

  const removeBatchSize = 80;

  for (
    let start = 0;
    start < keys.length;
    start += removeBatchSize
  ) {
    cache.removeAll(
      keys.slice(start, start + removeBatchSize)
    );
  }
}

