// /api/quote-demo — ukážka automatických cenových ponúk (michalbenko.sk/ponuky)
// type "quote":    vypočíta ponuku, vygeneruje PDF, pošle ju návštevníkovi e-mailom a Michalovi upozornenie
// type "interest": firma chce systém pre seba -> upozornenie Michalovi
// Env: GMAIL_USER, GMAIL_APP_PASSWORD (rovnaké ako /api/audit-submit), voliteľne ZAPIER_QUOTE_HOOK
const path = require('path');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const PRICING = require('./_lib/pricing.js');

const TO_EMAIL = 'michalbenko3@gmail.com';
const SITE = 'https://michalbenko.sk';
const FONT_DIR = path.join(__dirname, '_fonts');
const F = {
  reg: path.join(FONT_DIR, 'IBMPlexSans-Regular.ttf'),
  semi: path.join(FONT_DIR, 'IBMPlexSans-SemiBold.ttf'),
  mono: path.join(FONT_DIR, 'IBMPlexMono-Medium.ttf')
};

// best-effort ochrana proti zneužitiu (v rámci jednej inštancie funkcie)
const hits = new Map();
function limited(ip, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}
function clean(v, max) { return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max || 200) : ''; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const eur = PRICING.eur;
function fmtDate(d) { return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear(); }

function quoteNumber() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return 'P' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + Math.floor(100 + Math.random() * 900);
}

function buildPdf(q, cust, no) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, font: F.reg, info: { Title: 'Cenová ponuka ' + no, Author: 'Vaša firma s.r.o. (ukážka)' } });
    const bufs = [];
    doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    doc.registerFont('reg', F.reg); doc.registerFont('semi', F.semi); doc.registerFont('mono', F.mono);
    const INK = '#0E1A30', SOFT = '#5B6578', LINE = '#DED0B0', BLUE = '#2F6FED', W = 495, L = 50;
    const today = new Date(); const until = new Date(Date.now() + PRICING.VALID_DAYS * 864e5);

    // hlavička
    doc.save().lineWidth(1.2).dash(4, { space: 3 }).strokeColor('#9AA3B5').rect(L, 50, 150, 56).stroke().restore();
    doc.font('semi').fontSize(11).fillColor('#9AA3B5').text('VAŠE LOGO', L, 72, { width: 150, align: 'center', characterSpacing: 1.5 });
    doc.font('semi').fontSize(22).fillColor(INK).text('Cenová ponuka', 300, 50, { width: 245, align: 'right' });
    doc.font('mono').fontSize(9.5).fillColor(SOFT)
      .text('Č. ' + no, 300, 82, { width: 245, align: 'right' })
      .text('Dátum: ' + fmtDate(today), 300, 96, { width: 245, align: 'right' })
      .text('Platná do: ' + fmtDate(until), 300, 109, { width: 245, align: 'right' });

    doc.moveTo(L, 128).lineTo(L + W, 128).lineWidth(1).strokeColor(LINE).stroke();
    doc.font('semi').fontSize(9).fillColor(SOFT).text('DODÁVATEĽ', L, 142, { characterSpacing: 1 });
    doc.font('reg').fontSize(10.5).fillColor(INK).text('Vaša firma s.r.o. (ukážková firma)', L, 156).text('Okná a dvere na mieru', L, 171);
    doc.font('semi').fontSize(9).fillColor(SOFT).text('ODBERATEĽ', 300, 142, { characterSpacing: 1 });
    doc.font('reg').fontSize(10.5).fillColor(INK).text(cust.name, 300, 156, { width: 245 }).text(cust.email + (cust.phone ? ' · ' + cust.phone : ''), 300, 171, { width: 245 });

    doc.roundedRect(L, 200, W, 40, 6).fill('#F4EFE4');
    doc.font('reg').fontSize(9.5).fillColor(SOFT).text('Špecifikácia', L + 14, 207);
    doc.font('semi').fontSize(10.5).fillColor(INK).text(q.materialLabel + ' · ' + q.glassLabel + ' · ' + q.colorLabel, L + 14, 220, { width: W - 28 });

    // tabuľka
    let y = 262;
    const cols = [L, L + 285, L + 345, L + 420];
    doc.font('semi').fontSize(8.5).fillColor(SOFT);
    doc.text('POLOŽKA', cols[0], y, { characterSpacing: .8 });
    doc.text('MNOŽSTVO', cols[1] - 10, y, { width: 70, align: 'right', characterSpacing: .8 });
    doc.text('JEDN. CENA', cols[2], y, { width: 70, align: 'right', characterSpacing: .8 });
    doc.text('SPOLU', cols[3], y, { width: 75, align: 'right', characterSpacing: .8 });
    y += 18; doc.moveTo(L, y).lineTo(L + W, y).strokeColor(INK).lineWidth(1).stroke(); y += 9;
    q.lines.forEach(l => {
      const qty = (l.unit === 'bm' ? String(l.qty).replace('.', ',') : l.qty) + ' ' + l.unit;
      doc.font(l.kind === 'item' ? 'semi' : 'reg').fontSize(10.5).fillColor(INK).text(l.label, cols[0], y, { width: 270 });
      const h = doc.heightOfString(l.label, { width: 270 });
      doc.font('mono').fontSize(10).text(qty, cols[1] - 10, y, { width: 70, align: 'right' })
        .text(eur(l.unitPrice), cols[2], y, { width: 70, align: 'right' })
        .text(eur(l.total), cols[3], y, { width: 75, align: 'right' });
      y += Math.max(h, 14) + 8;
      doc.moveTo(L, y - 4).lineTo(L + W, y - 4).strokeColor(LINE).lineWidth(.6).stroke();
    });

    // súčty
    y += 8;
    const tl = L + 290, tw = 205;
    const row = (lab, val, big) => {
      doc.font(big ? 'semi' : 'reg').fontSize(big ? 13 : 10.5).fillColor(INK).text(lab, tl, y, { width: 120 });
      doc.font(big ? 'semi' : 'mono').fontSize(big ? 16 : 10.5).fillColor(big ? BLUE : INK).text(val, tl + 100, y - (big ? 2 : 0), { width: tw - 100, align: 'right' });
      y += big ? 26 : 18;
    };
    row('Spolu bez DPH', eur(q.net)); row('DPH 23 %', eur(q.vat));
    doc.moveTo(tl, y).lineTo(tl + tw, y).strokeColor(INK).lineWidth(1).stroke(); y += 10;
    row('Spolu s DPH', eur(q.gross), true);

    // ďalší krok
    y += 18;
    doc.roundedRect(L, y, W, 74, 8).fill('#0E2247');
    doc.font('semi').fontSize(13).fillColor('#FFFFFF').text('Ďalší krok: bezplatné zameranie', L + 20, y + 16);
    doc.font('reg').fontSize(10).fillColor('#C9D3EA').text('Orientačná cena. Finálnu cenu potvrdíme po zameraní u vás. Termín si vyberiete jedným klikom v e-maile.', L + 20, y + 36, { width: W - 40 });

    // pätička
    doc.font('reg').fontSize(8.5).fillColor('#9AA3B5')
      .text('Ukážka systému automatických cenových ponúk · ponuka vygenerovaná automaticky za pár sekúnd · michalbenko.sk/ponuky', L, 780, { width: W, align: 'center' });
    doc.end();
  });
}

function quoteEmailHtml(q, cust, no) {
  const cta = SITE + '/ponuky/?chcem=1&ref=' + encodeURIComponent(no) + '#chcem';
  const rows = q.lines.map(l => `<tr><td style="padding:8px 0;border-bottom:1px solid #EADFC8;font-size:14px;color:#0E1A30">${esc(l.label)}</td><td style="padding:8px 0;border-bottom:1px solid #EADFC8;font-size:14px;color:#0E1A30;text-align:right;white-space:nowrap">${esc(eur(l.total))}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F7F1E6;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
  <div style="background:#0E2247;color:#fff;border-radius:10px;padding:14px 18px;font-size:13px;line-height:1.5">
    <b>Toto je ukážka.</b> Presne takto by ponuku dostal váš zákazník: s vaším logom, cenníkom a do minúty od vyplnenia.
  </div>
  <div style="background:#fff;border-radius:12px;padding:26px 24px;margin-top:14px">
    <p style="margin:0 0 6px;font-size:13px;color:#6B7489;letter-spacing:.08em;text-transform:uppercase">Cenová ponuka č. ${esc(no)}</p>
    <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:26px;color:#0E1A30">Dobrý deň${cust.name ? ', ' + esc(cust.name.split(' ')[0]) : ''},</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#48556E">ďakujeme za záujem. V prílohe je cenová ponuka v PDF. Stručný prehľad:</p>
    <table style="width:100%;border-collapse:collapse">${rows}
      <tr><td style="padding:12px 0 0;font-size:16px;font-weight:bold;color:#0E1A30">Spolu s DPH</td><td style="padding:12px 0 0;font-size:20px;font-weight:bold;color:#2F6FED;text-align:right;white-space:nowrap">${esc(eur(q.gross))}</td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:#6B7489">Orientačná cena, platná ${PRICING.VALID_DAYS} dní. Finálnu cenu potvrdíme po bezplatnom zameraní.</p>
  </div>
  <div style="background:#fff;border:2px solid #2F6FED;border-radius:12px;padding:24px;margin-top:14px;text-align:center">
    <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:21px;color:#0E1A30">Chcete, aby takto dostávali ponuky aj vaši zákazníci?</p>
    <p style="margin:0 0 18px;font-size:14px;color:#48556E;line-height:1.5">Nastavím vám to s vaším cenníkom a logom. Spustenie do 5 pracovných dní.</p>
    <a href="${cta}" style="display:inline-block;background:#2F6FED;color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:15px 26px;border-radius:8px">Chcem tento systém pre svoju firmu</a>
    <p style="margin:14px 0 0;font-size:13px;color:#6B7489">Alebo len odpovedzte na tento e-mail.</p>
  </div>
  <p style="margin:18px 0 0;font-size:12px;color:#8A93A6;text-align:center">Michal Benko · Google Ads a automatizácie · michalbenko.sk</p>
</div></body></html>`;
}

async function forwardHook(payload) {
  const url = process.env.ZAPIER_QUOTE_HOOK;
  if (!url) return;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  catch (e) { console.error('quote-demo: hook failed', e && e.message); }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method_not_allowed' }); return; }
  let data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  data = data || {};
  if (clean(data.website)) { res.status(200).json({ ok: true }); return; } // honeypot

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const gmailUser = process.env.GMAIL_USER, gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) { console.error('quote-demo: missing GMAIL env'); res.status(500).json({ ok: false, error: 'not_configured' }); return; }
  const tx = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });

  try {
    if (data.type === 'interest') {
      if (limited('i:' + ip, 5, 10 * 60e3)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
      const name = clean(data.name, 80), company = clean(data.company, 120), contact = clean(data.contact, 120), web = clean(data.web, 160), ref = clean(data.ref, 30);
      if (!name || !contact) { res.status(400).json({ ok: false, error: 'invalid_input' }); return; }
      const text = `Meno: ${name}\nFirma: ${company || '-'}\nKontakt: ${contact}\nWeb: ${web || '-'}\nUkážková ponuka: ${ref || '-'}\n`;
      await tx.sendMail({ from: '"michalbenko.sk" <' + gmailUser + '>', to: TO_EMAIL, replyTo: emailOk(contact) ? contact : undefined,
        subject: '🔥 Záujem o automatické ponuky' + (company ? ' — ' + company : ''), text });
      await forwardHook({ type: 'interest', name, company, contact, web, ref, at: new Date().toISOString() });
      res.status(200).json({ ok: true }); return;
    }

    // type: quote
    if (limited('q:' + ip, 3, 10 * 60e3)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
    const cust = { name: clean(data.name, 80), email: clean(data.email, 160), phone: clean(data.phone, 40) };
    if (!cust.name || !emailOk(cust.email) || data.consent !== true) { res.status(400).json({ ok: false, error: 'invalid_input' }); return; }
    const q = PRICING.calculate(data.config || {});
    const no = quoteNumber();
    const pdf = await buildPdf(q, cust, no);

    await tx.sendMail({
      from: '"Vaša firma s.r.o. (ukážka)" <' + gmailUser + '>', to: cust.email, replyTo: TO_EMAIL,
      subject: 'Cenová ponuka č. ' + no + ' — okná a dvere (ukážka)',
      html: quoteEmailHtml(q, cust, no),
      text: 'Cenová ponuka č. ' + no + '\nSpolu s DPH: ' + eur(q.gross) + '\nPDF je v prílohe.\n\nChcete tento systém pre svoju firmu? ' + SITE + '/ponuky/?chcem=1&ref=' + no + '#chcem',
      attachments: [{ filename: 'Cenova-ponuka-' + no + '.pdf', content: pdf, contentType: 'application/pdf' }]
    });
    // upozornenie Michalovi (neblokuje odpoveď pri chybe)
    tx.sendMail({ from: '"michalbenko.sk" <' + gmailUser + '>', to: TO_EMAIL, replyTo: cust.email,
      subject: 'Nová ukážka ponuky — ' + cust.name + ' (' + eur(q.gross) + ')',
      text: `Meno: ${cust.name}\nE-mail: ${cust.email}\nTelefón: ${cust.phone || '-'}\nPonuka: ${no}\nSpolu s DPH: ${eur(q.gross)}\nKusov: ${q.pieces}\n` }).catch(e => console.error('quote-demo: notify failed', e && e.message));
    await forwardHook({ type: 'quote', no, ...cust, gross: q.gross, net: q.net, pieces: q.pieces, material: q.material, at: new Date().toISOString() });
    res.status(200).json({ ok: true, no, quote: q });
  } catch (e) {
    console.error('quote-demo error', e && e.message);
    res.status(500).json({ ok: false, error: 'send_failed' });
  }
};

module.exports._buildPdf = buildPdf; // pre lokálny test
module.exports._emailHtml = quoteEmailHtml;
