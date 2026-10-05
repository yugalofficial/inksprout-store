// ============================================================
// InkSprout Admin — dashboard logic
// ============================================================

const SESSION_KEY = "inksprout_admin_token";
let allBooks = [];
let analytics = { totals: {}, byBook: {} };
let allLeads = [];
let chartInstance = null;
let editingId = null;
let deleteTargetId = null;

function backendUrl() {
  return (typeof CONFIG !== "undefined" && CONFIG.APPS_SCRIPT_URL || "").trim();
}

function getToken() { return localStorage.getItem(SESSION_KEY) || ""; }
function setToken(t) { localStorage.setItem(SESSION_KEY, t); }
function clearToken() { localStorage.removeItem(SESSION_KEY); }

async function callBackend(action, extra) {
  const url = backendUrl();
  if (!url) throw new Error("Backend not configured. Add your Apps Script URL to config.js.");
  const body = Object.assign({ action: action, token: getToken() }, extra || {});
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight on Apps Script
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("Server error (" + res.status + ")");
  const data = await res.json();
  if (data.authError) {
    clearToken();
    showLogin("Your session expired. Please log in again.");
    throw new Error(data.error || "Session expired.");
  }
  return data;
}

function showToast(message, type) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

// ---------------- Login / session ----------------

function showLogin(errorMsg) {
  document.getElementById("dashboard").hidden = true;
  document.getElementById("loginScreen").hidden = false;
  const err = document.getElementById("loginError");
  if (errorMsg) { err.textContent = errorMsg; err.hidden = false; } else { err.hidden = true; }
}

function showDashboard() {
  document.getElementById("loginScreen").hidden = true;
  document.getElementById("dashboard").hidden = false;
  loadAdminData();
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById("loginBtn");
  const password = document.getElementById("passwordInput").value;
  btn.disabled = true;
  btn.textContent = "Signing in...";
  try {
    const data = await callBackend("login", { password: password });
    if (data.success) {
      setToken(data.token);
      showDashboard();
    } else {
      document.getElementById("loginError").textContent = data.error || "Login failed.";
      document.getElementById("loginError").hidden = false;
    }
  } catch (err) {
    document.getElementById("loginError").textContent = err.message;
    document.getElementById("loginError").hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Log in";
  }
}

function handleLogout() {
  clearToken();
  showLogin();
}

// ---------------- Data loading ----------------

async function loadAdminData() {
  try {
    const data = await callBackend("listAdmin");
    if (!data.success) { showToast(data.error || "Could not load data.", "error"); return; }
    allBooks = data.books || [];
    analytics = data.analytics || { totals: {}, byBook: {} };
    renderStats();
    renderTable();
    try {
      renderChart();
    } catch (chartErr) {
      // The chart is a nice-to-have — never let it block the books table.
      console.warn("InkSprout: chart failed to render.", chartErr);
      document.getElementById("noAnalytics").hidden = false;
      document.getElementById("noAnalytics").textContent = "Chart couldn't load (Chart.js may be blocked). Your book data above is unaffected.";
      document.getElementById("clicksChart").style.display = "none";
    }
  } catch (err) {
    showToast(err.message, "error");
  }

  // Leads are fetched separately so a failure here never blocks the
  // books table or stats above, which matter more.
  try {
    const leadData = await callBackend("listLeads");
    if (leadData.success) {
      allLeads = leadData.leads || [];
      renderStats();
      renderLeadsTable();
    }
  } catch (err) {
    console.warn("InkSprout: could not load leads.", err);
  }
}

function renderLeadsTable() {
  const tbody = document.getElementById("leadsTableBody");
  const sorted = [...allLeads].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  document.getElementById("noLeads").hidden = sorted.length > 0;
  tbody.innerHTML = sorted.slice(0, 50).map(l => {
    const book = allBooks.find(b => b.id === l.bookId);
    const when = new Date(l.timestamp);
    return `<tr>
      <td>${escapeHtml(l.email)}</td>
      <td>${escapeHtml(book ? book.title : l.bookId)}</td>
      <td>${isNaN(when) ? "" : when.toLocaleDateString()}</td>
    </tr>`;
  }).join("");
}

function renderStats() {
  const live = allBooks.filter(b => b.status === "live" || !b.status).length;
  const draft = allBooks.filter(b => b.status === "draft").length;
  const soldOut = allBooks.filter(b => b.status === "sold-out").length;
  const previewClicks = analytics.totals.preview || 0;
  const buyClicks = (analytics.totals.buy_gumroad || 0) + (analytics.totals.buy_creatly || 0) + (analytics.totals.buy_other || 0);

  const stats = [
    { label: "Total books", value: allBooks.length },
    { label: "Live", value: live },
    { label: "Draft", value: draft },
    { label: "Sold out", value: soldOut },
    { label: "Preview clicks", value: previewClicks },
    { label: "Buy-link clicks", value: buyClicks },
    { label: "Notify-me leads", value: allLeads.length },
  ];
  const grid = document.getElementById("statsGrid");
  grid.innerHTML = stats.map(s =>
    `<div class="stat-card"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`
  ).join("");
}

function renderChart() {
  if (typeof Chart === "undefined") throw new Error("Chart.js did not load.");
  const ctx = document.getElementById("clicksChart");
  const bookIds = allBooks.map(b => b.id);
  const hasAny = Object.keys(analytics.byBook).length > 0;
  document.getElementById("noAnalytics").hidden = hasAny;
  ctx.style.display = hasAny ? "block" : "none";
  if (!hasAny) return;

  const labels = bookIds.map(id => {
    const b = allBooks.find(x => x.id === id);
    return b ? b.title : id;
  });
  const buyData = bookIds.map(id => {
    const e = analytics.byBook[id] || {};
    return (e.buy_gumroad || 0) + (e.buy_creatly || 0) + (e.buy_other || 0);
  });
  const previewData = bookIds.map(id => (analytics.byBook[id] || {}).preview || 0);

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "Buy clicks", data: buyData, backgroundColor: "#FFC93C" },
        { label: "Preview opens", data: previewData, backgroundColor: "#3DDC97" }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: "bottom" } }
    }
  });
}

// ---------------- Table ----------------

function currentFilters() {
  return {
    q: (document.getElementById("adminSearch").value || "").toLowerCase().trim(),
    status: document.getElementById("statusFilter").value
  };
}

function renderTable() {
  const { q, status } = currentFilters();
  const filtered = allBooks.filter(b => {
    const matchesQ = !q || (b.title + " " + b.category).toLowerCase().includes(q);
    const bStatus = b.status || "live";
    const matchesStatus = status === "all" || bStatus === status;
    return matchesQ && matchesStatus;
  });

  const tbody = document.getElementById("booksTableBody");
  document.getElementById("noBooks").hidden = filtered.length > 0;

  tbody.innerHTML = filtered.map(b => {
    const bStatus = b.status || "live";
    const clicks = analytics.byBook[b.id] || {};
    const buyClicks = (clicks.buy_gumroad || 0) + (clicks.buy_creatly || 0) + (clicks.buy_other || 0);
    return `
      <tr>
        <td class="cell-cover"><img src="${escapeHtml(b.coverImage)}" alt="" loading="lazy"></td>
        <td class="cell-title">${escapeHtml(b.title)}<small>${escapeHtml(b.tagline || "")}</small></td>
        <td>${escapeHtml(b.category)}</td>
        <td>₹${escapeHtml(b.price)}</td>
        <td>
          <select class="field-select status-select" data-id="${escapeHtml(b.id)}" style="padding:4px 8px;font-size:0.78rem;">
            <option value="live" ${bStatus === "live" ? "selected" : ""}>Live</option>
            <option value="draft" ${bStatus === "draft" ? "selected" : ""}>Draft</option>
            <option value="sold-out" ${bStatus === "sold-out" ? "selected" : ""}>Sold out</option>
          </select>
        </td>
        <td>${clicks.preview || 0} preview &middot; ${buyClicks} buy</td>
        <td class="row-actions">
          <button class="icon-btn edit-btn" data-id="${escapeHtml(b.id)}">Edit</button>
          <button class="icon-btn danger delete-btn" data-id="${escapeHtml(b.id)}">Delete</button>
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll(".edit-btn").forEach(btn => btn.addEventListener("click", () => openEditModal(btn.dataset.id)));
  tbody.querySelectorAll(".delete-btn").forEach(btn => btn.addEventListener("click", () => openDeleteModal(btn.dataset.id)));
  tbody.querySelectorAll(".status-select").forEach(sel => sel.addEventListener("change", () => quickStatusChange(sel.dataset.id, sel.value)));
}

async function quickStatusChange(id, newStatus) {
  const book = allBooks.find(b => b.id === id);
  if (!book) return;
  const updated = Object.assign({}, book, { status: newStatus });
  try {
    const data = await callBackend("updateBook", { book: updated });
    if (data.success) {
      allBooks = data.books;
      renderStats();
      renderTable();
      showToast("Status updated.", "success");
    } else {
      showToast(data.error || "Could not update status.", "error");
    }
  } catch (err) { showToast(err.message, "error"); }
}

// ---------------- Add / Edit modal ----------------

const FIELD_IDS = ["id","title","tagline","category","price","originalPrice","pages","coverImage","description","previewLink","gumroadLink","creatlyLink","otherLinkLabel","otherLink","status"];

function openAddModal() {
  editingId = null;
  document.getElementById("modalTitle").textContent = "Add new book";
  FIELD_IDS.forEach(f => { const el = document.getElementById("f_" + f); if (el) el.value = ""; });
  document.getElementById("f_id").disabled = false;
  document.getElementById("f_status").value = "live";
  document.getElementById("formError").hidden = true;
  document.getElementById("bookModal").hidden = false;
}

function openEditModal(id) {
  const b = allBooks.find(x => x.id === id);
  if (!b) return;
  editingId = id;
  document.getElementById("modalTitle").textContent = "Edit book";
  FIELD_IDS.forEach(f => { const el = document.getElementById("f_" + f); if (el) el.value = b[f] != null ? b[f] : ""; });
  document.getElementById("f_id").disabled = true; // id is the sheet key — don't allow changing it here
  document.getElementById("formError").hidden = true;
  document.getElementById("bookModal").hidden = false;
}

function closeBookModal() {
  document.getElementById("bookModal").hidden = true;
  document.getElementById("f_id").disabled = false;
}

async function handleBookFormSubmit(e) {
  e.preventDefault();
  const book = {};
  FIELD_IDS.forEach(f => {
    const el = document.getElementById("f_" + f);
    if (!el) return;
    book[f] = el.type === "number" ? Number(el.value || 0) : el.value;
  });
  if (editingId) book.id = editingId;
  book.rating = (allBooks.find(b => b.id === book.id) || {}).rating || 0;
  book.reviewCount = (allBooks.find(b => b.id === book.id) || {}).reviewCount || 0;
  book.featured = (allBooks.find(b => b.id === book.id) || {}).featured || false;

  const saveBtn = document.getElementById("saveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  try {
    const action = editingId ? "updateBook" : "addBook";
    const data = await callBackend(action, { book: book });
    if (data.success) {
      allBooks = data.books;
      renderStats();
      renderTable();
      closeBookModal();
      showToast(editingId ? "Book updated." : "Book added.", "success");
    } else {
      document.getElementById("formError").textContent = data.error || "Could not save book.";
      document.getElementById("formError").hidden = false;
    }
  } catch (err) {
    document.getElementById("formError").textContent = err.message;
    document.getElementById("formError").hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save book";
  }
}

// ---------------- Delete modal ----------------

function openDeleteModal(id) {
  const b = allBooks.find(x => x.id === id);
  if (!b) return;
  deleteTargetId = id;
  document.getElementById("deleteBookName").textContent = b.title;
  document.getElementById("deleteModal").hidden = false;
}
function closeDeleteModal() {
  document.getElementById("deleteModal").hidden = true;
  deleteTargetId = null;
}
async function confirmDelete() {
  if (!deleteTargetId) return;
  const btn = document.getElementById("deleteConfirmBtn");
  btn.disabled = true;
  btn.textContent = "Deleting...";
  try {
    const data = await callBackend("deleteBook", { id: deleteTargetId });
    if (data.success) {
      allBooks = data.books;
      renderStats();
      renderTable();
      closeDeleteModal();
      showToast("Book deleted.", "success");
    } else {
      showToast(data.error || "Could not delete book.", "error");
    }
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Delete";
  }
}

// ---------------- CSV export ----------------

function toCSV(rows, columns) {
  const escapeCell = (val) => {
    const s = String(val == null ? "" : val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map(c => c.label).join(",");
  const body = rows.map(row => columns.map(c => escapeCell(c.get(row))).join(",")).join("\n");
  return header + "\n" + body;
}

function downloadCSV(filename, csvString) {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportBooksCSV() {
  if (allBooks.length === 0) { showToast("No books to export.", "error"); return; }
  const columns = [
    { label: "id", get: b => b.id }, { label: "title", get: b => b.title },
    { label: "tagline", get: b => b.tagline }, { label: "category", get: b => b.category },
    { label: "price", get: b => b.price }, { label: "originalPrice", get: b => b.originalPrice },
    { label: "pages", get: b => b.pages }, { label: "status", get: b => b.status || "live" },
    { label: "gumroadLink", get: b => b.gumroadLink }, { label: "creatlyLink", get: b => b.creatlyLink },
    { label: "previewLink", get: b => b.previewLink },
  ];
  downloadCSV(`inksprout-books-${todayStr()}.csv`, toCSV(allBooks, columns));
  showToast("Books CSV downloaded.", "success");
}

function exportLeadsCSV() {
  if (allLeads.length === 0) { showToast("No leads to export.", "error"); return; }
  const columns = [
    { label: "timestamp", get: l => l.timestamp }, { label: "email", get: l => l.email },
    { label: "bookId", get: l => l.bookId },
    { label: "bookTitle", get: l => (allBooks.find(b => b.id === l.bookId) || {}).title || l.bookId },
  ];
  downloadCSV(`inksprout-leads-${todayStr()}.csv`, toCSV(allLeads, columns));
  showToast("Leads CSV downloaded.", "success");
}

function exportClicksCSV() {
  const bookIds = Object.keys(analytics.byBook);
  if (bookIds.length === 0) { showToast("No click data to export.", "error"); return; }
  const columns = [
    { label: "bookId", get: id => id },
    { label: "bookTitle", get: id => (allBooks.find(b => b.id === id) || {}).title || id },
    { label: "preview", get: id => (analytics.byBook[id] || {}).preview || 0 },
    { label: "buy_gumroad", get: id => (analytics.byBook[id] || {}).buy_gumroad || 0 },
    { label: "buy_creatly", get: id => (analytics.byBook[id] || {}).buy_creatly || 0 },
    { label: "buy_other", get: id => (analytics.byBook[id] || {}).buy_other || 0 },
  ];
  downloadCSV(`inksprout-clicks-${todayStr()}.csv`, toCSV(bookIds, columns));
  showToast("Clicks CSV downloaded.", "success");
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// ---------------- Wire up ----------------

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("addBookBtn").addEventListener("click", openAddModal);
  document.getElementById("modalClose").addEventListener("click", closeBookModal);
  document.getElementById("cancelBtn").addEventListener("click", closeBookModal);
  document.getElementById("bookForm").addEventListener("submit", handleBookFormSubmit);
  document.getElementById("deleteCancelBtn").addEventListener("click", closeDeleteModal);
  document.getElementById("deleteConfirmBtn").addEventListener("click", confirmDelete);
  document.getElementById("adminSearch").addEventListener("input", renderTable);
  document.getElementById("statusFilter").addEventListener("change", renderTable);
  document.getElementById("exportBooksBtn").addEventListener("click", exportBooksCSV);
  document.getElementById("exportLeadsBtn").addEventListener("click", exportLeadsCSV);
  document.getElementById("exportClicksBtn").addEventListener("click", exportClicksCSV);

  if (getToken() && backendUrl()) {
    showDashboard();
  } else if (!backendUrl()) {
    showLogin("Backend not configured yet — add your Apps Script URL to config.js first.");
  } else {
    showLogin();
  }
});
