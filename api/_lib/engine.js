/* Univerzálny výpočtový engine kalkulačky. Zdieľa ho prehliadač (k/index.html) aj server (/api/k-quote),
   takže cena na webe a v PDF je vždy rovnaká. Cenník a nastavenia pochádzajú z Google tabuľky klienta.

   Riadok cenníka: { id, kategoria, nazov, typ, cena, jednotka, nasobit, predvolene, min, max, popis }
   typ: 'mnozstvo' (globálny počet, napr. osoby / m²), 'vyber' (jedna možnosť z kategórie),
        'ano_nie' (zaškrtávací doplnok), 'pocet' (vlastný počet × cena)                                     */
(function (root) {
  var E = {};
  function num(v, d) { if (typeof v === 'number') return isFinite(v) ? v : d; v = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'); var n = parseFloat(v); return isFinite(n) ? n : d; }
  function yes(v) { v = String(v == null ? '' : v).trim().toLowerCase(); return v === 'áno' || v === 'ano' || v === 'a' || v === 'true' || v === '1' || v === 'x' || v === 'yes'; }
  function slugify(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
  var TYPES = { 'mnozstvo': 'mnozstvo', 'množstvo': 'mnozstvo', 'vyber': 'vyber', 'výber': 'vyber', 'ano/nie': 'ano_nie', 'áno/nie': 'ano_nie', 'ano_nie': 'ano_nie', 'doplnok': 'ano_nie', 'pocet': 'pocet', 'počet': 'pocet' };

  /* Normalizuje surové dáta z tabuľky (pole objektov podľa hlavičiek) na čistú konfiguráciu. */
  E.normalize = function (raw) {
    raw = raw || {}; var s = raw.settings || {};
    var settings = {
      firma: String(s.firma || 'Vaša firma'), logo: String(s.logo_url || ''), farba: /^#[0-9a-f]{6}$/i.test(s.farba || '') ? s.farba : '#2F6FED',
      nadpis: String(s.nadpis || 'Cenová ponuka do 60 sekúnd'), popis: String(s.popis || ''),
      platnost: Math.max(1, Math.round(num(s.platnost_dni, 14))),
      dph: yes(s.platca_dph) ? num(s.sadzba_dph, 23) : 0,
      rozpatie: String(s.zobrazenie_ceny || '').toLowerCase().indexOf('rozp') === 0,
      zlavaOd: Math.round(num(s.zlava_od_mnozstva, 0)), zlavaPerc: num(s.zlava_percent, 0),
      ctaText: String(s.tlacidlo_text || ''), ctaUrl: /^https?:\/\//.test(s.tlacidlo_odkaz || '') ? s.tlacidlo_odkaz : '',
      telefon: String(s.telefon || ''), web: String(s.web || ''), poznamka: String(s.poznamka_v_ponuke || ''),
      balik: String(raw.balik || 'standard')
    };
    var items = [], seen = {};
    (raw.items || []).forEach(function (r, i) {
      var typ = TYPES[String(r.typ || r['Typ'] || '').trim().toLowerCase()]; var nazov = String(r.nazov || r['Položka'] || '').trim();
      if (!typ || !nazov) return;
      var id = slugify(nazov) || ('p' + i); while (seen[id]) id += 'x'; seen[id] = 1;
      items.push({ id: id, kategoria: String(r.kategoria || r['Kategória'] || 'Ostatné').trim() || 'Ostatné', nazov: nazov, typ: typ,
        cena: num(r.cena != null ? r.cena : r['Cena (€)'], 0), jednotka: String(r.jednotka || r['Jednotka'] || '').trim(),
        nasobit: yes(r.nasobit != null ? r.nasobit : r['Násobiť množstvom']), predvolene: yes(r.predvolene != null ? r.predvolene : r['Predvolené']),
        def: num(r.predvolene != null ? r.predvolene : r['Predvolené'], 0),
        min: num(r.min != null ? r.min : r['Min'], typ === 'mnozstvo' ? 1 : 0), max: num(r.max != null ? r.max : r['Max'], 999),
        popis: String(r.popis || r['Popis'] || '').trim() });
    });
    var q = items.filter(function (i) { return i.typ === 'mnozstvo'; })[0] || null;
    var groups = []; var gi = {};
    items.forEach(function (it) { if (it.typ !== 'vyber') return; if (gi[it.kategoria] == null) { gi[it.kategoria] = groups.length; groups.push({ kategoria: it.kategoria, items: [] }); } groups[gi[it.kategoria]].items.push(it); });
    return { settings: settings, items: items, mnozstvo: q, groups: groups,
      pocty: items.filter(function (i) { return i.typ === 'pocet'; }), doplnky: items.filter(function (i) { return i.typ === 'ano_nie'; }) };
  };

  /* Predvolený výber podľa stĺpca Predvolené. */
  E.defaults = function (cfg) {
    var sel = { mnozstvo: cfg.mnozstvo ? Math.max(1, cfg.mnozstvo.def || cfg.mnozstvo.min) : 1, vyber: {}, ano: {}, pocet: {} };
    cfg.groups.forEach(function (g) { var d = g.items.filter(function (i) { return i.predvolene; })[0] || g.items[0]; sel.vyber[g.kategoria] = d.id; });
    cfg.doplnky.forEach(function (i) { if (i.predvolene) sel.ano[i.id] = true; });
    cfg.pocty.forEach(function (i) { sel.pocet[i.id] = Math.max(i.min, 0); });
    return sel;
  };

  function clampN(v, lo, hi) { v = Math.round(num(v, lo)); return Math.max(lo, Math.min(hi, v)); }
  function r2(x) { return Math.round(x * 100) / 100; }

  /* Výpočet ponuky – vstup z prehliadača sa vždy znovu validuje voči cenníku. */
  E.calculate = function (cfg, sel) {
    sel = sel || {}; var s = cfg.settings; var lines = [];
    var Q = cfg.mnozstvo ? clampN(sel.mnozstvo, Math.max(1, cfg.mnozstvo.min), cfg.mnozstvo.max) : 1;
    var qLabel = cfg.mnozstvo ? (cfg.mnozstvo.jednotka || 'ks') : 'ks';
    function add(it, qty) { var total = r2(it.cena * qty); lines.push({ label: it.nazov, qty: qty, unit: it.jednotka || (it.nasobit ? qLabel : 'ks'), unitPrice: it.cena, total: total, kategoria: it.kategoria }); }
    cfg.groups.forEach(function (g) {
      var id = (sel.vyber || {})[g.kategoria]; var it = g.items.filter(function (x) { return x.id === id; })[0] || g.items[0];
      if (it.cena !== 0 || g.items.length) add(it, it.nasobit ? Q : 1);
    });
    cfg.pocty.forEach(function (it) { var n = clampN((sel.pocet || {})[it.id], Math.max(0, it.min), it.max); if (n > 0) add(it, it.nasobit ? n * Q : n); });
    cfg.doplnky.forEach(function (it) { if ((sel.ano || {})[it.id]) add(it, it.nasobit ? Q : 1); });
    lines = lines.filter(function (l) { return l.total !== 0; });
    var subtotal = r2(lines.reduce(function (a, l) { return a + l.total; }, 0));
    var discount = 0;
    if (s.zlavaOd > 0 && s.zlavaPerc > 0 && Q >= s.zlavaOd) discount = r2(subtotal * s.zlavaPerc / 100);
    var net = r2(subtotal - discount); var vat = s.dph ? r2(net * s.dph / 100) : 0;
    var chosen = cfg.groups.map(function (g) { var id = (sel.vyber || {})[g.kategoria]; var it = g.items.filter(function (x) { return x.id === id; })[0] || g.items[0]; return g.kategoria + ': ' + it.nazov; });
    return { mnozstvo: Q, mnozstvoLabel: cfg.mnozstvo ? cfg.mnozstvo.nazov : '', lines: lines, subtotal: subtotal, discount: discount,
      discountLabel: discount ? ('Zľava ' + String(s.zlavaPerc).replace('.', ',') + ' % od ' + s.zlavaOd + ' ' + qLabel) : '',
      net: net, vat: vat, vatRate: s.dph, gross: r2(net + vat), chosen: chosen };
  };

  E.range = function (x) { return [Math.floor(x * 0.92 / 10) * 10, Math.ceil(x * 1.08 / 10) * 10]; };
  E.eur = function (x, dec) {
    var neg = x < 0; x = Math.abs(x); var d = dec == null ? (Math.round(x) === x ? 0 : 2) : dec;
    var p = x.toFixed(d).split('.'); var s = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? ',' + p[1] : '');
    return (neg ? '−' : '') + s + ' €';
  };
  E.slugify = slugify; E.num = num; E.yes = yes;

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.ENGINE = E;
})(this);
