/**
 * Coordinates all read-only spreadsheet repositories.
 */

/**
 * Reads and normalizes spreadsheet data.
 *
 * This file uses read methods only. It never writes to the spreadsheet.
 */

function readDashboardSources_(spreadsheet) {
  /*
   * Read each reusable source once during a cold cache build. The current
   * SLSAch% pivots are sourced directly from CATEGORY OF SALES V2, so the
   * normalized sales rows also carry the company, region, and branch target
   * contribution fields used by those pivots.
   */
  return {
    sales: readSalesSource_(spreadsheet),
    expenses: readExpenseSource_(spreadsheet),
    customers: readCustomerSource_(spreadsheet)
  };
}
