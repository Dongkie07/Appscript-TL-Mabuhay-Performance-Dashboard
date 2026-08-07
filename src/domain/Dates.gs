/**
 * Date parsing and formatting helpers.
 */

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
