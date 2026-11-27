// Aplicador síncrono de tema antes da primeira pintura (evita FOUC com CSP sem unsafe-inline).
(function () {
  try {
    var t = localStorage.getItem('ledgerly_theme');
    t = (t === 'dark' || t === 'light') ? t : 'default';
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', { default: '#090d16', dark: '#050505', light: '#f1f5f9' }[t]);
  } catch (e) {}
})();
