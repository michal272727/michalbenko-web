/**
 * Meta funnel A/B/C: Apps Script (bez Zapieru okrem vstupu).
 * Zapier (spúšťač Facebook Lead Ads) -> 1 akcia Webhooks POST na <exec URL>?key=SECRET&f=A|B|C
 * Telo: JSON so všetkými poľami leadu (id, full_name, email, company_name + otázky z formulára).
 * Script robí: duplicitu, zápis do Sheetu, e-mail 1, detekciu odpovede, follow-upy (4. a 10. deň), uzavretie, upozornenia.
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
  var q2 = pick_(lead, ['kolko', 'rozsah', 'frekvenc', 'ako casto']);
  var q3 = pick_(lead, ['web alebo', 'socialn', 'nastroj', 'pouzivate']);
  var vetva = f === 'A' ? vetvaA_(q2) : f;

  var row = [];
  for (var i = 0; i < 21; i++) row.push('');
  row[C.id - 1] = id; row[C.recv - 1] = new Date(); row[C.funnel - 1] = f; row[C.vetva - 1] = vetva || '';
  row[C.name - 1] = name; row[C.email - 1] = email; row[C.firma - 1] = firma;
  row[C.web - 1] = q3; row[C.q1 - 1] = q1; row[C.q2 - 1] = q2; row[C.stav - 1] = STAV.novy;
  sh.appendRow(row);
  var r = sh.getLastRow();

  if (!email || !vetva) {
    sh.getRange(r, C.note).setValue(!email ? 'Chýba e-mail, e-mail 1 sa neposlal.' : 'Vetva sa nerozpoznala podľa Q2, e-mail 1 sa neposlal.');
    MailApp.sendEmail(NOTIFY, 'Lead bez e-mailu 1: ' + name, 'Pozri Sheet: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
    return { ok: true, sent: false };
  }
  var m = email1_(f, vetva, firma, name, id, email);
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

/* ---------- e-mail 1 ---------- */
function email1_(f, vetva, firma, name, id, email) {
  var fi = firma || 'vašu firmu';
  var sign = '\n\nMichal Benko\nmichalbenko.sk';
  if (f === 'A') {
    var demo = demoLink_(id, name, email);
    if (vetva === 'A1') return { subject: 'Ukážka cenovej ponuky pre ' + fi, body: ['Dobrý deň,', '', 'ďakujem za záujem. Pri 50 a viac ponukách mesačne sa automatizácia ponúk oplatí. Každý dopyt, na ktorý odpoviete rýchlejšie, má vyššiu šancu skončiť zákazkou.', '', 'Vyskúšajte si ukážku (zaberie 2 minúty): ' + demo, '', 'Zadáte parametre, systém vypočíta cenu a pošle vzorovú ponuku na váš e-mail.', '', 'Ak to chcete pre ' + fi + ', odpovedzte na tento e-mail troma údajmi:', '1. Jedna typická služba alebo produkt, ktorý ponúkate', '2. Od čoho závisí cena (rozmer, množstvo, materiál…)', '3. Na akú e-mailovú adresu majú chodiť dopyty', '', 'Odpoviem písomne do 24 hodín a navrhnem ďalší postup. Systém stojí 390 € jednorazovo. Telefonovať nemusíme.'].join('\n') + sign };
    if (vetva === 'A2') return { subject: 'Ukážka cenovej ponuky pre ' + fi, body: ['Dobrý deň,', '', 'ďakujem za záujem. Pri 20–50 ponukách mesačne sa vám automatizácia ponúk môže oplatiť, záleží na tom, koľko času dnes ponukám venujete. Pozrite si ukážku, nech vidíte, či to dáva zmysel: ' + demo, '', 'Ak chcete, odpovedzte jedným slovom „ďalej“ a pošlem vám, čo by to pre vašu firmu stálo a čo by ste získali.'].join('\n') + sign };
    return { subject: 'Ukážka cenovej ponuky', body: ['Dobrý deň,', '', 'ďakujem za záujem. Pri menej než 20 ponukách mesačne sa vám automatizácia ponúk zatiaľ pravdepodobne neoplatí. Ukážku si môžete pozrieť tu: ' + demo, '', 'Ak sa počet dopytov zvýši, ozvite sa.'].join('\n') + sign };
  }
  if (f === 'B') return { subject: 'Jednostránkový web pre ' + fi, body: ['Dobrý deň,', '', 'ďakujem za záujem o jednostránkový web. Dostanete jednu prehľadnú stránku s jasnou ponukou a formulárom, ktorá funguje na mobile aj počítači. Cena je 350 € jednorazovo a sú v nej 2 kolá úprav.', '', 'Aby som vám vedel navrhnúť ďalší postup, odpovedzte na tento e-mail dvoma vetami: čo ponúkate a komu.', '', 'Komunikujeme písomne, telefonovať nemusíme. Odpoviem do 24 hodín.'].join('\n') + sign };
  return { subject: 'Automatizácia pre ' + fi, body: ['Dobrý deň,', '', 'ďakujem za záujem o automatizáciu. Nastavím, aby sa opakované úkony (dopyt do tabuľky, odpoveď zákazníkovi, pripomienka) diali samy. Cena je od 39 € mesačne podľa rozsahu.', '', 'Odpovedzte na tento e-mail jednou vetou: ktorú činnosť robíte ručne najčastejšie.', '', 'Komunikujeme písomne, telefonovať nemusíme. Odpoviem do 24 hodín.'].join('\n') + sign };
}

/* ---------- follow-upy ---------- */
function followUp_(n, f, firma) {
  var sign = '\n\nMichal Benko\nmichalbenko.sk';
  var what = f === 'A' ? 'ukážku automatických cenových ponúk' : f === 'B' ? 'jednostránkový web' : 'automatizáciu';
  if (n === 1) return { subject: 'Ešte k tomu, čo som vám posielal', body: ['Dobrý deň,', '', 'len sa krátko pripomínam k téme: ' + what + '. Ak vás to stále zaujíma, stačí odpovedať na tento e-mail jednou vetou a pošlem vám ďalší krok.'].join('\n') + sign };
  return { subject: 'Posledná správa k ' + what, body: ['Dobrý deň,', '', 'nechcem vás zahlcovať, preto je to moja posledná správa. Ak sa téma ' + what + ' vráti, napíšte mi kedykoľvek a nadviažeme.'].join('\n') + sign };
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
    if (stav === STAV.e1 && age >= 4 * DAY) {
      var m1 = followUp_(1, f, row[C.firma - 1]); GmailApp.sendEmail(email, m1.subject, m1.body, { name: FROM_NAME });
      sh.getRange(r, C.stav).setValue(STAV.fu1); sh.getRange(r, C.fu1).setValue(new Date());
    } else if (stav === STAV.fu1 && age >= 10 * DAY) {
      var m2 = followUp_(2, f, row[C.firma - 1]); GmailApp.sendEmail(email, m2.subject, m2.body, { name: FROM_NAME });
      sh.getRange(r, C.stav).setValue(STAV.fu2); sh.getRange(r, C.fu2).setValue(new Date());
    } else if (stav === STAV.fu2 && age >= 14 * DAY) {
      sh.getRange(r, C.stav).setValue(STAV.closed); sh.getRange(r, C.closed).setValue(new Date());
    }
  }
}
