/**
 * Meta funnel A/B/C: Apps Script (bez Zapieru okrem vstupu).
 * Zapier (spúšťač Facebook Lead Ads) -> 1 akcia Webhooks POST na <exec URL>?key=SECRET&f=A|B|C
 * Telo: JSON so všetkými poľami leadu (id, full_name, email, company_name + otázky z formulára).
 * Script robí: duplicitu, zápis do Sheetu, jeden e-mail po vyplnení, detekciu odpovede, uzavretie po 14 dňoch, upozornenia.
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

  if (!email || !vetva) {
    sh.getRange(r, C.note).setValue(!email ? 'Chýba e-mail, e-mail 1 sa neposlal.' : 'Vetva sa nerozpoznala podľa Q2, e-mail 1 sa neposlal.');
    MailApp.sendEmail(NOTIFY, 'Lead bez e-mailu 1: ' + name, 'Pozri Sheet: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
    return { ok: true, sent: false };
  }
  var m = email1_(f, vetva, firma, name, id, email, q1, q2, q3);
  GmailApp.sendEmail(email, m.subject, m.body, { name: FROM_NAME });
  sh.getRange(r, C.stav).setValue(STAV.e1);
  sh.getRange(r, C.e1).setValue(new Date());
  MailApp.sendEmail(NOTIFY, 'Nový lead ' + f + ': ' + (firma || name), 'Vetva ' + vetva + '\nE-mail 1 odoslaný.\nSheet: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
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

/* ---------- e-mail 1 (jediný e-mail po vyplnení formulára) ---------- */
function q_(v) { return v ? '„' + v + '“' : ''; }
function email1_(f, vetva, firma, name, id, email, q1, q2, q3) {
  var fi = firma || 'vašu firmu';
  var sign = '\n\nMichal Benko\nmichalbenko.sk';
  var L = ['Dobrý deň,', '', 'ďakujem, že ste vyplnili formulár.'];
  if (f === 'A') {
    var demo = demoLink_(id, name, email);
    if (q1) L.push('Píšete, že ponuky dnes vytvárate takto: ' + q_(q1) + (q2 ? ' a mesačne ich je ' + q_(q2) : '') + '.');
    if (vetva === 'A3') {
      L.push('', 'Pri takom počte sa vám automatizácia zatiaľ pravdepodobne neoplatí, nechcem vám predávať zbytočnosť. Ukážku si môžete pozrieť tu: ' + demo, '', 'Ak sa počet dopytov zvýši, odpovedzte na tento e-mail a nadviažeme.');
      return { subject: 'Ďakujem za formulár: ukážka ponuky', body: L.join('\n') + sign };
    }
    L.push('', vetva === 'A1' ? 'Pri takom objeme sa automatizácia ponúk oplatí najviac: zákazník dostane cenu hneď a vy ušetríte hodiny ručného počítania.' : 'Pri takom objeme sa vám automatizácia môže oplatiť, záleží na tom, koľko času ponukám dnes venujete.');
    L.push('', 'Vyskúšajte si ukážku (zaberie 2 minúty): ' + demo, '', 'Ak to chcete pre ' + fi + ', odpovedzte na tento e-mail troma údajmi:', '1. Jedna typická služba alebo produkt, ktorý ponúkate', '2. Od čoho závisí cena (rozmer, množstvo, materiál…)', '3. Na akú e-mailovú adresu majú chodiť dopyty', '', 'Systém stojí 390 € jednorazovo. Odpoviem písomne do 24 hodín, telefonovať nemusíme.');
    return { subject: 'Ďakujem za formulár: ukážka ponuky pre ' + fi, body: L.join('\n') + sign };
  }
  if (f === 'B') {
    if (q1) L.push('Píšete, že web dnes máte takto: ' + q_(q1) + (q2 ? ' a potrebovali by ste ho ' + q_(q2).toLowerCase() : '') + '.');
    if (q3) L.push('Ste firma, ktorá sa zaoberá: ' + q_(q3) + '.');
    L.push('', 'Navrhnem vám jednu prehľadnú stránku s jasnou ponukou a formulárom, ktorá funguje na mobile aj počítači. Cena je 350 € jednorazovo a sú v nej 2 kolá úprav.', '', 'Ak chcete pokračovať, odpovedzte na tento e-mail dvoma vetami: čo ponúkate a komu. Do 24 hodín vám napíšem ďalší krok. Komunikujeme písomne, telefonovať nemusíme.');
    return { subject: 'Ďakujem za formulár: jednostránkový web pre ' + fi, body: L.join('\n') + sign };
  }
  if (q1) L.push('Najčastejšie ručne robíte: ' + q_(q1) + (q2 ? ' a opakuje sa to ' + q_(q2).toLowerCase() + ' mesačne' : '') + '.');
  if (q3) L.push('Dnes používate: ' + q_(q3) + '.');
  L.push('', 'Presne takéto opakované úkony viem nastaviť tak, aby bežali samy, bez toho, aby ste na ne mysleli. Cena je od 39 € mesačne podľa rozsahu.', '', 'Ak chcete pokračovať, odpovedzte na tento e-mail jednou vetou: kedy sa to dnes stane a čo sa má potom urobiť. Do 24 hodín vám napíšem, ako by to fungovalo. Komunikujeme písomne, telefonovať nemusíme.');
  return { subject: 'Ďakujem za formulár: automatizácia pre ' + fi, body: L.join('\n') + sign };
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
