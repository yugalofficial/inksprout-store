/**
 * ============================================================
 * InkSprout Store — Apps Script backend (public API + admin)
 * ============================================================
 * Public, read-only JSON API for the storefront (doGet), plus an
 * authenticated write API for the admin dashboard (doPost).
 *
 * SETUP: see README.md. Quick version:
 * 1. Paste this whole file into Extensions > Apps Script.
 * 2. Run `setup` once from the toolbar (approve permissions).
 * 3. Set your admin password WITHOUT putting it in code:
 *      Project Settings (gear icon) > Script Properties >
 *      Add property: key = ADMIN_PASSWORD, value = your password.
 * 4. Deploy > New deployment > Web app.
 *      Execute as: Me — Who has access: Anyone
 * 5. Copy the Web app URL into config.js (same URL for public
 *    site AND admin.html — both use the one endpoint).
 *
 * SECURITY MODEL, HONESTLY:
 * - doGet() is public and read-only (live books only).
 * - doPost() handles admin actions (add/edit/delete/list-all) and
 *   requires a session token obtained via a correct password.
 * - The password itself lives only in Script Properties — never
 *   in this file, never in your GitHub repo.
 * - Sessions are server-side tokens (CacheService), valid 6 hours
 *   (the Apps Script cache maximum), not a password sent on every
 *   request after login.
 * - `track` (click analytics) and `notifyMe` (sold-out email capture)
 *   are intentionally unauthenticated — `track` only ever increments
 *   a count, and `notifyMe` only ever appends one row (an email tied
 *   to a real book id); neither can read anything back to the caller.
 * - This is solid for a personal storefront. It is not bank-grade
 *   infrastructure, and there's no rate-limiting beyond what
 *   Google's own Apps Script quotas enforce — said plainly rather
 *   than oversold.
 * ============================================================
 */

const SHEET_NAME = 'Books';
const EVENTS_SHEET_NAME = 'Events';
const LEADS_SHEET_NAME = 'Leads';
const CACHE_KEY_PREFIX = 'inksprout_books_';
const CACHE_SECONDS = 300;
const SESSION_SECONDS = 21600; // 6 hours — CacheService's maximum.
const LEAD_HEADERS = ['timestamp', 'bookId', 'email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email alerts — see README "Email alerts" section for setup.
// Controlled by two Script Properties (both optional):
//   EMAIL_ALERTS = "off"  → disables all alert emails (default: on)
//   ALERT_EMAIL  = "you@example.com"  → where alerts go
//                  (defaults to your own Apps Script account email)
const BUY_CLICK_ALERT_COOLDOWN_SECONDS = 600; // max one buy-click email per book per 10 min

const HEADERS = [
  'id', 'title', 'tagline', 'category',
  'price', 'originalPrice', 'pages',
  'rating', 'reviewCount',
  'coverImage', 'description',
  'gumroadLink', 'creatlyLink', 'otherLinkLabel', 'otherLink',
  'previewLink', 'featured', 'status'
];
// status: 'live' | 'draft' | 'sold-out'

const EVENT_HEADERS = ['timestamp', 'bookId', 'eventType'];
const VALID_EVENT_TYPES = ['preview', 'buy_gumroad', 'buy_creatly', 'buy_other'];

const SEED_DATA = [
  ['side-income', 'Your First ₹10,000', '10 real side income ideas for India', 'Side Income',
    149, 299, 30, 0, 0,
    'assets/covers/side-income.jpg',
    'Ten honest, beginner-friendly ways to earn extra income in India, with realistic ranges and a 90-day plan.',
    'https://REPLACE-gumroad-username.gumroad.com/l/side-income', '', '', '',
    'https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view', true, 'live'],

  ['ebook-blueprint', 'The Ebook Blueprint', '50 ideas, plus how to write, design & sell your own', 'Creator Tools',
    149, 299, 27, 0, 0,
    'assets/covers/ebook-blueprint.jpg',
    'Fifty high-demand ebook ideas and a full beginner-to-advanced guide to writing, designing and selling your first digital product.',
    'https://REPLACE-gumroad-username.gumroad.com/l/ebook-blueprint', '', '', '',
    'https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view', false, 'live'],

  ['comeback-blueprint', 'The Comeback Blueprint', 'Rebuild focus, confidence and discipline', 'Self-Help',
    149, 299, 23, 0, 0,
    'assets/covers/comeback-blueprint.jpg',
    'A practical, research-grounded 90-day plan for rebuilding after a setback — plus an honest chapter on manifestation hype.',
    'https://REPLACE-gumroad-username.gumroad.com/l/comeback-blueprint', '', '', '',
    'https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view', false, 'live'],

  ['relationship-blueprint', 'The Relationship Blueprint', 'Build connection, trust and communication that lasts', 'Relationships',
    149, 299, 23, 0, 0,
    'assets/covers/relationship-blueprint.jpg',
    'A research-backed guide to communication, trust and intimacy, with a chapter built for Indian family dynamics.',
    'https://REPLACE-gumroad-username.gumroad.com/l/relationship-blueprint', '', '', '',
    'https://drive.google.com/file/d/REPLACE_WITH_FILE_ID/view', false, 'live'],
];

/** Convenience menu when you open the Sheet. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('InkSprout Admin')
      .addItem('Run setup (safe — won\'t erase existing data)', 'setup')
      .addItem('Reset Books sheet to sample data', 'resetSeedData')
      .addItem('Clear API cache', 'clearCache')
      .addToUi();
  } catch (e) { /* no UI outside Sheets context */ }
}

/** Safe to run any time — creates sheets/headers only if missing. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let created = false;

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(SHEET_NAME); created = true; }
  const hasHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0].join('') !== '';
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#2A1B6B').setFontColor('#FFC93C');
    sheet.autoResizeColumns(1, HEADERS.length);
  }
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, SEED_DATA.length, HEADERS.length).setValues(SEED_DATA);
  }

  let events = ss.getSheetByName(EVENTS_SHEET_NAME);
  if (!events) events = ss.insertSheet(EVENTS_SHEET_NAME);
  const eventsHasHeaders = events.getRange(1, 1, 1, EVENT_HEADERS.length).getValues()[0].join('') !== '';
  if (!eventsHasHeaders) {
    events.getRange(1, 1, 1, EVENT_HEADERS.length).setValues([EVENT_HEADERS]);
    events.setFrozenRows(1);
    events.getRange(1, 1, 1, EVENT_HEADERS.length).setFontWeight('bold').setBackground('#2A1B6B').setFontColor('#FFC93C');
  }

  let leads = ss.getSheetByName(LEADS_SHEET_NAME);
  if (!leads) leads = ss.insertSheet(LEADS_SHEET_NAME);
  const leadsHasHeaders = leads.getRange(1, 1, 1, LEAD_HEADERS.length).getValues()[0].join('') !== '';
  if (!leadsHasHeaders) {
    leads.getRange(1, 1, 1, LEAD_HEADERS.length).setValues([LEAD_HEADERS]);
    leads.setFrozenRows(1);
    leads.getRange(1, 1, 1, LEAD_HEADERS.length).setFontWeight('bold').setBackground('#2A1B6B').setFontColor('#FFC93C');
  }

  clearCache();
  const hasPassword = !!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  notify(
    (created ? 'Setup complete — Books and Events sheets created with sample data.\n\n' : 'Setup checked — sheets already existed, nothing was overwritten.\n\n') +
    (hasPassword ? 'Admin password is set.' : '⚠ Admin password is NOT set yet. Go to Project Settings → Script Properties → add ADMIN_PASSWORD before using admin.html.')
  );
}

/** Destructive: wipes the Books sheet back to sample data. */
function resetSeedData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#2A1B6B').setFontColor('#FFC93C');
  sheet.getRange(2, 1, SEED_DATA.length, HEADERS.length).setValues(SEED_DATA);
  sheet.autoResizeColumns(1, HEADERS.length);
  clearCache();
  notify('Books sheet reset to sample data.');
}

function clearCache() {
  CacheService.getScriptCache().removeAll(['all', ...getCategories()].map(c => CACHE_KEY_PREFIX + c));
}
function getCategories() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const catIdx = headers.indexOf('category');
    return [...new Set(data.map(r => r[catIdx]).filter(Boolean))];
  } catch (e) { return []; }
}
function notify(message) {
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { Logger.log(message); }
}

/** Sends an email alert, unless EMAIL_ALERTS is explicitly turned off.
  * Failures are swallowed — a broken alert should never break the
  * actual request (a lead save or a click track) that triggered it. */
function sendAlertEmail(subject, body) {
  try {
    var props = PropertiesService.getScriptProperties();
    if ((props.getProperty('EMAIL_ALERTS') || '').toLowerCase() === 'off') return;
    var to = props.getProperty('ALERT_EMAIL') || Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail(to, subject, body);
  } catch (e) {
    Logger.log('Alert email failed: ' + e.message);
  }
}

function bookTitle(bookId) {
  var b = readBooks().find(function(x) { return x.id === bookId; });
  return b ? b.title : bookId;
}
function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Public, read-only. ?category=X optional filter. Cached for speed. */
function doGet(e) {
  const category = (e && e.parameter && e.parameter.category) || 'all';
  const cacheKey = CACHE_KEY_PREFIX + category;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  const books = readBooks().filter(b => String(b.status || 'live').toLowerCase() !== 'draft')
                            .filter(b => category === 'all' || b.category === category);
  const payload = JSON.stringify({ books: books, generatedAt: new Date().toISOString() });
  cache.put(cacheKey, payload, CACHE_SECONDS);
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function readBooks() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data.filter(function(row) { return row.some(function(c) { return c !== ''; }); })
             .map(function(row) { var o = {}; headers.forEach(function(h, i) { o[h] = row[i]; }); return o; });
}

/** All writes + admin reads go through here. */
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents || '{}'); }
  catch (err) { return jsonOutput({ success: false, error: 'Invalid request body.' }); }

  switch (body.action) {
    case 'login': return handleLogin(body);
    case 'listAdmin': return withAuth(body, handleListAdmin);
    case 'addBook': return withAuth(body, handleAddBook);
    case 'updateBook': return withAuth(body, handleUpdateBook);
    case 'deleteBook': return withAuth(body, handleDeleteBook);
    case 'analytics': return withAuth(body, handleAnalytics);
    case 'track': return handleTrack(body); // intentionally unauthenticated, see header note
    case 'notifyMe': return handleNotifyMe(body); // intentionally unauthenticated, see header note
    case 'listLeads': return withAuth(body, handleListLeads);
    default: return jsonOutput({ success: false, error: 'Unknown action.' });
  }
}

function handleLogin(body) {
  var pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pw) return jsonOutput({ success: false, error: 'Admin password not set on the server yet. See README.' });
  if (body.password !== pw) return jsonOutput({ success: false, error: 'Incorrect password.' });
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('session_' + token, 'valid', SESSION_SECONDS);
  return jsonOutput({ success: true, token: token, expiresInSeconds: SESSION_SECONDS });
}

function withAuth(body, handler) {
  var token = body.token;
  var valid = token && CacheService.getScriptCache().get('session_' + token);
  if (!valid) return jsonOutput({ success: false, error: 'Session expired. Please log in again.', authError: true });
  CacheService.getScriptCache().put('session_' + token, 'valid', SESSION_SECONDS); // refresh on activity
  return handler(body);
}

function handleListAdmin() {
  return jsonOutput({ success: true, books: readBooks(), analytics: summarizeEvents() });
}

function handleAddBook(body) {
  var b = body.book || {};
  if (!b.id) return jsonOutput({ success: false, error: 'Book id is required.' });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var existing = readBooks();
  if (existing.some(function(r) { return r.id === b.id; })) return jsonOutput({ success: false, error: 'A book with that id already exists.' });
  var row = HEADERS.map(function(h) { return b[h] !== undefined ? b[h] : ''; });
  sheet.appendRow(row);
  clearCache();
  return jsonOutput({ success: true, books: readBooks() });
}

function handleUpdateBook(body) {
  var b = body.book || {};
  if (!b.id) return jsonOutput({ success: false, error: 'Book id is required.' });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('id');
  for (var r = 1; r < data.length; r++) {
    if (data[r][idCol] === b.id) {
      var row = HEADERS.map(function(h) { return b[h] !== undefined ? b[h] : data[r][headers.indexOf(h)]; });
      sheet.getRange(r + 1, 1, 1, HEADERS.length).setValues([row]);
      clearCache();
      return jsonOutput({ success: true, books: readBooks() });
    }
  }
  return jsonOutput({ success: false, error: 'Book not found.' });
}

function handleDeleteBook(body) {
  var id = body.id;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('id');
  for (var r = 1; r < data.length; r++) {
    if (data[r][idCol] === id) {
      sheet.deleteRow(r + 1);
      clearCache();
      return jsonOutput({ success: true, books: readBooks() });
    }
  }
  return jsonOutput({ success: false, error: 'Book not found.' });
}

function handleAnalytics() {
  return jsonOutput({ success: true, analytics: summarizeEvents() });
}

/** Unauthenticated by design — only ever increments a simple count. */
function handleTrack(body) {
  if (VALID_EVENT_TYPES.indexOf(body.eventType) === -1) return jsonOutput({ success: false });
  var books = readBooks();
  if (!books.some(function(b) { return b.id === body.bookId; })) return jsonOutput({ success: false });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVENTS_SHEET_NAME);
  if (sheet) sheet.appendRow([new Date().toISOString(), body.bookId, body.eventType]);

  if (body.eventType.indexOf('buy_') === 0) {
    var cache = CacheService.getScriptCache();
    var cooldownKey = 'buyalert_' + body.bookId;
    if (!cache.get(cooldownKey)) {
      cache.put(cooldownKey, '1', BUY_CLICK_ALERT_COOLDOWN_SECONDS);
      var platform = body.eventType.replace('buy_', '');
      sendAlertEmail(
        '🛒 Buy-link click: ' + bookTitle(body.bookId),
        'Someone clicked through to buy "' + bookTitle(body.bookId) + '" on ' + platform + '.\n\n' +
        'Time: ' + new Date().toLocaleString() + '\n\n' +
        'This only counts a click, not a confirmed sale — check ' + platform + ' for actual orders.\n' +
        'To avoid inbox noise, you\'ll get at most one of these per book every ' + Math.round(BUY_CLICK_ALERT_COOLDOWN_SECONDS/60) + ' minutes.\n' +
        '(Turn these emails off anytime: Script Properties → EMAIL_ALERTS = off)'
      );
    }
  }

  return jsonOutput({ success: true });
}

/** Unauthenticated by design — captures an email for a "notify me" request.
  * Validated against a real book id and a basic email shape; only ever
  * appends one row, never reads anything back to the caller. */
function handleNotifyMe(body) {
  var email = String(body.email || '').trim();
  if (!EMAIL_RE.test(email)) return jsonOutput({ success: false, error: 'Please enter a valid email.' });
  var books = readBooks();
  if (!books.some(function(b) { return b.id === body.bookId; })) return jsonOutput({ success: false, error: 'Unknown book.' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEADS_SHEET_NAME);
  if (sheet) sheet.appendRow([new Date().toISOString(), body.bookId, email]);

  sendAlertEmail(
    '📬 New InkSprout lead: ' + bookTitle(body.bookId),
    'Someone wants to be notified when "' + bookTitle(body.bookId) + '" is back.\n\n' +
    'Email: ' + email + '\n' +
    'Time: ' + new Date().toLocaleString() + '\n\n' +
    '(Turn these emails off anytime: Script Properties → EMAIL_ALERTS = off)'
  );

  return jsonOutput({ success: true });
}

function handleListLeads() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LEADS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return jsonOutput({ success: true, leads: [], totalsByBook: {} });
  var data = sheet.getDataRange().getValues();
  data.shift();
  var leads = data.map(function(r) { return { timestamp: r[0], bookId: r[1], email: r[2] }; });
  var totalsByBook = {};
  leads.forEach(function(l) { totalsByBook[l.bookId] = (totalsByBook[l.bookId] || 0) + 1; });
  return jsonOutput({ success: true, leads: leads, totalsByBook: totalsByBook });
}

function summarizeEvents() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVENTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { totals: {}, byBook: {} };

  var data = sheet.getDataRange().getValues();
  data.shift();
  var totals = {};
  var byBook = {};
  data.forEach(function(rowArr) {
    var bookId = rowArr[1], eventType = rowArr[2];
    totals[eventType] = (totals[eventType] || 0) + 1;
    byBook[bookId] = byBook[bookId] || {};
    byBook[bookId][eventType] = (byBook[bookId][eventType] || 0) + 1;
  });
  return { totals: totals, byBook: byBook };
}
