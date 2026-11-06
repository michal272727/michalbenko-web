/**
 * Meta funnel A/B/C: Apps Script (bez Zapieru okrem vstupu).
 * Zapier (spúšťač Facebook Lead Ads) -> 1 akcia Webhooks POST na <exec URL>?key=SECRET&f=A|B|C
 * Telo: JSON so všetkými poľami leadu (id, full_name, email, company_name + otázky z formulára).
 * Script robí: duplicitu, zápis do Sheetu, krátke poďakovanie leadovi, upozornenie Michalovi s odpoveďami, detekciu odpovede, uzavretie po 14 dňoch.
 * Mail ide z Gmailu michalbenko3. Žiadne telefonáty ani SMS.
 */
var SHEET_ID = '1CmysWFwAFk91DocRa5OAMqEsUrtQEHUeB7GTz4F4S18';
var TAB = 'Leady';
var NOTIFY = 'michalbenko3@gmail.com';
var FROM_NAME = 'Michal Benko';
// stĺpce (1-based) podľa hlavičky Sheetu
var C = { id: 1, recv: 2, funnel: 3, vetva: 4, name: 5, email: 6, tel: 7, firma: 8, web: 9, q1: 10, q2: 11, q3: 12, stav: 13, e1: 14, demo: 15, brief: 16, replied: 17, fu1: 18, fu2: 19, closed: 20, note: 21 };
var STAV = { novy: 'Nový', e1: 'E-mail 1 poslaný', odpovedal: 'Odpovedal', fu1: 'Follow-up 1 poslaný', fu2: 'Follow-up 2 poslaný', closed: 'Uzavretý – bez reakcie' };
var STOP = ['Odpovedal', 'Rozpracované (ja)', 'Zákazník', 'Nezáujem', 'Uzavretý – bez reakcie', 'Skúsil ukážku', 'Brief vyplnený'];
var DAY = 24 * 3600 * 1000;

function sheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB); }
function secret_() { return PropertiesService.getScriptProperties().getProperty('SECRET'); }
function norm_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function pick_(lead, needles) {
  for (var k in lead) { var nk = norm_(k); for (var i = 0; i < needles.length; i++) if (nk.indexOf(needles[i]) >= 0) return String(lead[k] || '').trim(); }
  return '';
}
function demoLink_(id, name, email) {
  return 'https://michalbenko.sk/ponuky/?id=' + encodeURIComponent(id) + '&n=' + encodeURIComponent(name) + '&e=' + encodeURIComponent(email);
}

/* ---------- vstup ---------- */
function doPost(e) {
  var p = e.parameter || {};
  if (!secret_() || p.key !== secret_()) return json_({ ok: false, error: 'forbidden' });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var lead = JSON.parse((e.postData && e.postData.contents) || '{}');
    var f = String(p.f || '').toUpperCase();
    if (['A', 'B', 'C'].indexOf(f) < 0) return json_({ ok: false, error: 'bad_funnel' });
    return json_(handleLead_(f, lead));
  } catch (err) {
    MailApp.sendEmail(NOTIFY, 'Chyba funnelu', String(err && err.stack || err));
    return json_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handleLead_(f, lead) {
  var sh = sheet_();
  var id = String(lead.id || '').trim();
  var name = String(lead.full_name || '').trim();
  var email = String(lead.email || '').trim().toLowerCase();
  var firma = String(lead.company_name || '').trim();
  if (!id) id = 'L' + Date.now();
  var ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(function (r) { return String(r[0]); });
  if (ids.indexOf(id) >= 0) return { ok: true, skipped: 'duplicate' };

  var q1 = pick_(lead, ['ako dnes', 'aky web', 'co chcete', 'ktory proces', 'proces']);
  var q2 = pick_(lead, ['kolko', 'kedy', 'rozsah', 'frekvenc', 'ako casto']);
  var q3 = pick_(lead, ['web alebo', 'zaobera', 'socialn', 'nastroj', 'pouzivate']);
  var vetva = f === 'A' ? vetvaA_(q2) : f;

  var row = [];
  for (var i = 0; i < 21; i++) row.push('');
  row[C.id - 1] = id; row[C.recv - 1] = new Date(); row[C.funnel - 1] = f; row[C.vetva - 1] = vetva || '';
  row[C.name - 1] = name; row[C.email - 1] = email; row[C.firma - 1] = firma;
  row[C.web - 1] = f === 'A' ? q3 : ''; row[C.q1 - 1] = q1; row[C.q2 - 1] = q2; row[C.q3 - 1] = q3; row[C.stav - 1] = STAV.novy;
  sh.appendRow(row);
  var r = sh.getLastRow();

  if (!email) {
    sh.getRange(r, C.note).setValue('Chýba e-mail, e-mail 1 sa neposlal.');
    MailApp.sendEmail(NOTIFY, 'Lead bez e-mailu 1: ' + name, 'Pozri Sheet: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
    return { ok: true, sent: false };
  }
  var m = email1_(f, vetva, firma, name, id, email);
  GmailApp.sendEmail(email, m.subject, m.body, { name: FROM_NAME });
  sh.getRange(r, C.stav).setValue(STAV.e1);
  sh.getRange(r, C.e1).setValue(new Date());
  MailApp.sendEmail(NOTIFY, 'Nový lead ' + f + ': ' + (firma || name), 'Meno: ' + name + '\nE-mail: ' + email + '\nFirma: ' + firma + '\n\nQ1: ' + q1 + '\nQ2: ' + q2 + '\nQ3: ' + q3 + '\n\nOdoslal som poďakovanie. Teraz mu napíš ty.\nSheet: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
  return { ok: true, sent: true, vetva: vetva };
}

function vetvaA_(q2) {
  var n = norm_(q2);
  if (!n) return null;
  if (n.indexOf('do 20') === 0) return 'A3';
  if (n.indexOf('viac') >= 0) return 'A1';
  if (n.indexOf('20') >= 0 && n.indexOf('50') >= 0) return 'A2';
  return null;
}

/* ---------- e-mail 1 (krátke poďakovanie + krok, ktorý môže lead spraviť hneď) ---------- */
function email1_(f, vetva, firma, name, id, email) {
  var sign = '\n\nMichal Benko\nmichalbenko.sk';
  if (f === 'A') {
    return { subject: 'Ďakujem, ukážku ponuky máte tu', body: ['Dobrý deň,', '', 'ďakujem za vyplnený formulár. Ozvem sa vám písomne do 24 hodín.', '', 'Ak si chcete systém vyskúšať hneď, zaberie to 2 minúty: zadáte parametre a do minúty vám príde cena aj ponuka na e-mail:', demoLink_(id, name, email)].join('\n') + sign };
  }
  if (f === 'B') {
    return { subject: 'Ďakujem, ozvem sa do 24 hodín', body: ['Dobrý deň,', '', 'ďakujem za vyplnený formulár. Ozvem sa vám písomne do 24 hodín.', '', 'Ak chcete urýchliť, odpovedzte na tento e-mail dvoma vetami: čo ponúkate a komu. Podľa toho vám hneď navrhnem, ako by stránka vyzerala.'].join('\n') + sign };
  }
  return { subject: 'Ďakujem, ozvem sa do 24 hodín', body: ['Dobrý deň,', '', 'ďakujem za vyplnený formulár. Ozvem sa vám písomne do 24 hodín.', '', 'Ak chcete urýchliť, odpovedzte na tento e-mail jednou vetou: kedy sa daný úkon u vás dnes deje a čo sa má potom urobiť. Podľa toho vám hneď napíšem, ako by to fungovalo.'].join('\n') + sign };
}

/* ---------- hodinový časovač ---------- */
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SECRET')) p.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyHours(1).create();
  Logger.log('SECRET = ' + p.getProperty('SECRET'));
}

function tick() {
  var sh = sheet_(); var n = sh.getLastRow() - 1; if (n < 1) return;
  var data = sh.getRange(2, 1, n, 21).getValues();
  var now = Date.now();
  for (var i = 0; i < data.length; i++) {
    var row = data[i], r = i + 2;
    var stav = row[C.stav - 1], email = String(row[C.email - 1] || '').trim(), f = row[C.funnel - 1];
    var e1 = row[C.e1 - 1];
    if (!email || !e1 || STOP.indexOf(stav) >= 0) continue;
    // odpoveď leadu = e-mail od neho v Gmaile po odoslaní e-mailu 1
    var since = Utilities.formatDate(new Date(e1), 'Europe/Bratislava', 'yyyy/MM/dd');
    var th = GmailApp.search('from:' + email + ' after:' + since, 0, 1);
    if (th.length) {
      sh.getRange(r, C.stav).setValue(STAV.odpovedal); sh.getRange(r, C.replied).setValue(new Date());
      MailApp.sendEmail(NOTIFY, 'Odpoveď leadu: ' + (row[C.firma - 1] || row[C.name - 1]) + ' (funnel ' + f + ')', 'Lead odpovedal z ' + email + '\nSheet: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
      continue;
    }
    var age = now - new Date(e1).getTime();
    if (stav === STAV.e1 && age >= 14 * DAY) {
      sh.getRange(r, C.stav).setValue(STAV.closed); sh.getRange(r, C.closed).setValue(new Date());
    }
  }
}
