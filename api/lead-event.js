// /api/lead-event — udalosti z funnelov (Meta leady) pre Zapier a Michala
// event "ukazka": lead otvoril ukážku (/ponuky?id=...) -> Zapier nastaví stav "Skúsil ukážku"
// event "brief":  lead vyplnil brief (/brief/web, /brief/automatizacia) -> e-mail Michalovi + Zapier stav "Brief vyplnený"
// Env: GMAIL_USER, GMAIL_APP_PASSWORD (ako /api/audit-submit), ZAPIER_LEAD_HOOK (Catch Hook v Zapieri)
const mail = require('./_lib/mail.js');

const TO_EMAIL = 'michalbenko3@gmail.com';
const FUNNELS = { A: 'Cenové ponuky', B: 'Web', C: 'Automatizácia' };

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
function clean(v, max) { return typeof v === 'string' ? v.replace(/[\r\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max || 200) : ''; }
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function forwardHook(payload) {
  const url = process.env.ZAPIER_LEAD_HOOK;
  if (!url) return;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  catch (e) { console.error('lead-event: hook failed', e && e.message); }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method_not_allowed' }); return; }
  let data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  data = data || {};
  if (clean(data.website)) { res.status(200).json({ ok: true }); return; } // honeypot

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const event = data.event === 'brief' ? 'brief' : (data.event === 'ukazka' ? 'ukazka' : '');
  const id = clean(data.id, 60).replace(/[^\w.-]/g, '');
  const funnel = FUNNELS[data.funnel] ? data.funnel : '';
  if (!event) { res.status(400).json({ ok: false, error: 'invalid_event' }); return; }

  try {
    if (event === 'ukazka') {
      // jedna udalosť na ID za hodinu, aby sa Zapier nezahltil obnovením stránky
      if (!id || limited('u:' + id, 1, 60 * 60e3) || limited('uip:' + ip, 30, 10 * 60e3)) { res.status(200).json({ ok: true, skipped: true }); return; }
      await forwardHook({ type: 'lead_event', event, id, funnel: 'A', at: new Date().toISOString() });
      res.status(200).json({ ok: true }); return;
    }

    // brief
    if (limited('b:' + ip, 5, 10 * 60e3)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
    if (!funnel || funnel === 'A') { res.status(400).json({ ok: false, error: 'invalid_funnel' }); return; }
    const email = clean(data.email, 160);
    const raw = data.answers && typeof data.answers === 'object' ? data.answers : {};
    const answers = {};
    Object.keys(raw).slice(0, 12).forEach(k => { answers[clean(k, 60)] = clean(String(raw[k]), 1200); });
    if (!id && !emailOk(email)) { res.status(400).json({ ok: false, error: 'invalid_input' }); return; }
    if (!Object.keys(answers).some(k => answers[k])) { res.status(400).json({ ok: false, error: 'empty' }); return; }

    const lines = Object.keys(answers).map(k => k + ': ' + (answers[k] || '-'));
    const text = 'Funnel: ' + FUNNELS[funnel] + '\nID leadu: ' + (id || '-') + '\nE-mail: ' + (email || '(v Sheete podľa ID)') + '\n\n' + lines.join('\n') + '\n';
    await mail.transport().sendMail({ from: mail.from('michalbenko.sk'), to: TO_EMAIL, replyTo: emailOk(email) ? email : undefined,
      subject: '📝 Brief vyplnený — ' + FUNNELS[funnel] + (id ? ' (' + id + ')' : ''), text });
    await forwardHook({ type: 'lead_event', event, id, funnel, email, answers, at: new Date().toISOString() });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead-event error', e && e.message);
    res.status(500).json({ ok: false, error: 'send_failed' });
  }
};
