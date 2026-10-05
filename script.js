// ============================================================
// InkSprout storefront logic
// No build step, no dependencies — plain DOM + fetch.
// ============================================================

// Shown instantly on load, and used as a safety net if the Google
// Sheet backend is unreachable or not yet configured. Edit the
// Google Sheet (or use admin.html) to update real data — this
// array is only a fallback.
const FALLBACK_BOOKS = [
  {
    id: "side-income",
    title: "Your First ₹10,000",
    tagline: "10 real side income ideas for India",
    category: "Side Income",
    price: 149,
    originalPrice: 299,
    pages: 30,
    rating: 0,
    reviewCount: 0,
    coverImage: "assets/covers/side-income.jpg",
    description: "Ten honest, beginner-friendly ways to earn extra income in India, with realistic ranges and a 90-day plan.",
    gumroadLink: "https://REPLACE-gumroad-username.gumroad.com/l/side-income",
    creatlyLink: "",
    otherLinkLabel: "",
    otherLink: "",
    previewLink: "https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view",
    featured: true,
    status: "live"
  },
  {
    id: "ebook-blueprint",
    title: "The Ebook Blueprint",
    tagline: "50 ideas, plus how to write, design & sell your own",
    category: "Creator Tools",
    price: 149,
    originalPrice: 299,
    pages: 27,
    rating: 0,
    reviewCount: 0,
    coverImage: "assets/covers/ebook-blueprint.jpg",
    description: "Fifty high-demand ebook ideas and a full beginner-to-advanced guide to writing, designing and selling your first digital product.",
    gumroadLink: "https://REPLACE-gumroad-username.gumroad.com/l/ebook-blueprint",
    creatlyLink: "",
    otherLinkLabel: "",
    otherLink: "",
    previewLink: "https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view",
    featured: false,
    status: "live"
  },
  {
    id: "comeback-blueprint",
    title: "The Comeback Blueprint",
    tagline: "Rebuild focus, confidence and discipline",
    category: "Self-Help",
    price: 149,
    originalPrice: 299,
    pages: 23,
    rating: 0,
    reviewCount: 0,
    coverImage: "assets/covers/comeback-blueprint.jpg",
    description: "A practical, research-grounded 90-day plan for rebuilding after a setback — plus an honest chapter on manifestation hype.",
    gumroadLink: "https://REPLACE-gumroad-username.gumroad.com/l/comeback-blueprint",
    creatlyLink: "",
    otherLinkLabel: "",
    otherLink: "",
    previewLink: "https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view",
    featured: false,
    status: "live"
  },
  {
    id: "relationship-blueprint",
    title: "The Relationship Blueprint",
    tagline: "Build connection, trust and communication that lasts",
    category: "Relationships",
    price: 149,
    originalPrice: 299,
    pages: 23,
    rating: 0,
    reviewCount: 0,
    coverImage: "assets/covers/relationship-blueprint.jpg",
    description: "A research-backed guide to communication, trust and intimacy, with a chapter built for Indian family dynamics.",
    gumroadLink: "https://REPLACE-gumroad-username.gumroad.com/l/relationship-blueprint",
    creatlyLink: "",
    otherLinkLabel: "",
    otherLink: "",
    previewLink: "https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view",
    featured: false,
    status: "live"
  }
];

const SAVED_KEY = "inksprout_saved_books";
let allBooks = [];
let activeCategory = "All";
let activeQuery = "";
let savedOnly = false;
let revealObserver = null;

// ---------------- helpers ----------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

function discountPercent(book) {
  if (!book.originalPrice || book.originalPrice <= book.price) return 0;
  return Math.round(100 - (book.price / book.originalPrice) * 100);
}

function starString(rating) {
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function backendUrl() {
  return (typeof CONFIG !== "undefined" && CONFIG.APPS_SCRIPT_URL || "").trim();
}

function showToast(message, type) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------------- analytics / lead tracking ----------------

function postToBackend(payload) {
  const url = backendUrl();
  if (!url) return Promise.resolve(null);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  }).then(r => r.json()).catch(() => null);
}

function trackEvent(bookId, eventType) {
  const url = backendUrl();
  if (!url) return;
  const payload = JSON.stringify({ action: "track", bookId: bookId, eventType: eventType });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: "text/plain;charset=utf-8" }));
  } else {
    fetch(url, { method: "POST", body: payload, headers: { "Content-Type": "text/plain;charset=utf-8" } }).catch(() => {});
  }
}

async function submitNotifyMe(bookId, email, formEl) {
  const result = await postToBackend({ action: "notifyMe", bookId: bookId, email: email });
  if (result && result.success) {
    formEl.outerHTML = '<p class="notify-success">You\'ll get an email when this is back ✓</p>';
    showToast("You're on the list!", "success");
  } else {
    showToast((result && result.error) || "Couldn't save that — try again.", "error");
  }
}

// ---------------- wishlist (localStorage) ----------------

function getSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); } catch (e) { return []; }
}
function setSaved(arr) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(arr));
  updateSavedCount();
}
function isSaved(id) { return getSaved().includes(id); }
function toggleSaved(id) {
  const saved = getSaved();
  const idx = saved.indexOf(id);
  if (idx === -1) { saved.push(id); showToast("Saved to your list ♥"); }
  else { saved.splice(idx, 1); showToast("Removed from your list"); }
  setSaved(saved);
}
function updateSavedCount() {
  const el = document.getElementById("savedCount");
  if (el) el.textContent = getSaved().length;
}

// ---------------- card building ----------------

function buildCard(book) {
  const card = document.createElement("article");
  card.className = "book-card reveal";
  card.dataset.category = book.category;

  const pct = discountPercent(book);
  const hasRating = Number(book.reviewCount) > 0;
  const soldOut = String(book.status || "").toLowerCase() === "sold-out";
  const saved = isSaved(book.id);

  const links = [];
  if (book.gumroadLink) links.push({ label: `Get on Gumroad — ₹${book.price}`, href: book.gumroadLink, eventType: "buy_gumroad" });
  if (book.creatlyLink) links.push({ label: `Get on Creatly — ₹${book.price}`, href: book.creatlyLink, eventType: "buy_creatly" });
  if (book.otherLink && book.otherLinkLabel) links.push({ label: `${book.otherLinkLabel} — ₹${book.price}`, href: book.otherLink, eventType: "buy_other" });

  card.innerHTML = `
    <div class="book-cover">
      <img src="${escapeHtml(book.coverImage)}" alt="${escapeHtml(book.title)} cover" loading="lazy">
      <button type="button" class="wishlist-btn${saved ? " active" : ""}" data-id="${escapeHtml(book.id)}" aria-label="Save for later">
        <svg viewBox="0 0 24 24" fill="${saved ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.5-4.8-10-9.3C.3 8.4 2 5 5.5 5c2 0 3.4 1 4.5 2.3C11.1 6 12.5 5 14.5 5 18 5 19.7 8.4 18 11.7 15.5 16.2 12 21 12 21z"/></svg>
      </button>
      ${soldOut ? `<span class="book-badge badge-soldout">Sold out</span>` : (pct > 0 ? `<span class="book-badge">${pct}% off</span>` : "")}
    </div>
    <div class="book-info">
      <span class="book-category">${escapeHtml(book.category)}</span>
      <h3 class="book-title qv-trigger" data-id="${escapeHtml(book.id)}" style="cursor:pointer;">${escapeHtml(book.title)}</h3>
      <p class="book-tagline">${escapeHtml(book.tagline)}</p>
      ${hasRating ? `<p class="book-rating"><span aria-hidden="true">${starString(book.rating)}</span> ${book.rating.toFixed(1)} (${book.reviewCount})</p>` : ""}
      <p class="book-meta">${escapeHtml(book.pages)} pages &middot; Instant PDF download</p>
      <div class="book-price">
        <span class="price-now">₹${escapeHtml(book.price)}</span>
        ${book.originalPrice > book.price ? `<span class="price-was">₹${escapeHtml(book.originalPrice)}</span>` : ""}
      </div>
      <div class="book-actions">
        <div class="book-actions-row">
          ${book.previewLink ? `<a class="btn btn-ghost btn-sm preview-link" data-id="${escapeHtml(book.id)}" href="${escapeHtml(book.previewLink)}" target="_blank" rel="noopener">Preview sample</a>` : ""}
          <button type="button" class="share-btn" data-id="${escapeHtml(book.id)}" data-title="${escapeHtml(book.title)}" aria-label="Share this book">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-3.9M8.6 13.5l6.8 3.9"/></svg>
          </button>
        </div>
        ${soldOut
          ? `<form class="notify-form" data-id="${escapeHtml(book.id)}"><input type="email" required placeholder="Your email" aria-label="Email for restock notice"><button type="submit" class="btn btn-primary btn-sm">Notify me</button></form>`
          : links.map(l => `<a class="btn btn-primary btn-sm buy-link" data-id="${escapeHtml(book.id)}" data-event="${l.eventType}" href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join("")}
      </div>
    </div>
  `;

  card.querySelectorAll(".preview-link").forEach(a => a.addEventListener("click", () => trackEvent(a.dataset.id, "preview")));
  card.querySelectorAll(".buy-link").forEach(a => a.addEventListener("click", () => trackEvent(a.dataset.id, a.dataset.event)));
  card.querySelector(".wishlist-btn").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    toggleSaved(btn.dataset.id);
    btn.classList.toggle("active");
    btn.querySelector("svg").setAttribute("fill", btn.classList.contains("active") ? "currentColor" : "none");
    if (savedOnly) render();
  });
  card.querySelector(".qv-trigger").addEventListener("click", () => openQuickView(book.id));
  const img = card.querySelector(".book-cover img");
  img.addEventListener("load", () => img.classList.add("loaded"));
  if (img.complete) img.classList.add("loaded");
  const shareBtn = card.querySelector(".share-btn");
  if (shareBtn) shareBtn.addEventListener("click", () => shareBook(book));
  const notifyForm = card.querySelector(".notify-form");
  if (notifyForm) {
    notifyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = notifyForm.querySelector("input").value;
      submitNotifyMe(book.id, email, notifyForm);
    });
  }

  return card;
}

async function shareBook(book) {
  const url = location.href.split("#")[0] + "#book-" + book.id;
  if (navigator.share) {
    try { await navigator.share({ title: book.title, text: book.tagline, url: url }); }
    catch (e) { /* user cancelled — not an error */ }
  } else {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard");
    } catch (e) {
      showToast("Couldn't copy the link");
    }
  }
}

// ---------------- quick view modal ----------------

function openQuickView(id) {
  const book = allBooks.find(b => b.id === id);
  if (!book) return;
  const pct = discountPercent(book);
  const soldOut = String(book.status || "").toLowerCase() === "sold-out";
  const links = [];
  if (book.gumroadLink) links.push({ label: `Get on Gumroad — ₹${book.price}`, href: book.gumroadLink, eventType: "buy_gumroad" });
  if (book.creatlyLink) links.push({ label: `Get on Creatly — ₹${book.price}`, href: book.creatlyLink, eventType: "buy_creatly" });
  if (book.otherLink && book.otherLinkLabel) links.push({ label: `${book.otherLinkLabel} — ₹${book.price}`, href: book.otherLink, eventType: "buy_other" });

  document.getElementById("qvContent").innerHTML = `
    <img src="${escapeHtml(book.coverImage)}" alt="${escapeHtml(book.title)} cover">
    <div class="qv-body">
      <span class="book-category">${escapeHtml(book.category)}</span>
      <h3 id="qvTitle">${escapeHtml(book.title)}</h3>
      <p class="book-tagline">${escapeHtml(book.tagline)}</p>
      <p>${escapeHtml(book.description || "")}</p>
      <p class="book-meta">${escapeHtml(book.pages)} pages &middot; Instant PDF download</p>
      <div class="book-price">
        <span class="price-now">₹${escapeHtml(book.price)}</span>
        ${book.originalPrice > book.price ? `<span class="price-was">₹${escapeHtml(book.originalPrice)}</span>` : ""}
        ${pct > 0 ? `<span class="book-badge" style="position:static;display:inline-block;">${pct}% off</span>` : ""}
      </div>
      <div class="book-actions">
        ${book.previewLink ? `<a class="btn btn-ghost btn-sm qv-preview" href="${escapeHtml(book.previewLink)}" target="_blank" rel="noopener">Preview sample</a>` : ""}
        ${soldOut ? `<span class="btn btn-ghost btn-sm" style="opacity:0.6;">Currently sold out</span>`
          : links.map(l => `<a class="btn btn-primary btn-sm qv-buy" data-event="${l.eventType}" href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join("")}
      </div>
    </div>
  `;
  document.querySelector(".qv-preview")?.addEventListener("click", () => trackEvent(book.id, "preview"));
  document.querySelectorAll(".qv-buy").forEach(a => a.addEventListener("click", () => trackEvent(book.id, a.dataset.event)));

  document.getElementById("quickViewModal").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeQuickView() {
  document.getElementById("quickViewModal").hidden = true;
  document.body.style.overflow = "";
}

// ---------------- render ----------------

function observeReveal(el) {
  if (!revealObserver) { el.classList.add("revealed"); return; }
  revealObserver.observe(el);
}

function render() {
  const grid = document.getElementById("bookGrid");
  const empty = document.getElementById("emptyState");
  grid.innerHTML = "";

  const q = activeQuery.trim().toLowerCase();
  const saved = getSaved();
  const filtered = allBooks.filter(b => {
    if (b.status && String(b.status).toLowerCase() === "draft") return false;
    if (savedOnly && !saved.includes(b.id)) return false;
    const matchesCategory = activeCategory === "All" || b.category === activeCategory;
    const matchesQuery = !q || (b.title + " " + b.tagline + " " + b.category).toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  if (filtered.length === 0) {
    empty.hidden = false;
    empty.textContent = savedOnly ? "You haven't saved any books yet — tap the heart on a cover to save one." : "No guides match that search. Try a different word or category.";
    return;
  }
  empty.hidden = true;
  const frag = document.createDocumentFragment();
  filtered.forEach((b, i) => {
    const card = buildCard(b);
    card.style.transitionDelay = Math.min(i, 6) * 60 + "ms";
    frag.appendChild(card);
  });
  grid.appendChild(frag);
  grid.querySelectorAll(".reveal").forEach(observeReveal);
}

function renderPills() {
  const wrap = document.getElementById("filterPills");
  const categories = ["All", ...new Set(allBooks.map(b => b.category))];
  wrap.innerHTML = "";
  categories.forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill" + (cat === activeCategory && !savedOnly ? " active" : "");
    btn.textContent = cat;
    btn.addEventListener("click", () => {
      activeCategory = cat;
      savedOnly = false;
      document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
    wrap.appendChild(btn);
  });
}

// ---------------- data loading ----------------

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function setProgress(active) {
  const bar = document.getElementById("topProgress");
  if (!bar) return;
  if (active) { bar.classList.add("active"); bar.style.width = "70%"; }
  else { bar.style.width = "100%"; setTimeout(() => { bar.classList.remove("active"); bar.style.width = "0%"; }, 350); }
}

async function loadBooks() {
  allBooks = FALLBACK_BOOKS;
  renderPills();
  render();

  const url = backendUrl();
  if (!url) return;

  setProgress(true);
  try {
    const res = await fetchWithTimeout(url, (CONFIG.FETCH_TIMEOUT_MS || 6000));
    if (!res.ok) throw new Error("Bad response: " + res.status);
    const data = await res.json();
    if (data && Array.isArray(data.books) && data.books.length > 0) {
      allBooks = data.books.map(b => ({
        ...b,
        price: Number(b.price) || 0,
        originalPrice: Number(b.originalPrice) || 0,
        rating: Number(b.rating) || 0,
        reviewCount: Number(b.reviewCount) || 0
      }));
      renderPills();
      render();
    }
  } catch (err) {
    console.warn("InkSprout: could not load live data, showing fallback.", err);
  } finally {
    setProgress(false);
  }
}

// ---------------- misc UI wiring ----------------

function setupSearch() {
  const input = document.getElementById("searchInput");
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      activeQuery = input.value;
      render();
    }, 150);
  });
}

function setupHeroAnimation() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelector(".hero-shelf").classList.add("settle");
}

function setupPreloader() {
  const start = Date.now();
  const minDisplay = 500;
  const hide = () => {
    const elapsed = Date.now() - start;
    const wait = Math.max(0, minDisplay - elapsed);
    setTimeout(() => {
      const el = document.getElementById("preloader");
      if (el) { el.classList.add("is-hidden"); setTimeout(() => el.remove(), 550); }
    }, wait);
  };
  if (document.readyState === "complete") hide();
  else window.addEventListener("load", hide);
}

function setupReveal() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll(".reveal").forEach(observeReveal);
}

function setupBackToTop() {
  const btn = document.getElementById("backToTop");
  if (!btn) return;
  window.addEventListener("scroll", () => {
    btn.classList.toggle("visible", window.scrollY > 500);
  }, { passive: true });
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

function setupQuickView() {
  document.getElementById("qvClose").addEventListener("click", closeQuickView);
  document.getElementById("quickViewModal").addEventListener("click", (e) => {
    if (e.target.id === "quickViewModal") closeQuickView();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("quickViewModal").hidden) closeQuickView();
  });
}

function setupSavedNav() {
  updateSavedCount();
  document.getElementById("savedNavBtn").addEventListener("click", () => {
    savedOnly = !savedOnly;
    document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
    document.getElementById("library").scrollIntoView({ behavior: "smooth" });
    render();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("year").textContent = new Date().getFullYear();
  setupPreloader();
  setupSearch();
  setupHeroAnimation();
  setupReveal();
  setupBackToTop();
  setupQuickView();
  setupSavedNav();
  loadBooks();
});
