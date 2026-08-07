
  (() => {
    "use strict";

    const executiveState = {
      trendMode: "AUTO",
      requestVersion: 0,
      refreshTimer: null,
      observer: null,
      monthlyActive: false,
      trendsActive: false,
      latestSupport: null,
      monthlyCache: Object.create(null),
      monthlyRequestVersion: 0,
      monthlyLoadingKey: "",
      supportLoading: false,
      loadedFilterKey: "",
      inFlightFilterKey: "",
      renderingSupport: false,
      idleHandle: null,
    };
    
    window.executiveState = executiveState;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeExecutiveSales);
    } else {
      initializeExecutiveSales();
    }

    function initializeExecutiveSales() {
      removeRegionalScorecard();
      relabelExecutiveKpis();
      addExecutiveDatePresets();
      replaceOverviewTrendCard();
      addMonthlySalesView();
      addSalesTrendsView();
      
      const refreshButton = document.getElementById("refreshButton");
      if (refreshButton) {
        refreshButton.addEventListener("click", () => {
          executiveState.monthlyCache = Object.create(null);
          executiveState.monthlyLoadingKey = "";
          executiveState.monthlyRequestVersion += 1;
          executiveState.loadedFilterKey = "";
          executiveState.inFlightFilterKey = "";
        });
      }
    }
    function removeRegionalScorecard() {
      const regionalTab = document.getElementById("regionalTab");
      const regionalView = document.getElementById("regionalScorecardView");

      if (regionalTab) regionalTab.remove();
      if (regionalView) regionalView.remove();
    }
    function relabelExecutiveKpis() {
      const salesCard = document.getElementById("kpiSales")?.closest(".kpi");
      const targetCard = document.getElementById("kpiTarget")?.closest(".kpi");
      const salesLabel = salesCard?.querySelector(".kpi-label");
      const targetLabel = targetCard?.querySelector(".kpi-label");
      const trendPanel = document.getElementById("salesTrendChart")?.closest(".panel");
      const trendSubtitle = trendPanel?.querySelector(".panel-subtitle");

      if (salesLabel) salesLabel.textContent = "Gross sales";
      if (targetLabel) targetLabel.textContent = "Target achievement";
      if (trendSubtitle) {
        trendSubtitle.textContent =
          "All collection entries encoded within the selected date range";
      }
    }
    function addExecutiveDatePresets() {
      const presets = document.querySelector(".presets");

      if (!presets || document.getElementById("executiveThisMonth")) return;

      const firstExistingButton = presets.querySelector("button");
      const buttons = [
        createDatePresetButton("executiveThisMonth", "This month", "THIS_MONTH"),
        createDatePresetButton("executiveLastMonth", "Last month", "LAST_MONTH"),
        createDatePresetButton("executiveThisYear", "This year", "THIS_YEAR"),
      ];

      buttons.forEach((button) => {
        presets.insertBefore(button, firstExistingButton);
      });
    }
    function createDatePresetButton(id, label, preset) {
      const button = document.createElement("button");
      button.id = id;
      button.className = "preset";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => applyExecutiveDatePreset(preset));
      return button;
    }
    function applyExecutiveDatePreset(preset) {
      const startInput = document.getElementById("startDate");
      const endInput = document.getElementById("endDate");

      if (!startInput || !endInput || !endInput.max) return;

      const availableMinimum = parseIsoDate(startInput.min || endInput.max);
      const availableMaximum = parseIsoDate(endInput.max);
      let selectedStart = new Date(availableMaximum);
      let selectedEnd = new Date(availableMaximum);

      if (preset === "THIS_MONTH") {
        selectedStart = new Date(
          availableMaximum.getFullYear(),
          availableMaximum.getMonth(),
          1,
        );
        executiveState.trendMode = "DAY";
      } else if (preset === "LAST_MONTH") {
        selectedStart = new Date(
          availableMaximum.getFullYear(),
          availableMaximum.getMonth() - 1,
          1,
        );
        selectedEnd = new Date(
          availableMaximum.getFullYear(),
          availableMaximum.getMonth(),
          0,
        );
        executiveState.trendMode = "DAY";
      } else {
        selectedStart = new Date(availableMaximum.getFullYear(), 0, 1);
        executiveState.trendMode = "MONTH";
      }

      if (selectedStart < availableMinimum) selectedStart = availableMinimum;
      if (selectedEnd > availableMaximum) selectedEnd = availableMaximum;
      if (selectedEnd < availableMinimum) selectedEnd = availableMinimum;

      startInput.value = toIsoDate(selectedStart);
      endInput.value = toIsoDate(selectedEnd);
      updateTrendButtonState(executiveState.trendMode);
      document.getElementById("applyButton")?.click();
    }
    function replaceOverviewTrendCard() {
      const host = document.getElementById("salesTrendChart");
      const panel = host?.closest(".panel");

      if (
        !host ||
        !panel ||
        document.getElementById("executiveOverviewSalesMomentum")
      ) {
        return;
      }

      const title = panel.querySelector(".panel-title, h2, h3");
      const subtitle = panel.querySelector(".panel-subtitle");
      const tag = document.getElementById("trendBucket");

      if (title) title.textContent = "Sales momentum";
      if (subtitle) {
        subtitle.textContent =
          "Encoded sales amount over the selected date range";
      }
      if (tag) tag.textContent = "Auto view";

      host.id = "executiveOverviewSalesMomentum";
      host.classList.add("executive-overview-momentum");
      host.innerHTML =
        '<div class="empty-chart">Preparing sales for the selected range…</div>';
    }

    function getExecutiveFilterKey(filters) {
      const safeFilters = filters || {};

      if (!safeFilters.startDate || !safeFilters.endDate) return "";

      return [
        safeFilters.startDate,
        safeFilters.endDate,
        safeFilters.region || "ALL",
        safeFilters.branch || "ALL",
      ].join("|");
    }
    function renderExecutiveSupport(supportData) {
      if (!supportData) return;

      executiveState.renderingSupport = true;
      executiveState.latestSupport = supportData;
      executiveState.loadedFilterKey = getExecutiveFilterKey(
        supportData.filtersApplied || readExecutiveFilters(),
      );
      primeMonthlyCacheFromSupport(supportData);
      const reconciliation = supportData.reconciliation || {};
      const kpis = supportData.kpis || {};
      const branchCount = Number(supportData.branchAchievementCount) || 0;
      const targetSub = document.getElementById("kpiTargetSub");
      const salesSub = document.getElementById("kpiSalesSub");
      const cacheNote = document.getElementById("executiveTrendCacheNote");

      setText(
        "kpiSales",
        formatCurrency(reconciliation.encodedCollections ?? kpis.encodedCollections),
      );
      setText(
        "kpiTarget",
        kpis.targetAchievement == null
          ? "—"
          : formatPercentPrecise(kpis.targetAchievement),
      );
      setText("executiveNonAmount", formatCurrency(reconciliation.nonSalesReceipts));
      setText("executiveReprintAmount", formatCurrency(reconciliation.reprints));
      setText("executiveEncodedAmount", formatCurrency(reconciliation.encodedCollections));

      if (salesSub) {
        const encodedRows =
          Number(reconciliation.encodedRows) ||
          (Number(reconciliation.includedRows) || 0) +
            (Number(reconciliation.excludedRows) || 0);
        salesSub.textContent =
          `${formatNumber(encodedRows)} matched sales rows`;
      }

      if (targetSub) {
        targetSub.textContent =
          `Average of ${formatNumber(branchCount)} branch achievement rows`;
      }

      if (cacheNote) {
        cacheNote.textContent =
          supportData.cacheStatus === "HIT" ||
          supportData.cacheStatus === "MEMORY"
            ? "All trend views ready · cached"
            : "All trend views loaded together";
      }

      if (
        executiveState.trendMode === "AUTO" ||
        !supportData.trends?.[executiveState.trendMode]
      ) {
        executiveState.trendMode =
          supportData.trendMode || inferBestTrendMode();
      }

      renderOverviewSalesMomentum(supportData);
      renderSelectedExecutiveTrend();

      if (executiveState.monthlyActive) {
        const monthlySupport = getCachedSelectedMonthSupport();

        if (monthlySupport) {
          renderMonthlySales(monthlySupport);
        } else {
          showMonthlyLoading("Loading the selected month…");
          loadSelectedMonthSupport(false);
const salesCard = document.getElementById("kpiSales")?.closest(".kpi");
      const targetCard = document.getElementById("kpiTarget")?.closest(".kpi");
      const salesLabel = salesCard?.querySelector(".kpi-label");
      const targetLabel = targetCard?.querySelector(".kpi-label");
      const trendPanel = document.getElementById("salesTrendChart")?.closest(".panel");
      const trendSubtitle = trendPanel?.querySelector(".panel-subtitle");

      if (salesLabel) salesLabel.textContent = "Gross sales";
      if (targetLabel) targetLabel.textContent = "Target achievement";
      if (trendSubtitle) {
        trendSubtitle.textContent =
          "All collection entries encoded within the selected date range";
      }
    }
    function addExecutiveDatePresets() {
      const presets = document.querySelector(".presets");

      if (!presets || document.getElementById("executiveThisMonth")) return;

      const firstExistingButton = presets.querySelector("button");
      const buttons = [
        createDatePresetButton("executiveThisMonth", "This month", "THIS_MONTH"),
        createDatePresetButton("executiveLastMonth", "Last month", "LAST_MONTH"),
        createDatePresetButton("executiveThisYear", "This year", "THIS_YEAR"),
      ];

      buttons.forEach((button) => {
        presets.insertBefore(button, firstExistingButton);
      });
    }
    function createDatePresetButton(id, label, preset) {
      const button = document.createElement("button");
      button.id = id;
      button.className = "preset";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => applyExecutiveDatePreset(preset));
      return button;
    }
    function applyExecutiveDatePreset(preset) {
      const startInput = document.getElementById("startDate");
      const endInput = document.getElementById("endDate");

      if (!startInput || !endInput || !endInput.max) return;

      const availableMinimum = parseIsoDate(startInput.min || endInput.max);
      const availableMaximum = parseIsoDate(endInput.max);
      let selectedStart = new Date(availableMaximum);
      let selectedEnd = new Date(availableMaximum);

      if (preset === "THIS_MONTH") {
        selectedStart = new Date(
          availableMaximum.getFullYear(),
          availableMaximum.getMonth(),
          1,
        );
        executiveState.trendMode = "DAY";
      } else if (preset === "LAST_MONTH") {
        selectedStart = new Date(
          availableMaximum.getFullYear(),
          availableMaximum.getMonth() - 1,
          1,
        );
        selectedEnd = new Date(
          availableMaximum.getFullYear(),
          availableMaximum.getMonth(),
          0,
        );
        executiveState.trendMode = "DAY";
      } else {
        selectedStart = new Date(availableMaximum.getFullYear(), 0, 1);
        executiveState.trendMode = "MONTH";
      }

      if (selectedStart < availableMinimum) selectedStart = availableMinimum;
      if (selectedEnd > availableMaximum) selectedEnd = availableMaximum;
      if (selectedEnd < availableMinimum) selectedEnd = availableMinimum;

      startInput.value = toIsoDate(selectedStart);
      endInput.value = toIsoDate(selectedEnd);
      updateTrendButtonState(executiveState.trendMode);
      document.getElementById("applyButton")?.click();
    }
    function replaceOverviewTrendCard() {
      const host = document.getElementById("salesTrendChart");
      const panel = host?.closest(".panel");

      if (
        !host ||
        !panel ||
        document.getElementById("executiveOverviewSalesMomentum")
      ) {
        return;
      }

      const title = panel.querySelector(".panel-title, h2, h3");
      const subtitle = panel.querySelector(".panel-subtitle");
      const tag = document.getElementById("trendBucket");

      if (title) title.textContent = "Sales momentum";
      if (subtitle) {
        subtitle.textContent =
          "Encoded sales amount over the selected date range";
      }
      if (tag) tag.textContent = "Auto view";

      host.id = "executiveOverviewSalesMomentum";
      host.classList.add("executive-overview-momentum");
      host.innerHTML =
        '<div class="empty-chart">Preparing sales for the selected range…</div>';
    }

    function getExecutiveFilterKey(filters) {
      const safeFilters = filters || {};

      if (!safeFilters.startDate || !safeFilters.endDate) return "";

      return [
        safeFilters.startDate,
        safeFilters.endDate,
        safeFilters.region || "ALL",
        safeFilters.branch || "ALL",
      ].join("|");
    }
    function renderExecutiveSupport(supportData) {
      if (!supportData) return;

      executiveState.renderingSupport = true;
      executiveState.latestSupport = supportData;
      executiveState.loadedFilterKey = getExecutiveFilterKey(
        supportData.filtersApplied || readExecutiveFilters(),
      );
      primeMonthlyCacheFromSupport(supportData);
      const reconciliation = supportData.reconciliation || {};
      const kpis = supportData.kpis || {};
      const branchCount = Number(supportData.branchAchievementCount) || 0;
      const targetSub = document.getElementById("kpiTargetSub");
      const salesSub = document.getElementById("kpiSalesSub");
      const cacheNote = document.getElementById("executiveTrendCacheNote");

      setText(
        "kpiSales",
        formatCurrency(reconciliation.encodedCollections ?? kpis.encodedCollections),
      );
      setText(
        "kpiTarget",
        kpis.targetAchievement == null
          ? "—"
          : formatPercentPrecise(kpis.targetAchievement),
      );
      setText("executiveNonAmount", formatCurrency(reconciliation.nonSalesReceipts));
      setText("executiveReprintAmount", formatCurrency(reconciliation.reprints));
      setText("executiveEncodedAmount", formatCurrency(reconciliation.encodedCollections));

      if (salesSub) {
        const encodedRows =
          Number(reconciliation.encodedRows) ||
          (Number(reconciliation.includedRows) || 0) +
            (Number(reconciliation.excludedRows) || 0);
        salesSub.textContent =
          `${formatNumber(encodedRows)} matched sales rows`;
      }

      if (targetSub) {
        targetSub.textContent =
          `Average of ${formatNumber(branchCount)} branch achievement rows`;
      }

      if (cacheNote) {
        cacheNote.textContent =
          supportData.cacheStatus === "HIT" ||
          supportData.cacheStatus === "MEMORY"
            ? "All trend views ready · cached"
            : "All trend views loaded together";
      }

      if (
        executiveState.trendMode === "AUTO" ||
        !supportData.trends?.[executiveState.trendMode]
      ) {
        executiveState.trendMode =
          supportData.trendMode || inferBestTrendMode();
      }

      renderOverviewSalesMomentum(supportData);
      renderSelectedExecutiveTrend();

      if (executiveState.monthlyActive) {
        const monthlySupport = getCachedSelectedMonthSupport();

        if (monthlySupport) {
          renderMonthlySales(monthlySupport);
        } else {
          showMonthlyLoading("Loading the selected month…");
          loadSelectedMonthSupport(false);
        }
        document.getElementById("overviewView")?.classList.add("hidden");
        document.getElementById("slotUtilizationView")?.classList.add("hidden");
        document.getElementById("salesTrendsView")?.classList.add("hidden");
        document.getElementById("monthlySalesView")?.classList.remove("hidden");
      } else if (executiveState.trendsActive) {
        document.getElementById("overviewView")?.classList.add("hidden");
        document.getElementById("slotUtilizationView")?.classList.add("hidden");
        document.getElementById("monthlySalesView")?.classList.add("hidden");
        document.getElementById("salesTrendsView")?.classList.remove("hidden");
      }

      executiveState.renderingSupport = false;
    }

    window.renderExecutiveSupport = renderExecutiveSupport;
    window.showSalesTrendsView = showSalesTrendsView;

    function addSalesTrendsView() {
      const tabs = document.querySelector(".dashboard-view-tabs");
      const dashboard = document.getElementById("dashboard");

      if (!tabs || !dashboard || document.getElementById("salesTrendsTab")) {
        return;
      }

      const tab = document.createElement("button");
      tab.id = "salesTrendsTab";
      tab.className = "dashboard-view-tab";
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.setAttribute("aria-controls", "salesTrendsView");
      tab.textContent = "Sales Trends";
      tab.addEventListener("click", () => showSalesTrendsView(true));
      tabs.appendChild(tab);

      const view = document.createElement("main");
      view.id = "salesTrendsView";
      view.className = "hidden executive-trends-view";
      view.setAttribute("role", "tabpanel");
      view.setAttribute("aria-labelledby", "salesTrendsTab");
      view.innerHTML = `
        <section class="executive-trends-hero">
          <div>
            <div class="eyebrow">Executive trend analysis</div>
            <h2>Sales Trends</h2>
            <p>Matches the DlySLSTrd reporting basis. Change the date filters, then switch grouping instantly.</p>
          </div>
          <span class="executive-cache-note" id="executiveTrendCacheNote">Preparing all trend views…</span>
        </section>
        <section class="panel executive-trends-panel">
          <div class="panel-header">
            <div>
              <h3>Sales movement</h3>
              <p class="panel-subtitle">Daily, weekly, monthly and yearly series are loaded together.</p>
            </div>
            <div class="executive-trend-controls" id="executiveTrendControls"
              aria-label="Sales trend grouping">
              <button class="executive-trend-button" type="button"
                data-executive-trend-mode="DAY">Daily</button>
              <button class="executive-trend-button" type="button"
                data-executive-trend-mode="WEEK">Weekly</button>
              <button class="executive-trend-button" type="button"
                data-executive-trend-mode="MONTH">Monthly</button>
              <button class="executive-trend-button" type="button"
                data-executive-trend-mode="YEAR">Yearly</button>
            </div>
          </div>
          <div class="executive-trend-summary">
            <article><span>Total reported sales</span><strong id="trendSummaryTotal">—</strong></article>
            <article><span>Average per period</span><strong id="trendSummaryAverage">—</strong></article>
            <article><span>Peak period</span><strong id="trendSummaryPeak">—</strong></article>
            <article><span>Periods shown</span><strong id="trendSummaryCount">—</strong></article>
          </div>
          <div id="executiveSalesTrendChart" aria-live="polite">
            <div class="empty-chart">Loading trend data…</div>
          </div>
        </section>
      `;
      dashboard.appendChild(view);

      view
        .querySelectorAll("[data-executive-trend-mode]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            executiveState.trendMode = button.dataset.executiveTrendMode;
            renderSelectedExecutiveTrend();
          });
        });

      document
        .querySelectorAll(".dashboard-view-tab:not(#salesTrendsTab)")
        .forEach((button) => {
          button.addEventListener("click", () => {
            executiveState.trendsActive = false;
            document.getElementById("salesTrendsView")?.classList.add("hidden");
            document.getElementById("salesTrendsTab")?.classList.remove("active");
            document
              .getElementById("salesTrendsTab")
              ?.setAttribute("aria-selected", "false");
          });
        });

      updateTrendButtonState(executiveState.trendMode);
    }
    function showSalesTrendsView(activate) {
      const trendsView = document.getElementById("salesTrendsView");
      const trendsTab = document.getElementById("salesTrendsTab");

      if (!trendsView || !trendsTab) return;

      executiveState.trendsActive = activate !== false;
      executiveState.monthlyActive = false;
      document.getElementById("overviewView")?.classList.add("hidden");
      document.getElementById("slotUtilizationView")?.classList.add("hidden");
      document.getElementById("monthlySalesView")?.classList.add("hidden");
      trendsView.classList.remove("hidden");

      document.querySelectorAll(".dashboard-view-tab").forEach((button) => {
        const active = button.id === "salesTrendsTab";
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });

      if (
        !executiveState.latestSupport &&
        !executiveState.supportLoading &&
        !isBaseDashboardStillLoading()
      ) {
        scheduleExecutiveRefresh(0, true);
      }

      renderSelectedExecutiveTrend();
    }
    function renderOverviewSalesMomentum(supportData) {
      const host = document.getElementById("executiveOverviewSalesMomentum");

      if (!host) return;

      const trendMode = supportData?.trendMode || inferBestTrendMode();
      const points =
        supportData?.encodedTrends?.[trendMode] ||
        supportData?.encodedTrend ||
        [];
      const reconciliation = supportData?.reconciliation || {};
      const filters = supportData?.filtersApplied || {};
      const encodedCollections = Number(
        reconciliation.encodedCollections ??
          points.reduce(
            (sum, point) => sum + (Number(point.sales) || 0),
            0,
          ),
      );
      const encodedRows = Number(
        reconciliation.encodedRows ??
          (Number(reconciliation.includedRows) || 0) +
            (Number(reconciliation.excludedRows) || 0),
      );
      const groupingLabel = getTrendModeLabel(trendMode);
      const rangeLabel =
        filters.startDate && filters.endDate
          ? `${formatExecutiveDate(filters.startDate)} – ${formatExecutiveDate(filters.endDate)}`
          : "Selected date range";
      const tag = document.getElementById("trendBucket");

      if (tag) tag.textContent = `${groupingLabel} view`;

      if (!points.length) {
        host.innerHTML = `
          <div class="executive-overview-summary">
            <div class="executive-overview-total">
              <span>Total sales</span>
              <strong>${escapeHtml(formatCurrency(encodedCollections))}</strong>
            </div>
            <div class="executive-overview-meta">
              ${escapeHtml(formatNumber(encodedRows))} encoded rows<br>
              ${escapeHtml(rangeLabel)}
            </div>
          </div>
          <div class="empty-chart">No sales data for this selection.</div>
        `;
        return;
      }

      host.innerHTML = `
        <div class="executive-overview-summary">
          <div class="executive-overview-total">
            <span>Total sales</span>
            <strong>${escapeHtml(formatCurrency(encodedCollections))}</strong>
          </div>
          <div class="executive-overview-meta">
            ${escapeHtml(formatNumber(encodedRows))} matched rows · ${escapeHtml(groupingLabel)} grouping<br>
            ${escapeHtml(rangeLabel)}
          </div>
        </div>
        <div class="executive-overview-chart" id="executiveOverviewTrendChart"></div>
      `;

      renderExecutiveTrendChartInto(
        document.getElementById("executiveOverviewTrendChart"),
        points,
        `Sales for ${rangeLabel}`,
      );
    }
    function getTrendModeLabel(mode) {
      const labels = {
        DAY: "Daily",
        WEEK: "Weekly",
        MONTH: "Monthly",
        YEAR: "Yearly",
      };

      return labels[mode] || "Automatic";
    }
    function renderSelectedExecutiveTrend() {
      const supportData = executiveState.latestSupport;

      if (!supportData) return;

      const trends = supportData.trends || {};
      const fallbackMode = supportData.trendMode || inferBestTrendMode();

      if (!trends[executiveState.trendMode]) {
        executiveState.trendMode = fallbackMode;
      }

      const points =
        trends[executiveState.trendMode] || supportData.trend || [];

      updateTrendButtonState(executiveState.trendMode);
      renderTrendSummary(points);
      renderExecutiveTrendChart(points);
    }
    function renderTrendSummary(rawPoints) {
      const points = (rawPoints || []).map((point) => ({
        label: point.label || "—",
        sales: Number(point.sales) || 0,
      }));
      const total = points.reduce((sum, point) => sum + point.sales, 0);
      const average = points.length ? total / points.length : 0;
      const peak = points.length
        ? points.reduce(
            (winner, point) => (point.sales > winner.sales ? point : winner),
            points[0],
          )
        : null;

      setText("trendSummaryTotal", formatCurrency(total));
      setText("trendSummaryAverage", formatCurrency(average));
      setText(
        "trendSummaryPeak",
        peak ? `${peak.label} · ${formatCompactCurrency(peak.sales)}` : "—",
      );
      setText("trendSummaryCount", formatNumber(points.length));
    }
    function updateTrendButtonState(activeMode) {
      document
        .querySelectorAll("[data-executive-trend-mode]")
        .forEach((button) => {
          const active = button.dataset.executiveTrendMode === activeMode;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }
    function addReconciliationStrip() {
      const kpiGrid = document.querySelector(".kpi-grid");

      if (!kpiGrid || document.getElementById("executiveReconciliation")) return;

      const strip = document.createElement("section");
      strip.id = "executiveReconciliation";
      strip.className = "executive-reconciliation";
      strip.setAttribute("aria-label", "Sales reconciliation");
      strip.innerHTML = `
        <article class="executive-reconciliation-card rule">
          <span>Reporting rule</span>
          <strong>Sales Trends follows the DlySLSTrd reporting basis.</strong>
        </article>
        <article class="executive-reconciliation-card excluded">
          <span>Adjustments</span>
          <strong id="executiveNonAmount">—</strong>
        </article>
        <article class="executive-reconciliation-card excluded">
          <span>Reissued records</span>
          <strong id="executiveReprintAmount">—</strong>
        </article>
        <article class="executive-reconciliation-card">
          <span>Total encoded</span>
          <strong id="executiveEncodedAmount">—</strong>
        </article>
      `;

      kpiGrid.insertAdjacentElement("afterend", strip);
    }
    function inferBestTrendMode() {
      const start = document.getElementById("startDate")?.value;
      const end = document.getElementById("endDate")?.value;

      if (!start || !end) return "DAY";

      const dayCount =
        Math.floor((parseIsoDate(end) - parseIsoDate(start)) / 86400000) + 1;

      if (dayCount <= 62) return "DAY";
      if (dayCount <= 400) return "WEEK";
      if (dayCount <= 1460) return "MONTH";
      return "YEAR";
    }

    function renderExecutiveTrendChart(rawPoints) {
      renderExecutiveTrendChartInto(
        document.getElementById("executiveSalesTrendChart"),
        rawPoints,
        "Reported service sales trend",
      );
    }
    function renderExecutiveTrendChartInto(host, rawPoints, ariaLabel) {
      const points = (rawPoints || []).map((point) => ({
        key: point.key || "",
        label: point.label || "—",
        sales: Number(point.sales) || 0,
        transactions: Number(point.transactions) || 0,
      }));

      if (!host) return;

      if (!points.length) {
        host.innerHTML =
          '<div class="empty-chart">No reported service sales for this selection.</div>';
        return;
      }

      const gradientId = `${host.id || "executiveSalesTrend"}Area`;
      const width = 900;
      const height = 285;
      const pad = { top: 18, right: 24, bottom: 44, left: 67 };
      const chartWidth = width - pad.left - pad.right;
      const chartHeight = height - pad.top - pad.bottom;
      const maximum = Math.max(1, ...points.map((point) => point.sales));
      const yMaximum = calculateNiceMaximum(maximum);
      const xStep = points.length > 1 ? chartWidth / (points.length - 1) : 0;
      const coordinates = points.map((point, index) => ({
        x:
          pad.left +
          (points.length === 1 ? chartWidth / 2 : index * xStep),
        y: pad.top + chartHeight - (point.sales / yMaximum) * chartHeight,
        point,
      }));
      const linePath = coordinates
        .map(
          (item, index) =>
            `${index ? "L" : "M"} ${item.x.toFixed(1)} ${item.y.toFixed(1)}`,
        )
        .join(" ");
      const areaPath =
        `${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(1)} ` +
        `${(pad.top + chartHeight).toFixed(1)} L ${coordinates[0].x.toFixed(1)} ` +
        `${(pad.top + chartHeight).toFixed(1)} Z`;
      const labelEvery = Math.max(1, Math.ceil(points.length / 8));

      const gridLines = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const y = pad.top + chartHeight - ratio * chartHeight;
        const value = yMaximum * ratio;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"
            stroke="#e9e2d5" stroke-width="1"/>
          <text x="${pad.left - 10}" y="${y + 4}" text-anchor="end"
            fill="#747c89" font-size="10">${escapeHtml(formatCompactCurrency(value))}</text>
        `;
      }).join("");

      const xLabels = coordinates
        .map((item, index) => {
          if (index % labelEvery !== 0 && index !== coordinates.length - 1) {
            return "";
          }
          return `
            <text x="${item.x}" y="${height - 12}" text-anchor="middle"
              fill="#747c89" font-size="10">${escapeHtml(item.point.label)}</text>
          `;
        })
        .join("");

      const circles = coordinates
        .map(
          (item) => `
            <circle class="executive-sales-point"
              cx="${item.x}" cy="${item.y}" r="5"
              fill="#ffffff" stroke="#c79224" stroke-width="2"
              tabindex="0" role="img"
              data-label="${escapeHtml(item.point.label)}"
              data-sales="${item.point.sales}"
              data-transactions="${item.point.transactions}"
              aria-label="${escapeHtml(
                `${item.point.label}: ${formatCurrency(item.point.sales)}`,
              )}">
            </circle>
          `,
        )
        .join("");

      host.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img"
          aria-label="${escapeHtml(ariaLabel || "Reported service sales trend")}">
          <defs>
            <linearGradient id="${escapeHtml(gradientId)}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#e4b84e" stop-opacity="0.30"/>
              <stop offset="100%" stop-color="#e4b84e" stop-opacity="0.03"/>
            </linearGradient>
          </defs>
          ${gridLines}
          <path d="${areaPath}" fill="url(#${escapeHtml(gradientId)})"/>
          <path d="${linePath}" fill="none" stroke="#0b1f3a" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round"/>
          ${circles}
          ${xLabels}
        </svg>
      `;

      enableExecutiveChartTooltip(host);
    }
    function enableExecutiveChartTooltip(host) {
      let tooltip = document.getElementById("executiveChartTooltip");

      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "executiveChartTooltip";
        tooltip.className = "executive-chart-tooltip";
        tooltip.setAttribute("role", "tooltip");
        document.body.appendChild(tooltip);
      }

      function show(point, clientX, clientY) {
        const transactions = Number(point.dataset.transactions) || 0;
        tooltip.innerHTML = `
          <strong>${escapeHtml(point.dataset.label)}</strong>
          <span>${escapeHtml(formatCurrency(point.dataset.sales))}</span>
          <span>${escapeHtml(formatNumber(transactions))} transactions</span>
        `;
        tooltip.classList.add("visible");

        const gap = 14;
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        let left = clientX + gap;
        let top = clientY - height - gap;

        if (left + width > window.innerWidth - 10) {
          left = clientX - width - gap;
        }
        if (top < 10) top = clientY + gap;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      }

      function hide() {
        tooltip.classList.remove("visible");
      }

      host.querySelectorAll(".executive-sales-point").forEach((point) => {
        point.addEventListener("pointerenter", (event) => {
          show(point, event.clientX, event.clientY);
        });
        point.addEventListener("pointermove", (event) => {
          show(point, event.clientX, event.clientY);
        });
        point.addEventListener("pointerleave", hide);
        point.addEventListener("blur", hide);
        point.addEventListener("focus", () => {
          const box = point.getBoundingClientRect();
          show(point, box.left + box.width / 2, box.top);
        });
      });
    }

    function addMonthlySalesView() {
      const tabs = document.querySelector(".dashboard-view-tabs");
      const dashboard = document.getElementById("dashboard");

      if (!tabs || !dashboard || document.getElementById("monthlySalesTab")) {
        return;
      }

      const tab = document.createElement("button");
      tab.id = "monthlySalesTab";
      tab.className = "dashboard-view-tab";
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.setAttribute("aria-controls", "monthlySalesView");
      tab.textContent = "Monthly Sales";
      tab.addEventListener("click", () => {
        showMonthlySalesView(true);
      });
      tabs.appendChild(tab);

      const view = document.createElement("main");
      view.id = "monthlySalesView";
      view.className = "hidden executive-monthly-view";
      view.setAttribute("role", "tabpanel");
      view.setAttribute("aria-labelledby", "monthlySalesTab");
      view.innerHTML = `
        <section class="executive-monthly-hero">
          <div>
            <div class="eyebrow">Monthly target performance</div>
            <h2>Monthly Sales Detail</h2>
            <p>Sales, monthly targets, and achievement values aligned with SLSAch%.</p>
          </div>
          <label class="executive-month-field">
            <span>Reporting month</span>
            <input id="executiveMonthPicker" type="month">
          </label>
        </section>
        <section class="executive-monthly-kpis">
          <article class="executive-monthly-kpi">
            <span>Sales</span>
            <strong id="monthlyOfficialCollections">—</strong>
            <small>SLSAch% total</small>
          </article>
          <article class="executive-monthly-kpi">
            <span>Monthly target</span>
            <strong id="monthlySalesTarget">—</strong>
            <small>Monthly total</small>
          </article>
          <article class="executive-monthly-kpi">
            <span>Target achievement</span>
            <strong id="monthlyAverageAchievement">—</strong>
            <small id="monthlyAchievementNote">Based on SLSAch% calculation</small>
          </article>
        </section>
        <section class="executive-monthly-regions" id="monthlyRegionGroups">
          <div class="empty-chart">Loading monthly branch details…</div>
        </section>
      `;
      dashboard.appendChild(view);

      document
        .getElementById("executiveMonthPicker")
        ?.addEventListener("change", handleMonthlyPickerChange);

      document
        .querySelectorAll(".dashboard-view-tab:not(#monthlySalesTab)")
        .forEach((button) => {
          button.addEventListener("click", () => {
            executiveState.monthlyActive = false;
            document.getElementById("monthlySalesView")?.classList.add("hidden");
            document.getElementById("monthlySalesTab")?.classList.remove("active");
            document
              .getElementById("monthlySalesTab")
              ?.setAttribute("aria-selected", "false");
          });
        });
    }
    function showMonthlySalesView(activate) {
      const monthlyView = document.getElementById("monthlySalesView");
      const monthlyTab = document.getElementById("monthlySalesTab");

      if (!monthlyView || !monthlyTab) return;

      executiveState.monthlyActive = activate !== false;
      executiveState.trendsActive = false;
      document.getElementById("overviewView")?.classList.add("hidden");
      document.getElementById("slotUtilizationView")?.classList.add("hidden");
      document.getElementById("salesTrendsView")?.classList.add("hidden");
      monthlyView.classList.remove("hidden");

      document.querySelectorAll(".dashboard-view-tab").forEach((button) => {
        const active = button.id === "monthlySalesTab";
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });

      syncMonthPicker();

      const cachedSupport = getCachedSelectedMonthSupport();

      if (cachedSupport) {
        renderMonthlySales(cachedSupport);
        return;
      }

      if (mainRequestWillPreloadSelectedMonth()) {
        showMonthlyLoading("Preparing monthly detail…");
        return;
      }

      showMonthlyLoading("Loading the selected month…");
      loadSelectedMonthSupport(false);
    }
    function supportMatchesSelectedMonth(supportData) {
      const selectedKey = getSelectedMonthCacheKey();
      const supportKey = getSupportMonthCacheKey(supportData);

      return Boolean(selectedKey && supportKey === selectedKey);
    }
    function handleMonthlyPickerChange() {
      executiveState.monthlyActive = true;

      const request = buildSelectedMonthRequest(false);
      if (!request) return;

      const startInput = document.getElementById("startDate");
      const endInput = document.getElementById("endDate");

      if (startInput && endInput) {
        startInput.value = request.filters.startDate;
        endInput.value = request.filters.endDate;

        if (
          window.dashboardState &&
          typeof window.requestDashboardData === "function"
        ) {
          window.requestDashboardData(request.filters);
        }
      }
    }



    function buildSelectedMonthRequest(forceRefresh) {
      const value =
        document.getElementById("executiveMonthPicker")?.value || "";

      if (!/^\d{4}-\d{2}$/.test(value)) return null;

      const [year, month] = value.split("-").map(Number);
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0);
      const startInput = document.getElementById("startDate");
      const endInput = document.getElementById("endDate");
      const minimum = parseIsoDate(
        startInput?.min || toIsoDate(monthStart),
      );
      const maximum = parseIsoDate(
        endInput?.max || toIsoDate(monthEnd),
      );
      const boundedStart = monthStart < minimum ? minimum : monthStart;
      const boundedEnd = monthEnd > maximum ? maximum : monthEnd;
      const currentFilters = readExecutiveFilters();

      if (boundedStart > boundedEnd) return null;

      return {
        monthValue: value,
        filters: {
          startDate: toIsoDate(boundedStart),
          endDate: toIsoDate(boundedEnd),
          region: currentFilters.region,
          branch: currentFilters.branch,
          forceRefresh: forceRefresh === true,
        },
      };
    }
    function primeMonthlyCacheFromSupport(supportData) {
      cacheMonthlySupport(supportData);
      cacheMonthlySupport(supportData?.monthlySnapshot);
    }
    function cacheMonthlySupport(supportData) {
      const cacheKey = getSupportMonthCacheKey(supportData);

      if (!cacheKey) return "";

      executiveState.monthlyCache[cacheKey] = supportData;
      return cacheKey;
    }
    function getCachedSelectedMonthSupport() {
      const cacheKey = getSelectedMonthCacheKey();

      if (!cacheKey) return null;

      if (executiveState.monthlyCache[cacheKey]) {
        return executiveState.monthlyCache[cacheKey];
      }

      if (supportMatchesSelectedMonth(executiveState.latestSupport)) {
        cacheMonthlySupport(executiveState.latestSupport);
        return executiveState.latestSupport;
      }

      return null;
    }
    function getSelectedMonthCacheKey() {
      const monthValue =
        document.getElementById("executiveMonthPicker")?.value || "";
      const filters = readExecutiveFilters();

      if (!/^\d{4}-\d{2}$/.test(monthValue)) return "";

      return getMonthlyCacheKey(
        monthValue,
        filters.region,
        filters.branch,
      );
    }
    function getSupportMonthCacheKey(supportData) {
      const applied = supportData?.filtersApplied || {};
      const startDate = String(applied.startDate || "");
      const endDate = String(applied.endDate || "");
      const startMonth = startDate.slice(0, 7);
      const endMonth = endDate.slice(0, 7);

      if (
        !/^\d{4}-\d{2}$/.test(startMonth) ||
        startMonth !== endMonth
      ) {
        return "";
      }

      return getMonthlyCacheKey(
        startMonth,
        applied.region || "ALL",
        applied.branch || "ALL",
      );
    }
    function getMonthlyCacheKey(monthValue, region, branch) {
      return [
        String(monthValue || ""),
        String(region || "ALL"),
        String(branch || "ALL"),
      ].join("|");
    }
    function showMonthlyLoading(message) {
      const host = document.getElementById("monthlyRegionGroups");

      if (host) {
        host.innerHTML = `<div class="empty-chart">${escapeHtml(
          message || "Loading monthly detail…",
        )}</div>`;
      }
    }
    function syncMonthPicker() {
      const picker = document.getElementById("executiveMonthPicker");
      const endValue = document.getElementById("endDate")?.value;

      if (picker && /^\d{4}-\d{2}/.test(endValue || "")) {
        picker.value = endValue.slice(0, 7);
      }
    }

    window.showMonthlySalesView = showMonthlySalesView;

    function renderMonthlySales(supportData) {
      const kpis = supportData.kpis || {};
      const branches = supportData.branches || [];
      const suppliedRegions = supportData.regions || [];
      const regionMap = Object.create(null);

      setText(
        "monthlyOfficialCollections",
        formatCurrency(kpis.officialActualCollections),
      );
      setText("monthlySalesTarget", formatCurrency(kpis.target));
      setText(
        "monthlyAverageAchievement",
        kpis.targetAchievement == null
          ? "—"
          : formatPercentPrecise(kpis.targetAchievement),
      );
      setText(
        "monthlyAchievementNote",
        `${formatNumber(
          kpis.branchAchievementCount || 0,
        )} branches in the selected scope`,
      );

      suppliedRegions.forEach((regionSummary) => {
        const region = regionSummary.region || "Unspecified";

        regionMap[region] = {
          region,
          branches: [],
          actual: Number(regionSummary.actualCollections ?? regionSummary.sales) || 0,
          target: Number(regionSummary.target) || 0,
          targetAchievement:
            regionSummary.targetAchievement == null
              ? null
              : Number(regionSummary.targetAchievement),
        };
      });

      branches.forEach((branch) => {
        const region = branch.region || "Unspecified";

        if (!regionMap[region]) {
          regionMap[region] = {
            region,
            branches: [],
            actual: 0,
            target: 0,
            targetAchievement: null,
          };
        }

        regionMap[region].branches.push(branch);
      });

      const groups = Object.values(regionMap)
        .filter((group) => group.branches.length || group.actual || group.target)
        .sort(compareMonthlyRegionPerformance);

      const host = document.getElementById("monthlyRegionGroups");

      if (!host) return;

      if (!groups.length) {
        host.innerHTML =
          '<div class="empty-chart">No monthly branch data for this selection.</div>';
        return;
      }

      host.innerHTML = groups
        .map((group, index) => {
          const branchRows = group.branches
            .sort(
              (first, second) =>
                (Number(second.officialActualCollections) || 0) -
                  (Number(first.officialActualCollections) || 0) ||
                String(first.branchName || "").localeCompare(
                  String(second.branchName || ""),
                ),
            )
            .map(
              (branch) => `
                <tr>
                  <td>${escapeHtml(branch.branchName)}</td>
                  <td>${escapeHtml(
                    formatCurrency(branch.officialActualCollections),
                  )}</td>
                  <td>${escapeHtml(formatCurrency(branch.target))}</td>
                  <td>${
                    branch.targetAchievement == null
                      ? "—"
                      : escapeHtml(
                          formatPercentPrecise(branch.targetAchievement),
                        )
                  }</td>
                </tr>
              `,
            )
            .join("");

          return `
            <details class="executive-region-card" ${index === 0 ? "open" : ""}>
              <summary>
                <strong>${escapeHtml(group.region)}</strong>
                <span>${escapeHtml(formatCurrency(group.actual))}</span>
                <span>${escapeHtml(formatCurrency(group.target))}</span>
                <span>${
                  group.targetAchievement == null
                    ? "—"
                    : escapeHtml(
                        formatPercentPrecise(group.targetAchievement),
                      )
                }</span>
              </summary>
              <table>
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Sales</th>
                    <th>Monthly target</th>
                    <th>Achievement</th>
                  </tr>
                </thead>
                <tbody>${branchRows}</tbody>
              </table>
            </details>
          `;
        })
        .join("");
    }
    function compareMonthlyRegionPerformance(first, second) {
      const firstAchievement =
        first.targetAchievement == null
          ? Number.NEGATIVE_INFINITY
          : Number(first.targetAchievement);
      const secondAchievement =
        second.targetAchievement == null
          ? Number.NEGATIVE_INFINITY
          : Number(second.targetAchievement);

      if (secondAchievement !== firstAchievement) {
        return secondAchievement - firstAchievement;
      }

      return compareRegions(first, second);
    }
    function compareRegions(first, second) {
      if (first.region === "NIR") return -1;
      if (second.region === "NIR") return 1;
      const firstNumber = Number((first.region.match(/\d+/) || [999])[0]);
      const secondNumber = Number((second.region.match(/\d+/) || [999])[0]);
      return firstNumber - secondNumber || first.region.localeCompare(second.region);
    }

    function readExecutiveFilters() {
      return {
        startDate: document.getElementById("startDate")?.value || "",
        endDate: document.getElementById("endDate")?.value || "",
        region: document.getElementById("regionFilter")?.value || "ALL",
        branch: document.getElementById("branchFilter")?.value || "ALL",
      };
    }
    function isAppsScriptRuntime() {
      return Boolean(
        window.google &&
          google.script &&
          google.script.run &&
          typeof google.script.run.withSuccessHandler === "function",
      );
    }
    function setText(id, value) {
      const element = document.getElementById(id);
      const nextValue = String(value ?? "");

      if (element && element.textContent !== nextValue) {
        element.textContent = nextValue;
      }
    }
    function formatCurrency(value) {
      return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 0,
      }).format(Number(value) || 0);
    }
    function formatCompactCurrency(value) {
      return (
        "₱" +
        new Intl.NumberFormat("en", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(Number(value) || 0)
      );
    }
    function formatPercent(value) {
      return `${(Number(value) || 0).toFixed(1)}%`;
    }
    function formatPercentPrecise(value) {
      return `${(Number(value) || 0).toFixed(2)}%`;
    }
    function formatNumber(value) {
      return new Intl.NumberFormat("en-PH", {
        maximumFractionDigits: 0,
      }).format(Number(value) || 0);
    }
    function calculateNiceMaximum(value) {
      const safeValue = Math.max(1, Number(value) || 1);
      const exponent = Math.floor(Math.log10(safeValue));
      const fraction = safeValue / Math.pow(10, exponent);
      let niceFraction = 10;

      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;

      return niceFraction * Math.pow(10, exponent);
    }
    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
    function formatExecutiveDate(value) {
      const date = parseIsoDate(value);

      if (Number.isNaN(date.getTime())) return String(value || "—");

      return new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
    }
    function parseIsoDate(value) {
      const [year, month, day] = String(value).split("-").map(Number);
      return new Date(year, month - 1, day);
    }
    function toIsoDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

})();

