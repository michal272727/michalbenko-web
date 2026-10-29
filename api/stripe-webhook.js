// Stripe webhook -> verifies the signature, then forwards the event to the Apps Script master (client onboarding).
// Why here and not straight to Apps Script: Apps Script web apps cannot read request headers, so the
// Stripe-Signature header cannot be verified there.
// Env: STRIPE_WEBHOOK_SECRET (whsec_...), APPS_SCRIPT_URL (web app /exec URL), APPS_SCRIPT_SECRET (= script property SECRET)
// Stripe Dashboard: endpoint https://michalbenko.sk/api/stripe-webhook, event checkout.session.completed
const crypto = require('crypto');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verify(raw, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = {};
  header.split(',').forEach(kv => { const i = kv.indexOf('='); if (i > 0) (parts[kv.slice(0, i).trim()] = parts[kv.slice(0, i).trim()] || []).push(kv.slice(i + 1).trim()); });
  const t = parts.t && parts.t[0];
  const sigs = parts.v1 || [];
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + raw.toString('utf8')).digest('hex');
  const eb = Buffer.from(expected);
  return sigs.some(s => { const sb = Buffer.from(s); return sb.length === eb.length && crypto.timingSafeEqual(sb, eb); });
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const raw = await readRaw(req);
  if (!verify(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) { res.status(400).json({ ok: false, error: 'bad_signature' }); return; }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (e) { res.status(400).json({ ok: false, error: 'bad_json' }); return; }
  if (event.type !== 'checkout.session.completed') { res.status(200).json({ ok: true, ignored: event.type }); return; }

  const base = process.env.APPS_SCRIPT_URL, key = process.env.APPS_SCRIPT_SECRET;
  if (!base || !key) { res.status(500).json({ ok: false, error: 'not_configured' }); return; }
  try {
    const r = await fetch(base + (base.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'stripe', event }), redirect: 'follow'
    });
    const out = await r.text();
    let j; try { j = JSON.parse(out); } catch (e) { j = null; }
    if (!j || j.ok !== true) { console.error('apps script rejected', out.slice(0, 200)); res.status(502).json({ ok: false }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('forward failed', e && e.message);
    res.status(502).json({ ok: false }); // Stripe retries
  }
}
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.verify = verify;
