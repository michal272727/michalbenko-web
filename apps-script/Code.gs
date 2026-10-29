/**
 * 10-Second Reply — master Apps Script (one project for your sales pipeline AND all clients).
 *
 * Deploy as Web app: Execute as "Me", access "Anyone". Run setup() once.
 * Script properties (Project settings → Script properties):
 *   SECRET        long random string (used by /api/reply-demo and /api/stripe-webhook)
 *   NOTIFY_EMAIL  michalbenko3@gmail.com
 *   BOOKING_URL   (optional) link used in E1/E2, default https://michalbenko.sk/en/#start
 *
 * Sheets in the master spreadsheet (created by setup()):
 *   Leads    — your own sales leads (demo tries, interest, paid)
 *   Clients  — one row per client (slug, business, owner e-mail, sheet id, token, reply text)
 *   Events   — processed Stripe event ids (idempotency)
 *
 * Triggers: tick() runs every hour (time-driven). No onEdit trigger is needed:
 * statuses are read when tick() runs, so edits made by hand, API or script all work.
 *
 * Mail quota: consumer Gmail 100 recipients/day, Workspace 1,500. tick() stops and warns you early.
 */

var SITE = 'https://michalbenko.sk/en/';
var LEADS_HEAD = ['Created', 'Type', 'Name', 'Email', 'Business', 'Trade', 'Volume', 'Status', 'E1 sent', 'E2 sent', 'E3 sent', 'Source', 'Notes'];
var CLIENT_HEAD = ['Slug', 'Business', 'Owner email', 'Sheet ID', 'Token', 'Reply text', 'Signoff', 'Active', 'Created'];
var CLIENT_LEAD_HEAD = ['Created', 'Name', 'Email', 'Phone', 'Message', 'Status', 'Replied', 'Follow-up sent'];
var STATUS_OPTIONS = ['New', 'Contacted', 'Won', 'Lost'];

/* ---------- setup ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, 'Leads', LEADS_HEAD);
  ensureSheet_(ss, 'Clients', CLIENT_HEAD);
  ensureSheet_(ss, 'Events', ['Event id', 'At']);
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  if (!p.getProperty('NOTIFY_EMAIL')) p.setProperty('NOTIFY_EMAIL', 'michalbenko3@gmail.com');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyHours(1).create();
  Logger.log('Done. SECRET = ' + p.getProperty('SECRET'));
}

function ensureSheet_(ss, name, head) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); }
  return sh;
}

/* ---------- web app ---------- */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = {};
    try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
    var p = e.parameter || {};
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');

    // 1) client website form -> ?client=slug&token=...
    if (p.client) return json_(handleClientLead_(p.client, p.token, body));

    // everything below needs the master secret
    if (!secret || p.key !== secret) return json_({ ok: false, error: 'unauthorized' });

    if (body.type === 'demo' || body.type === 'interest') return json_(handleSalesLead_(body));
    if (body.type === 'stripe') return json_(handleStripe_(body.event));
    return json_({ ok: false, error: 'unknown_type' });
  } catch (err) {
    notify_('10-Second Reply: script error', String(err && err.stack || err));
    return json_({ ok: false, error: 'server_error' });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return json_({ ok: true, service: '10-second-reply' }); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- your own sales leads ---------- */
function handleSalesLead_(b) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads');
  var isInterest = b.type === 'interest';
  var email = String(b.email || '').toLowerCase();
  sh.appendRow([
    new Date(), isInterest ? 'interest' : 'demo', b.name || '', email, b.biz || b.company || '',
    b.trade || '', b.volume || '', isInterest ? 'Interest' : 'New', '', '', '', b.utm || '', b.site ? ('site: ' + b.site) : ''
  ]);
  // an interested lead cancels the E1 nudge for earlier demo rows with the same e-mail
  if (isInterest && email) {
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][3]).toLowerCase() === email && data[i][1] === 'demo' && data[i][7] === 'New') sh.getRange(i + 1, 8).setValue('Interest');
    }
  }
  return { ok: true };
}

/* ---------- Stripe (event already verified by /api/stripe-webhook) ---------- */
function handleStripe_(ev) {
  if (!ev || !ev.id || ev.type !== 'checkout.session.completed') return { ok: true, ignored: true };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var evSh = ss.getSheetByName('Events');
  var ids = evSh.getLastRow() > 1 ? evSh.getRange(2, 1, evSh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  if (ids.indexOf(ev.id) !== -1) return { ok: true, duplicate: true };
  evSh.appendRow([ev.id, new Date()]);

  var s = ev.data && ev.data.object || {};
  var cd = s.customer_details || {};
  var fields = {};
  (s.custom_fields || []).forEach(function (f) {
    fields[f.key] = (f.text && f.text.value) || (f.dropdown && f.dropdown.value) || (f.numeric && f.numeric.value) || '';
  });
  var email = String(cd.email || '').toLowerCase();
  var business = fields.businessname || cd.business_name || cd.name || '';
  var alertEmail = fields.alertemail || email;
  var website = fields.website || '';
  var platform = fields.formplatform || '';

  // mark / add in Leads
  var sh = ss.getSheetByName('Leads');
  var data = sh.getDataRange().getValues();
  var row = -1;
  for (var i = data.length - 1; i >= 1; i--) if (String(data[i][3]).toLowerCase() === email) { row = i + 1; break; }
  if (row === -1) { sh.appendRow([new Date(), 'paid', cd.name || '', email, business, '', '', 'Paid', '', '', '', 'stripe', '']); row = sh.getLastRow(); }
  sh.getRange(row, 8).setValue('Paid');
  sh.getRange(row, 13).setValue('site: ' + website + ' | platform: ' + platform + ' | alerts: ' + alertEmail);

  // create the client's lead sheet and share it
  var slug = makeSlug_(business || email);
  var token = Utilities.getUuid().replace(/-/g, '');
  var clientSs = SpreadsheetApp.create('Leads — ' + (business || slug));
  var csh = clientSs.getSheets()[0];
  csh.setName('Leads');
  csh.appendRow(CLIENT_LEAD_HEAD); csh.setFrozenRows(1); csh.getRange(1, 1, 1, CLIENT_LEAD_HEAD.length).setFontWeight('bold');
  csh.getRange('F2:F1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS_OPTIONS, true).build());
  try { clientSs.addEditor(alertEmail); } catch (err) { notify_('Could not share client sheet', alertEmail + ' — ' + err); }

  ss.getSheetByName('Clients').appendRow([
    slug, business, alertEmail, clientSs.getId(), token,
    'Thanks for getting in touch with {business}. We have your enquiry and will come back to you shortly. If it is urgent, just reply to this email.',
    business, 'FALSE', new Date()   // Active stays FALSE until you flip it to TRUE after testing
  ]);

  var url = ScriptApp.getService().getUrl();
  var first = firstName_(cd.name);
  var cfg = getCfg_();
  mail_(email, 'Welcome. 3 things I need from you', '' +
    'Hi ' + first + ',\n\nPayment received, thanks. To go live within 48 hours I need two lines from you:\n\n' +
    '1) How should the reply to your customers sound? Two lines about ' + (business || 'your business') + ' are enough.\n' +
    '2) Anything I should know about your form (e.g. a plugin, a landing page, more than one form)?\n\n' +
    'I already have your website (' + (website || 'not given') + ') and alert address (' + alertEmail + ').\n' +
    'I shared a Google Sheet "Leads — ' + (business || slug) + '" with ' + alertEmail + '. Every enquiry will land there; set the Status column to Contacted once you have spoken to a lead.\n\n' +
    'By ordering you agree to the processing terms: ' + SITE + 'privacy/#processor\n\nMichal', 'Michal Benko');
  notify_('NEW CLIENT: ' + (business || email),
    'Business: ' + business + '\nEmail: ' + email + '\nSite: ' + website + '\nPlatform: ' + platform + '\nAlerts: ' + alertEmail +
    '\n\nClient webhook URL:\n' + url + '?client=' + slug + '&token=' + token +
    '\n\nSheet: ' + clientSs.getUrl() + '\n\nTo go live: set Active = TRUE in the Clients tab, send a test, then mark the Leads row "Live" (sends E3).');
  return { ok: true, slug: slug };
}

/* ---------- client form webhook ---------- */
function handleClientLead_(slug, token, b) {
  var c = findClient_(slug);
  if (!c || c.token !== token) return { ok: false, error: 'unauthorized' };
  if (!c.active) return { ok: false, error: 'inactive' };
  var name = clean_(b.name, 120), email = clean_(b.email, 160), phone = clean_(b.phone, 40), msg = clean_(b.message, 1500);
  if (!email || email.indexOf('@') < 1) return { ok: false, error: 'email_required' };
  var csh = SpreadsheetApp.openById(c.sheetId).getSheetByName('Leads');
  csh.appendRow([new Date(), name, email, phone, msg, 'New', '', '']);
  var rowNum = csh.getLastRow();

  var first = firstName_(name);
  var text = c.replyText.replace(/\{business\}/g, c.business).replace(/\{name\}/g, first);
  mail_(email, 'Thanks for your enquiry, ' + first + ' — ' + c.business,
    'Hi ' + first + ',\n\n' + text + '\n\n' + (c.signoff || c.business), c.business, c.owner);
  csh.getRange(rowNum, 7).setValue(new Date());

  mail_(c.owner, 'New enquiry: ' + (name || email),
    'New enquiry — already answered.\n\nName: ' + name + '\nEmail: ' + email + '\nPhone: ' + phone + '\nMessage: ' + msg +
    '\n\nReply: mailto:' + email + '\nSheet: https://docs.google.com/spreadsheets/d/' + c.sheetId + '\n\n' +
    'Set Status to "Contacted" after you speak to them, otherwise a polite follow-up goes out after 24 hours.', c.business + ' alerts');
  return { ok: true };
}

/* ---------- hourly job ---------- */
function tick() {
  var guard = 12;
  if (MailApp.getRemainingDailyQuota() < guard) { notify_('Mail quota almost used', 'Remaining: ' + MailApp.getRemainingDailyQuota()); return; }
  followUps_();
  salesEmails_();
}

// client follow-ups: Status still New, 24-72 h old, not yet followed up
function followUps_() {
  var clients = getClients_();
  clients.forEach(function (c) {
    if (!c.active) return;
    var sh;
    try { sh = SpreadsheetApp.openById(c.sheetId).getSheetByName('Leads'); } catch (err) { notify_('Client sheet unreachable: ' + c.slug, String(err)); return; }
    var data = sh.getDataRange().getValues();
    var now = Date.now();
    for (var i = 1; i < data.length; i++) {
      var created = data[i][0], email = data[i][2], status = String(data[i][5] || 'New'), done = data[i][7];
      if (!(created instanceof Date) || !email || done || status !== 'New') continue;
      var age = (now - created.getTime()) / 36e5;
      if (age < 24 || age > 72) continue;
      if (MailApp.getRemainingDailyQuota() < 5) return;
      var first = firstName_(data[i][1]);
      mail_(email, 'Quick follow-up from ' + c.business,
        'Hi ' + first + ',\n\nJust checking in on your recent enquiry with ' + c.business + '. Have you had the chance to speak to us yet? If not, reply to this email or call us and we will get you sorted.\n\n' + (c.signoff || c.business),
        c.business, c.owner);
      sh.getRange(i + 1, 8).setValue(new Date());
    }
  });
}

// your sales e-mails: E1 (24 h after demo, still New) and E3 (Status = Live)
function salesEmails_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads');
  var data = sh.getDataRange().getValues();
  var now = Date.now();
  var url = PropertiesService.getScriptProperties().getProperty('BOOKING_URL') || (SITE + '#start');
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var created = r[0], type = r[1], name = r[2], email = r[3], biz = r[4], status = r[7], e1 = r[8], e3 = r[10];
    if (!email) continue;
    if (type === 'demo' && status === 'New' && !e1 && created instanceof Date) {
      var age = (now - created.getTime()) / 36e5;
      if (age >= 24 && age <= 72 && MailApp.getRemainingDailyQuota() > 5) {
        mail_(email, 'Did the demo reply make it to your inbox?',
          'Hi ' + firstName_(name) + ',\n\nYou tried the 10-Second Reply demo yesterday. If your own enquiries get answered like that, they don\'t go cold overnight.\n\n' +
          '€49/month, live within 48 hours, no setup fee. Want it for ' + (biz || 'your business') + '?\n' + url + '\n\n' +
          'If this isn\'t for you, ignore this e-mail; I won\'t send another.\n\nMichal Benko, michalbenko.sk', 'Michal Benko');
        sh.getRange(i + 1, 9).setValue(new Date());
      }
    }
    if (status === 'Live' && !e3 && MailApp.getRemainingDailyQuota() > 5) {
      mail_(email, 'You\'re live ✅',
        'Hi ' + firstName_(name) + ',\n\nYour 10-Second Reply is live. Send a test enquiry through your own form and check your inbox. If it doesn\'t arrive within a minute, reply here and I\'ll fix it the same day.\n\nMichal', 'Michal Benko');
      sh.getRange(i + 1, 11).setValue(new Date());
      activateClientByEmail_(email);
    }
  }
}

function activateClientByEmail_(email) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Clients');
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (String(d[i][2]).toLowerCase() === String(email).toLowerCase()) sh.getRange(i + 1, 8).setValue('TRUE');
}

/* ---------- helpers ---------- */
function getCfg_() { return PropertiesService.getScriptProperties().getProperties(); }

function getClients_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Clients');
  var d = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) {
    if (!d[i][0]) continue;
    out.push({ slug: d[i][0], business: d[i][1], owner: d[i][2], sheetId: d[i][3], token: String(d[i][4]), replyText: d[i][5], signoff: d[i][6], active: String(d[i][7]).toUpperCase() === 'TRUE' });
  }
  return out;
}
function findClient_(slug) { var c = getClients_().filter(function (x) { return x.slug === slug; }); return c[0] || null; }

function mail_(to, subject, body, senderName, replyTo) {
  var o = { to: to, subject: subject, body: body, name: senderName || 'Michal Benko' };
  if (replyTo) o.replyTo = replyTo;
  MailApp.sendEmail(o);
}
function notify_(subject, body) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL') || 'michalbenko3@gmail.com';
  try { MailApp.sendEmail({ to: to, subject: subject, body: body }); } catch (e) {}
}
function clean_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function firstName_(n) { var f = String(n || '').trim().split(/\s+/)[0]; return f || 'there'; }
function makeSlug_(s) {
  var base = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'client';
  var taken = getClients_().map(function (c) { return c.slug; });
  var slug = base, n = 2;
  while (taken.indexOf(slug) !== -1) slug = base + '-' + n++;
  return slug;
}
