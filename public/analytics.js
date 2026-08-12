// === Google Analytics 4 — Activismo Sagrado ===
// 1) Creá una propiedad GA4 en https://analytics.google.com
// 2) Copiá tu "Measurement ID" (tiene forma G-XXXXXXXXXX)
// 3) Pegalo abajo reemplazando G-XXXXXXXXXX. Eso es todo.
(function () {
  var GA_ID = 'G-38833E1SXE'; // <-- ID de GA4 de Activismo Sagrado

  // helper global para eventos (no rompe si GA no está configurado)
  window.asTrack = function (name, params) {
    try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) {}
  };

  // Si todavía no se configuró el ID, no cargamos nada.
  if (!GA_ID || GA_ID.indexOf('XXXX') > -1) return;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
})();
