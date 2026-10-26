const input = document.getElementById("emails");
const charCount = document.getElementById("char-count");
const checkBtn = document.getElementById("check-btn");
const errorBox = document.getElementById("error");
const emptyState = document.getElementById("empty-state");
const resultsPanel = document.getElementById("results");
const resultList = document.getElementById("result-list");
let lastResults = [];

function countAddresses() {
  const items = input.value.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
  charCount.textContent = `${items.length} address${items.length === 1 ? "" : "es"}`;
}
input.addEventListener("input", countAddresses);

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}
function setCount(id, value) {
  document.getElementById(id).textContent = value;
}
function renderResults(data) {
  lastResults = data.results;
  setCount("count-delivered", data.counts.likely_delivered);
  setCount("count-bounce", data.counts.likely_bounce);
  setCount("count-unknown", data.counts.unknown);
  resultList.replaceChildren();
  for (const row of data.results) {
    const item = document.createElement("article");
    item.className = "result-item";
    const top = document.createElement("div");
    top.className = "result-top";
    const email = document.createElement("div");
    email.className = "result-email";
    email.textContent = row.email;
    const status = document.createElement("span");
    status.className = `status-pill ${row.status}`;
    status.textContent = row.label;
    const reason = document.createElement("p");
    reason.className = "result-reason";
    reason.textContent = row.reason;
    top.append(email, status);
    item.append(top, reason);
    resultList.append(item);
  }
  emptyState.hidden = true;
  resultsPanel.hidden = false;
}
checkBtn.addEventListener("click", async () => {
  showError("");
  const emails = input.value.trim();
  if (!emails) {
    showError("Paste at least one email address first.");
    input.focus();
    return;
  }
  checkBtn.disabled = true;
  checkBtn.querySelector("span").textContent = "Checking…";
  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({emails, smtp_check: document.getElementById("smtp-check").checked})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The check could not be completed.");
    renderResults(data);
  } catch (err) {
    showError(err.message || "Network error. Please try again.");
  } finally {
    checkBtn.disabled = false;
    checkBtn.querySelector("span").textContent = "Check addresses";
  }
});
document.getElementById("clear-btn").addEventListener("click", () => {
  lastResults = [];
  resultsPanel.hidden = true;
  emptyState.hidden = false;
  showError("");
});
document.getElementById("export-btn").addEventListener("click", () => {
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [["Email", "Status", "Reason"], ...lastResults.map(r => [r.email, r.label, r.reason])]
    .map(row => row.map(quote).join(",")).join("\r\n");
  const blob = new Blob([csv], {type: "text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mailscope-results.csv";
  link.click();
  URL.revokeObjectURL(url);
});
