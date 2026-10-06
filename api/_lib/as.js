// Klient pre Apps Script backend (Google tabuľky) + krátka cache konfigurácie v pamäti funkcie.
const cache = new Map();
async function call(payload) {
  const url = process.env.APPS_SCRIPT_URL, key = process.env.APPS_SCRIPT_KEY;
  if (!url || !key) throw new Error('apps_script_not_configured');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, key }), redirect: 'follow' });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { throw new Error('apps_script_bad_response'); }
}
async function getConfig(slug, maxAgeMs = 60e3) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.t < maxAgeMs) return hit.v;
  const v = await call({ action: 'config', slug });
  if (v && v.ok) cache.set(slug, { t: Date.now(), v });
  return v;
}
module.exports = { call, getConfig };
