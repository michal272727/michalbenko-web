/* Cenník ukážkovej kalkulačky (okná a dvere). Zdieľa ho stránka /ponuky aj /api/quote-demo,
   aby cena na webe a v PDF bola vždy rovnaká. Čísla sú ilustračné, nie reálny cenník firmy. */
(function (root) {
  var P = {
    VAT: 0.23,
    VALID_DAYS: 14,
    MAX_ITEMS: 8,
    MATERIALS: {
      pvc:    { label: 'Plastové (PVC, 6-komorový profil)', m2: 135 },
      drevo:  { label: 'Drevené (europrofil 78 mm)',        m2: 290 },
      hlinik: { label: 'Hliníkové (s prerušeným mostom)',  m2: 340 }
    },
    GLASS: {
      dvoj: { label: 'Dvojsklo (Ug 1,1)', k: 1.00 },
      troj: { label: 'Trojsklo (Ug 0,6)', k: 1.12 }
    },
    COLOR: {
      biela: { label: 'Biela',             k: 1.00 },
      dekor: { label: 'Farebný dekor',     k: 1.18 }
    },
    TYPE: {
      okno:  { label: 'Okno',              k: 1.00 },
      balk:  { label: 'Balkónové dvere',   k: 1.15 }
    },
    OPENING: {
      fix: { label: 'Pevné',               k: 0.80 },
      ot:  { label: 'Otváravé',            k: 1.00 },
      so:  { label: 'Sklopno-otváravé',    k: 1.12 }
    },
    MIN_ITEM: 120,
    EXTRAS: {
      montaz:   { label: 'Montáž',                          unit: 'ks', price: 45 },
      demontaz: { label: 'Demontáž a odvoz starých okien',  unit: 'ks', price: 25 },
      parapetV: { label: 'Vnútorný parapet',                unit: 'bm', price: 22 },
      parapetZ: { label: 'Vonkajší parapet',                unit: 'bm', price: 28 },
      siet:     { label: 'Sieťka proti hmyzu',              unit: 'ks', price: 35 }
    },
    LIMITS: { w: [40, 300], h: [40, 260], n: [1, 20] }
  };

  function clampInt(v, lo, hi, def) {
    v = parseInt(v, 10);
    if (!isFinite(v)) return def;
    return Math.max(lo, Math.min(hi, v));
  }
  function pick(map, key, def) { return Object.prototype.hasOwnProperty.call(map, key) ? key : def; }
  function r2(x) { return Math.round(x * 100) / 100; }

  /* Normalizuje vstup (z prehliadača aj zo servera) a vypočíta ponuku. */
  P.calculate = function (input) {
    input = input || {};
    var material = pick(P.MATERIALS, input.material, 'pvc');
    var glass = pick(P.GLASS, input.glass, 'troj');
    var color = pick(P.COLOR, input.color, 'biela');
    var extras = input.extras || {};
    var rawItems = Array.isArray(input.items) ? input.items.slice(0, P.MAX_ITEMS) : [];
    if (!rawItems.length) rawItems = [{}];

    var lines = [], pieces = 0, widthM = 0;
    rawItems.forEach(function (it) {
      var type = pick(P.TYPE, it.type, 'okno');
      var opening = pick(P.OPENING, it.opening, 'so');
      var w = clampInt(it.w, P.LIMITS.w[0], P.LIMITS.w[1], 120);
      var h = clampInt(it.h, P.LIMITS.h[0], P.LIMITS.h[1], type === 'balk' ? 220 : 150);
      var n = clampInt(it.n, P.LIMITS.n[0], P.LIMITS.n[1], 1);
      var area = (w / 100) * (h / 100);
      var unit = area * P.MATERIALS[material].m2 * P.GLASS[glass].k * P.COLOR[color].k *
                 P.TYPE[type].k * P.OPENING[opening].k;
      unit = Math.max(P.MIN_ITEM, unit);
      unit = Math.round(unit);
      lines.push({
        kind: 'item', type: type, opening: opening, w: w, h: h, n: n,
        label: P.TYPE[type].label + ' ' + w + ' × ' + h + ' cm, ' + P.OPENING[opening].label.toLowerCase(),
        qty: n, unit: 'ks', unitPrice: unit, total: unit * n
      });
      pieces += n;
      if (type === 'okno') widthM += (w / 100) * n;
    });

    Object.keys(P.EXTRAS).forEach(function (key) {
      if (!extras[key]) return;
      var e = P.EXTRAS[key];
      var qty = e.unit === 'bm' ? r2(widthM) : pieces;
      if (!qty) return;
      lines.push({ kind: 'extra', key: key, label: e.label, qty: qty, unit: e.unit, unitPrice: e.price, total: Math.round(e.price * qty) });
    });

    var net = lines.reduce(function (s, l) { return s + l.total; }, 0);
    var vat = Math.round(net * P.VAT);
    return {
      material: material, glass: glass, color: color,
      materialLabel: P.MATERIALS[material].label, glassLabel: P.GLASS[glass].label, colorLabel: P.COLOR[color].label,
      lines: lines, pieces: pieces, net: net, vat: vat, gross: net + vat
    };
  };

  P.eur = function (x) {
    return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else root.PRICING = P;
})(this);
