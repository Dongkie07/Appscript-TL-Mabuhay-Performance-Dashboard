/**
 * Filtered response cache and cache-key index management.
 */

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
