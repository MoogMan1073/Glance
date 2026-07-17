// boot.js — runs before styles load. Applies the saved theme immediately so the
// window never flashes the wrong colors, and guarantees the (initially hidden)
// window becomes visible even if the main script fails.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('smr-theme') || 'system'; } catch (e) {}
  var dark = pref === 'dark' ||
    (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.bootTheme = dark ? 'dark' : 'light';

  function showWindow() {
    if (window.__APP_SHOWN) return;
    window.__APP_SHOWN = true;
    try {
      var t = window.__TAURI__;
      if (t && t.window) {
        var w = t.window.getCurrentWindow();
        w.show();
        w.setFocus();
      }
    } catch (e) {}
  }
  window.__showAppWindow = showWindow;
  // Fallback: if app.js hasn't shown the window shortly after load, show it anyway.
  window.addEventListener('load', function () { setTimeout(showWindow, 700); });
})();
