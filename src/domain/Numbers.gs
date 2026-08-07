/**
 * Numeric coercion, percentages, and rounding helpers.
 */

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
