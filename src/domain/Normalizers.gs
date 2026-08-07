/**
 * Text, branch, service, customer, and region normalization.
 */

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
