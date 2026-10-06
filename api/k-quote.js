// POST /api/k-quote – univerzálna kalkulačka klienta: výpočet z jeho Google tabuľky, PDF s jeho logom,
// e-mail zákazníkovi, upozornenie firme a zápis do hárku „Dopyty“.
const path = require('path');
const PDFDocument = require('pdfkit');
const ENGINE = require('./_lib/engine.js');
const { call, getConfig } = require('./_lib/as.js');
const { transport, from } = require('./_lib/mail.js');

const SITE = 'https://michalbenko.sk';
const FONT_DIR = path.join(__dirname, '_fonts');
const F = { reg: path.join(FONT_DIR, 'IBMPlexSans-Regular.ttf'), semi: path.join(FONT_DIR, 'IBMPlexSans-SemiBold.ttf'), mono: path.join(FONT_DIR, 'IBMPlexMono-Medium.ttf') };
const hits = new Map();
function limited(k, max, ms) { const now = Date.now(); const a = (hits.get(k) || []).filter(t => now - t < ms); a.push(now); hits.set(k, a); return a.length > max; }
const clean = (v, m) => typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, m || 200) : '';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const eur = (x) => ENGINE.eur(x, 2);
const fmtDate = d => d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear();
function quoteNo() { const d = new Date(), p = n => String(n).padStart(2, '0'); return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + Math.floor(1000 + Math.random() * 9000); }

async function fetchLogo(url) {
  if (!/^https:\/\//.test(url || '')) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null; const ct = r.headers.get('content-type') || '';
    if (!/image\/(png|jpe?g)/.test(ct)) return null;
    const b = Buffer.from(await r.arrayBuffer()); return b.length < 3e6 ? b : null;
  } catch (e) { return null; }
}

function buildPdf(cfg, q, cust, no, logo) {
  const s = cfg.settings; const accent = s.farba;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, font: F.reg, info: { Title: 'Cenová ponuka ' + no, Author: s.firma } });
    const bufs = []; doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    doc.registerFont('reg', F.reg); doc.registerFont('semi', F.semi); doc.registerFont('mono', F.mono);
    const INK = '#0E1A30', SOFT = '#5B6578', LINE = '#E3DCCB', L = 50, W = 495;
    const today = new Date(), until = new Date(Date.now() + s.platnost * 864e5);
    let logoOk = false;
    if (logo && s.balik !== 'zaklad') { try { doc.image(logo, L, 48, { fit: [170, 60] }); logoOk = true; } catch (e) {} }
    if (!logoOk) doc.font('semi').fontSize(17).fillColor(INK).text(s.firma, L, 60, { width: 240 });
    doc.font('semi').fontSize(22).fillColor(INK).text('Cenová ponuka', 300, 50, { width: 245, align: 'right' });
    doc.font('mono').fontSize(9.5).fillColor(SOFT).text('Č. ' + no, 300, 82, { width: 245, align: 'right' })
      .text('Dátum: ' + fmtDate(today), 300, 96, { width: 245, align: 'right' }).text('Platná do: ' + fmtDate(until), 300, 109, { width: 245, align: 'right' });
    doc.moveTo(L, 132).lineTo(L + W, 132).lineWidth(1).strokeColor(LINE).stroke();
    doc.font('semi').fontSize(8.5).fillColor(SOFT).text('DODÁVATEĽ', L, 146, { characterSpacing: 1 });
    doc.font('reg').fontSize(10.5).fillColor(INK).text(s.firma, L, 160, { width: 230 });
    const sup = [s.web, s.telefon].filter(Boolean).join(' · '); if (sup) doc.fontSize(9.5).fillColor(SOFT).text(sup, L, 175, { width: 230 });
    doc.font('semi').fontSize(8.5).fillColor(SOFT).text('ODBERATEĽ', 300, 146, { characterSpacing: 1 });
    doc.font('reg').fontSize(10.5).fillColor(INK).text([cust.name, cust.company].filter(Boolean).join(', '), 300, 160, { width: 245 });
    doc.fontSize(9.5).fillColor(SOFT).text([cust.email, cust.phone].filter(Boolean).join(' · '), 300, 175, { width: 245 });
    let y = 210;
    if (q.mnozstvoLabel || q.chosen.length) {
      const spec = [q.mnozstvoLabel ? q.mnozstvoLabel + ': ' + q.mnozstvo : ''].concat(q.chosen).filter(Boolean).join('  ·  ');
      const h = doc.font('reg').fontSize(9.5).heightOfString(spec, { width: W - 28 }) + 22;
      doc.roundedRect(L, y, W, h, 6).fill('#F4EFE4'); doc.fillColor(INK).text(spec, L + 14, y + 11, { width: W - 28 }); y += h + 18;
    }
    const cols = [L, L + 285, L + 345, L + 420];
    doc.font('semi').fontSize(8.5).fillColor(SOFT);
    doc.text('POLOŽKA', cols[0], y, { characterSpacing: .8 }); doc.text('MNOŽSTVO', cols[1] - 10, y, { width: 70, align: 'right' });
    doc.text('JEDN. CENA', cols[2], y, { width: 70, align: 'right' }); doc.text('SPOLU', cols[3], y, { width: 75, align: 'right' });
    y += 17; doc.moveTo(L, y).lineTo(L + W, y).strokeColor(INK).lineWidth(1).stroke(); y += 9;
    q.lines.forEach(l => {
      doc.font('reg').fontSize(10.5).fillColor(INK).text(l.label, cols[0], y, { width: 270 });
      const h = doc.heightOfString(l.label, { width: 270 });
      doc.font('mono').fontSize(9.5).text(l.qty + ' ' + (l.unit || ''), cols[1] - 10, y, { width: 70, align: 'right' })
        .text(eur(l.unitPrice), cols[2], y, { width: 70, align: 'right' }).text(eur(l.total), cols[3], y, { width: 75, align: 'right' });
      y += Math.max(h, 14) + 8; doc.moveTo(L, y - 4).lineTo(L + W, y - 4).strokeColor(LINE).lineWidth(.6).stroke();
      if (y > 690) { doc.addPage(); y = 60; }
    });
    y += 8; const tl = L + 260, tw = 235;
    const row = (lab, val, big, color) => {
      doc.font(big ? 'semi' : 'reg').fontSize(big ? 13 : 10.5).fillColor(INK).text(lab, tl, y, { width: 140 });
      doc.font(big ? 'semi' : 'mono').fontSize(big ? 16 : 10.5).fillColor(color || INK).text(val, tl + 100, y - (big ? 2 : 0), { width: tw - 100, align: 'right' });
      y += big ? 26 : 18;
    };
    if (q.discount) { row('Medzisúčet', eur(q.subtotal)); row(q.discountLabel, '−' + eur(q.discount).replace('−', ''), false, '#1E8E5A'); }
    if (q.vatRate) { row('Spolu bez DPH', eur(q.net)); row('DPH ' + q.vatRate + ' %', eur(q.vat)); }
    doc.moveTo(tl, y).lineTo(tl + tw, y).strokeColor(INK).lineWidth(1).stroke(); y += 10;
    row(q.vatRate ? 'Spolu s DPH' : 'Spolu', eur(q.gross), true, accent);
    if (!q.vatRate) { doc.font('reg').fontSize(8.5).fillColor(SOFT).text('Dodávateľ nie je platiteľom DPH.', tl, y, { width: tw, align: 'right' }); y += 14; }
    y += 14;
    if (s.poznamka) { doc.font('reg').fontSize(9.5).fillColor(SOFT).text(s.poznamka, L, y, { width: W }); y = doc.y + 14; }
    if (y < 690) {
      doc.roundedRect(L, y, W, 62, 8).fill(accent);
      doc.font('semi').fontSize(13).fillColor('#FFFFFF').text(s.ctaText || 'Máte otázky? Odpovedzte na e-mail s ponukou.', L + 20, y + 14, { width: W - 40, link: s.ctaUrl || null });
      doc.font('reg').fontSize(9.5).fillColor('#FFFFFF').text(s.ctaUrl ? s.ctaUrl : 'Ozveme sa vám čo najskôr.', L + 20, y + 36, { width: W - 40, link: s.ctaUrl || null });
    }
    doc.font('reg').fontSize(8).fillColor('#9AA3B5').text('Ponuka vytvorená automaticky' + (s.balik === 'zaklad' ? ' · kalkulačka od michalbenko.sk' : ''), L, 790, { width: W, align: 'center', lineBreak: false });
    doc.end();
  });
}

function customerHtml(cfg, q, cust, no) {
  const s = cfg.settings;
  const rows = q.lines.map(l => `<tr><td style="padding:7px 0;border-bottom:1px solid #EEE6D3;font-size:14px">${esc(l.label)} <span style="color:#8A93A6">· ${l.qty} ${esc(l.unit || '')}</span></td><td style="padding:7px 0;border-bottom:1px solid #EEE6D3;font-size:14px;text-align:right;white-space:nowrap">${esc(eur(l.total))}</td></tr>`).join('');
  const cta = s.ctaUrl ? `<p style="margin:20px 0 0;text-align:center"><a href="${esc(s.ctaUrl)}" style="display:inline-block;background:${s.farba};color:#fff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:8px">${esc(s.ctaText || 'Pokračovať')}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F7F1E6;font-family:Arial,Helvetica,sans-serif;color:#0E1A30">
<div style="max-width:560px;margin:0 auto;padding:26px 16px"><div style="background:#fff;border-radius:12px;padding:26px 24px">
<p style="margin:0 0 4px;font-size:12px;color:#6B7489;letter-spacing:.08em;text-transform:uppercase">${esc(s.firma)} · Cenová ponuka č. ${esc(no)}</p>
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px">Dobrý deň${cust.name ? ', ' + esc(cust.name.split(' ')[0]) : ''},</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#48556E">ďakujeme za záujem. Ponuku v PDF nájdete v prílohe, tu je stručný prehľad:</p>
<table style="width:100%;border-collapse:collapse">${rows}
${q.discount ? `<tr><td style="padding:7px 0;font-size:14px;color:#1E8E5A">${esc(q.discountLabel)}</td><td style="padding:7px 0;text-align:right;color:#1E8E5A;white-space:nowrap">−${esc(eur(q.discount).replace('−', ''))}</td></tr>` : ''}
<tr><td style="padding:12px 0 0;font-weight:bold;font-size:16px">${q.vatRate ? 'Spolu s DPH' : 'Spolu'}</td><td style="padding:12px 0 0;text-align:right;font-weight:bold;font-size:20px;color:${s.farba};white-space:nowrap">${esc(eur(q.gross))}</td></tr></table>
<p style="margin:14px 0 0;font-size:13px;color:#6B7489">Ponuka platí ${s.platnost} dní. Na otázky stačí odpovedať na tento e-mail.</p>${cta}
</div><p style="text-align:center;font-size:12px;color:#8A93A6;margin:16px 0 0">${esc(s.firma)}${s.web ? ' · ' + esc(s.web) : ''}${s.telefon ? ' · ' + esc(s.telefon) : ''}</p></div></body></html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  let d = req.body; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } } d = d || {};
  if (clean(d.website)) { res.status(200).json({ ok: true }); return; }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  if (limited(ip, 4, 10 * 60e3)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
  const slug = String(d.f || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  const cust = { name: clean(d.name, 80), company: clean(d.company, 120), email: clean(d.email, 160), phone: clean(d.phone, 40) };
  if (!slug || !cust.name || !emailOk(cust.email) || d.consent !== true) { res.status(400).json({ ok: false, error: 'invalid_input' }); return; }
  try {
    const raw = await getConfig(slug);
    if (!raw || !raw.ok) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
    const cfg = ENGINE.normalize(raw); const q = ENGINE.calculate(cfg, d.sel || {});
    const firmEmail = clean(String(raw.settings.email_dopyty || ''), 160);
    const no = quoteNo(); const logo = await fetchLogo(cfg.settings.logo);
    const pdf = await buildPdf(cfg, q, cust, no, logo);
    const tx = transport();
    await tx.sendMail({ from: from(cfg.settings.firma), to: cust.email, replyTo: emailOk(firmEmail) ? firmEmail : undefined,
      subject: 'Cenová ponuka č. ' + no + ' – ' + cfg.settings.firma, html: customerHtml(cfg, q, cust, no),
      text: 'Cenová ponuka č. ' + no + '\n' + (q.vatRate ? 'Spolu s DPH: ' : 'Spolu: ') + eur(q.gross) + '\nPDF je v prílohe.',
      attachments: [{ filename: 'Cenova-ponuka-' + no + '.pdf', content: pdf, contentType: 'application/pdf' }] });
    const summary = [q.mnozstvoLabel ? q.mnozstvoLabel + ': ' + q.mnozstvo : ''].concat(q.lines.map(l => l.label + ' × ' + l.qty)).filter(Boolean).join('; ');
    const jobs = [];
    if (emailOk(firmEmail)) jobs.push(tx.sendMail({ from: from('Kalkulačka – ' + cfg.settings.firma), to: firmEmail, replyTo: cust.email,
      subject: 'Nový dopyt: ' + cust.name + (cust.company ? ' (' + cust.company + ')' : '') + ' – ' + eur(q.gross),
      text: `Meno: ${cust.name}\nFirma: ${cust.company || '-'}\nE-mail: ${cust.email}\nTelefón: ${cust.phone || '-'}\nPonuka: ${no}\nVýber: ${summary}\nSpolu: ${eur(q.gross)}\n\nKópia ponuky je v prílohe. Odpovedzte priamo na tento e-mail.`,
      attachments: [{ filename: 'Cenova-ponuka-' + no + '.pdf', content: pdf, contentType: 'application/pdf' }] }));
    jobs.push(call({ action: 'lead', slug, no, name: cust.name, company: cust.company, email: cust.email, phone: cust.phone, summary, net: q.net, gross: q.gross }));
    const results = await Promise.allSettled(jobs); results.forEach(r => { if (r.status === 'rejected') console.error('k-quote side job', r.reason && r.reason.message); });
    res.status(200).json({ ok: true, no, quote: q });
  } catch (e) { console.error('k-quote', e.message); res.status(500).json({ ok: false, error: 'server' }); }
};
module.exports._buildPdf = buildPdf;
