/**
 * Shared normalized-source cache backed by Apps Script CacheService.
 */

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
