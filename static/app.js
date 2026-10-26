(() => {
  "use strict";

  const form = document.getElementById("check-form");
  const input = document.getElementById("emails");
  const addressCount = document.getElementById("address-count");
  const checkButton = document.getElementById("check-btn");
  const buttonLabel = checkButton.querySelector(".button-label");
  const errorBox = document.getElementById("error");
  const resultsSection = document.getElementById("results-section");
  const resultList = document.getElementById("result-list");
  const searchInput = document.getElementById("search-input");
  const statusFilter = document.getElementById("status-filter");
  const noMatches = document.getElementById("no-matches");
  const resetButton = document.getElementById("reset-btn");
  const statuses = ["likely_delivered", "likely_bounce", "unknown"];
  const allowedStatuses = new Set(statuses);
  const labelByStatus = {
    likely_delivered: "Likely to be delivered",
    likely_bounce: "Likely to bounce",
    unknown: "Unknown"
  };
  let allResults = [];
  let isChecking = false;

  function splitAddresses(value) {
    return value.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean);
  }

  function updateAddressCount() {
    const count = splitAddresses(input.value).length;
    addressCount.textContent = String(count);
    addressCount.classList.toggle("over-limit", count > 20);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function validPayload(data) {
    return data && Array.isArray(data.results) && data.results.every(row =>
      row && typeof row.email === "string" && typeof row.reason === "string" &&
      typeof row.label === "string" && allowedStatuses.has(row.status));
  }

  function setMetric(id, value) {
    document.getElementById(id).textContent = String(value);
  }

  function getCounts(results) {
    return Object.fromEntries(statuses.map(status => [
      status, results.filter(row => row.status === status).length
    ]));
  }

  function updateAnalytics() {
    const total = allResults.length;
    const counts = getCounts(allResults);
    setMetric("count-total", total);
    setMetric("count-delivered", counts.likely_delivered);
    setMetric("count-bounce", counts.likely_bounce);
    setMetric("count-unknown", counts.unknown);
    for (const status of statuses) {
      const pct = total ? Math.round(counts[status] * 100 / total) : 0;
      setMetric(`pct-${status.replace("likely_", "")}`, `${pct}%`);
    }
    const distribution = document.getElementById("distribution");
    const deliveredPct = total ? counts.likely_delivered * 100 / total : 0;
    const bouncePct = total ? counts.likely_bounce * 100 / total : 0;
    const deliveredEnd = deliveredPct;
    const bounceEnd = deliveredEnd + bouncePct;
    distribution.style.setProperty("--delivered-end", `${deliveredEnd}%`);
    distribution.style.setProperty("--bounce-end", `${bounceEnd}%`);
    distribution.style.background = total ? "" : "conic-gradient(var(--surface-strong) 0 100%)";
    distribution.setAttribute("aria-label", total
      ? `Status distribution for ${total} addresses: ${counts.likely_delivered} likely delivered, ${counts.likely_bounce} likely bounce, ${counts.unknown} unknown.`
      : "No results yet");
    document.getElementById("results-total").textContent = `${total} address${total === 1 ? "" : "es"} checked`;
    document.getElementById("analytics-empty").hidden = total > 0;
  }

  function makeCell(text, className) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = text;
    return cell;
  }

  function renderResults() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const selectedStatus = statusFilter.value;
    const visible = allResults.filter(row =>
      row.email.toLocaleLowerCase().includes(query) &&
      (selectedStatus === "all" || row.status === selectedStatus));
    resultList.replaceChildren();
    for (const row of visible) {
      const tr = document.createElement("tr");
      const email = makeCell(row.email, "email-cell");
      email.title = row.email;
      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${row.status}`;
      badge.textContent = row.label || labelByStatus[row.status];
      statusCell.append(badge);
      tr.append(email, statusCell, makeCell(row.reason, "reason-cell"));
      resultList.append(tr);
    }
    const countText = visible.length === allResults.length
      ? `Showing all ${allResults.length} results`
      : `Showing ${visible.length} of ${allResults.length} results`;
    document.getElementById("visible-count").textContent = countText;
    noMatches.hidden = visible.length > 0;
  }

  function render(data) {
    allResults = data.results.map(row => ({...row, label: row.label || labelByStatus[row.status]}));
    updateAnalytics();
    resultsSection.hidden = false;
    renderResults();
    document.getElementById("results-title").focus({preventScroll: true});
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultsSection.scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block: "start"});
  }

  async function checkAddresses() {
    if (isChecking) return;
    showError("");
    const emails = input.value.trim();
    if (!emails) {
      showError("Paste at least one email address first.");
      input.focus();
      return;
    }
    if (splitAddresses(emails).length > 20) {
      showError("Please check no more than 20 addresses per request.");
      input.focus();
      return;
    }

    isChecking = true;
    checkButton.disabled = true;
    checkButton.setAttribute("aria-busy", "true");
    buttonLabel.textContent = "Checking addresses…";
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: {"Content-Type": "application/json", "Accept": "application/json"},
        body: JSON.stringify({
          emails,
          smtp_check: document.getElementById("smtp-check").checked
        })
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error("The server returned an unreadable response. Please try again."); }
      if (!response.ok) throw new Error(data && data.error ? data.error : "The check could not be completed.");
      if (!validPayload(data)) throw new Error("The server response was incomplete. Your input is still here; please try again.");
      render(data);
    } catch (error) {
      showError(error instanceof TypeError
        ? "Could not connect to MailScope. Check your connection and try again."
        : (error.message || "The check failed. Please try again."));
    } finally {
      isChecking = false;
      checkButton.disabled = false;
      checkButton.removeAttribute("aria-busy");
      buttonLabel.textContent = "Check addresses";
    }
  }

  function csvSafe(value) {
    const text = String(value ?? "");
    // Prefix spreadsheet formula starters, including those preceded by whitespace.
    return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function exportCsv() {
    const quote = value => `"${csvSafe(value).replaceAll('"', '""')}"`;
    const rows = [["Email", "Status", "Reason"], ...allResults.map(row => [row.email, row.label, row.reason])];
    const csv = rows.map(row => row.map(quote).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mailscope-results.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function clearAll() {
    input.value = "";
    document.getElementById("smtp-check").checked = false;
    allResults = [];
    searchInput.value = "";
    statusFilter.value = "all";
    resultsSection.hidden = true;
    showError("");
    updateAddressCount();
    updateAnalytics();
    input.focus();
  }

  function setupTheme() {
    const button = document.getElementById("theme-toggle");
    const label = document.getElementById("theme-label");
    const root = document.documentElement;
    function setTheme(theme, persist) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
      document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#101827" : "#f5f7fb";
      const next = theme === "dark" ? "light" : "dark";
      label.textContent = `${next === "dark" ? "Dark" : "Light"} mode`;
      button.setAttribute("aria-label", `Switch to ${next} theme`);
      button.title = `Switch to ${next} theme`;
      if (persist) {
        try { localStorage.setItem("mailscope-theme", theme); } catch (_) { /* Keep the current session theme. */ }
      }
    }
    setTheme(root.dataset.theme || "light", false);
    button.addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark", true));
  }

  form.addEventListener("submit", event => { event.preventDefault(); checkAddresses(); });
  input.addEventListener("input", updateAddressCount);
  searchInput.addEventListener("input", renderResults);
  statusFilter.addEventListener("change", renderResults);
  resetButton.addEventListener("click", clearAll);
  document.getElementById("export-btn").addEventListener("click", exportCsv);
  setupTheme();
  updateAddressCount();
  updateAnalytics();
})();
