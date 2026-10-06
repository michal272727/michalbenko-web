/* Vloženie kalkulačky na web klienta: <script src="https://michalbenko.sk/k/embed.js" data-firma="slug" async></script> */
(function () {
  var s = document.currentScript || (function () { var a = document.querySelectorAll('script[data-firma]'); return a[a.length - 1]; })();
  if (!s) return; var slug = s.getAttribute('data-firma'); if (!slug) return;
  var base = s.src.replace(/\/k\/embed\.js.*$/, '');
  var f = document.createElement('iframe');
  f.src = base + '/k/?f=' + encodeURIComponent(slug) + '&embed=1';
  f.title = 'Cenová kalkulačka'; f.loading = 'lazy';
  f.style.cssText = 'width:100%;border:0;display:block;min-height:620px;background:transparent;overflow:hidden';
  f.setAttribute('scrolling', 'no');
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'kalkulacka-height' || e.data.slug !== slug || e.source !== f.contentWindow) return;
    f.style.height = Math.max(400, e.data.h + 4) + 'px';
  });
})();
