// GET /api/k-config?f=slug – verejná konfigurácia kalkulačky (bez interných údajov)
const { getConfig } = require('./_lib/as.js');
module.exports = async function handler(req, res) {
  const slug = String((req.query && req.query.f) || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (!slug) { res.status(400).json({ ok: false, error: 'missing' }); return; }
  try {
    const c = await getConfig(slug);
    if (!c || !c.ok) { res.status(c && c.error === 'inactive' ? 410 : 404).json({ ok: false, error: (c && c.error) || 'not_found' }); return; }
    const s = Object.assign({}, c.settings); delete s.email_dopyty;
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.status(200).json({ ok: true, balik: c.balik, settings: s, items: c.items });
  } catch (e) { console.error('k-config', e.message); res.status(500).json({ ok: false, error: 'server' }); }
};
