// Theme: "system" (default, follows the browser/OS), "light" or "dark". Classic script loaded in <head> so there is no flash.
(function () {
  var root = document.documentElement;
  function apply(t) {
    t = t === 'light' || t === 'dark' ? t : '';
    try { localStorage.setItem('sl-theme', t); } catch (e) {}
    if (t) root.dataset.theme = t; else delete root.dataset.theme;
  }
  try { var t0 = localStorage.getItem('sl-theme'); if (t0) root.dataset.theme = t0; } catch (e) {}
  if (globalThis.chrome && chrome.storage) {
    chrome.storage.local.get('settings', function (r) { apply(((r && r.settings) || {}).theme); });
    chrome.storage.onChanged.addListener(function (c, area) { if (area === 'local' && c.settings) apply((c.settings.newValue || {}).theme); });
  }
})();
