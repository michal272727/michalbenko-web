// POST /api/k-provision – založí novému klientovi kalkulačku: kópia šablóny tabuľky, zdieľanie, register, uvítací e-mail.
// Zatiaľ chránené prístupovým kódom (ONBOARD_CODE); po napojení Stripe sa nahradí overením platby.
const ENGINE = require('./_lib/engine.js');
const { call } = require('./_lib/as.js');
const { transport, from } = require('./_lib/mail.js');
const SITE = 'https://michalbenko.sk';
const OWNER = 'michalbenko3@gmail.com';
const clean = (v, m) => typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, m || 200) : '';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PLANS = { zaklad: 'Základ', standard: 'Štandard', pro: 'Pro' };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  let d = req.body; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } } d = d || {};
  const code = process.env.ONBOARD_CODE;
  if (!code || clean(d.kod, 80) !== code) { res.status(403).json({ ok: false, error: 'bad_code' }); return; }
  const firma = clean(d.firma, 80), email = clean(d.email, 160), balik = PLANS[d.balik] ? d.balik : 'standard';
  const slug = ENGINE.slugify(d.slug || firma);
  if (!firma || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || slug.length < 3) { res.status(400).json({ ok: false, error: 'invalid_input' }); return; }
  try {
    const r = await call({ action: 'provision', firma, email, slug, balik });
    if (!r || !r.ok) { res.status(500).json({ ok: false, error: (r && r.error) || 'provision_failed' }); return; }
    const calcUrl = SITE + '/k/?f=' + r.slug;
    const embed = '<script src="' + SITE + '/k/embed.js" data-firma="' + r.slug + '" async></script>';
    const next = balik === 'zaklad'
      ? 'V tabuľke prepíšte hárok „Cenník“ na svoje služby a ceny a v hárku „Nastavenia“ doplňte logo a texty. Kalkulačka zmeny prevezme do minúty.'
      : 'Pošlite mi odpoveďou na tento e-mail svoj cenník v akejkoľvek podobe (PDF, Excel, fotka alebo odkaz na web) a logo. Kalkulačku vám nastavím do 48 hodín.';
    const html = `<!doctype html><html><body style="margin:0;background:#F7F1E6;font-family:Arial,Helvetica,sans-serif;color:#0E1A30">
<div style="max-width:580px;margin:0 auto;padding:26px 16px"><div style="background:#fff;border-radius:12px;padding:26px 24px">
<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6B7489">Balík ${esc(PLANS[balik])}</p>
<h1 style="margin:6px 0 14px;font-family:Georgia,serif;font-size:24px">Vaša kalkulačka je pripravená</h1>
<p style="font-size:15px;line-height:1.6;color:#48556E">Dobrý deň, tu je všetko, čo potrebujete. E-mail si uložte.</p>
<p style="margin:18px 0 6px;font-weight:bold">1. Vaša kalkulačka</p><p style="margin:0"><a href="${calcUrl}" style="color:#2F6FED">${calcUrl}</a></p>
<p style="margin:18px 0 6px;font-weight:bold">2. Cenník, nastavenia a dopyty (Google tabuľka)</p><p style="margin:0"><a href="${esc(r.sheetUrl)}" style="color:#2F6FED">Otvoriť tabuľku</a> · každý dopyt sa sem zapíše sám</p>
<p style="margin:18px 0 6px;font-weight:bold">3. Vloženie na váš web (WordPress aj iné)</p><p style="margin:0;font-size:13px;color:#48556E">Vložte tento riadok do HTML bloku na stránke:</p>
<pre style="background:#F4EFE4;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all">${esc(embed)}</pre>
<p style="margin:18px 0 6px;font-weight:bold">Ďalší krok</p><p style="margin:0;font-size:15px;line-height:1.6;color:#48556E">${esc(next)}</p>
</div><p style="text-align:center;font-size:12px;color:#8A93A6;margin:16px 0 0">Michal Benko · michalbenko.sk · odpovedzte na tento e-mail, ak niečo potrebujete</p></div></body></html>`;
    const tx = transport();
    await tx.sendMail({ from: from('Michal Benko'), to: email, replyTo: OWNER, subject: 'Vaša kalkulačka je pripravená – ' + firma, html });
    tx.sendMail({ from: from('michalbenko.sk'), to: OWNER, subject: 'Nový klient kalkulačky: ' + firma + ' (' + PLANS[balik] + ')',
      text: `Firma: ${firma}\nE-mail: ${email}\nBalík: ${PLANS[balik]}\nKalkulačka: ${calcUrl}\nTabuľka: ${r.sheetUrl}\n` }).catch(() => {});
    res.status(200).json({ ok: true, slug: r.slug, existed: !!r.existed, calcUrl, sheetUrl: r.sheetUrl, embed });
  } catch (e) { console.error('k-provision', e.message); res.status(500).json({ ok: false, error: 'server' }); }
};
