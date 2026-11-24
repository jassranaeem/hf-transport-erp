/* If the app's own files fail to load or run (a stale copy kept on the phone), drop every saved copy and reload
   ONCE. Without this the screen just stays white. Runs before the app; a plain script so it still runs when the
   app's module does not. */
(function () {
  var KEY = "hfk_healed";
  function healed() { try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function heal() {
    if (healed()) return;
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    var jobs = [];
    try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    try { if (window.caches && caches.keys) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
  }
  // a script / style of the app that could not be loaded
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK") && (t.src || t.href || "").indexOf(location.origin + "/assets/") === 0) heal();
    else if (e && /Unexpected token '<'|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(String(e.message || ""))) heal();
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var m = String((e && e.reason && (e.reason.message || e.reason)) || "");
    if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(m)) heal();
  });
  // still nothing on screen after a while: the app did not start
  setTimeout(function () {
    var r = document.getElementById("root");
    if (r && r.childElementCount === 0 && !healed()) heal();
  }, 12000);
  // it started fine: the next problem may heal again
  window.addEventListener("load", function () {
    setTimeout(function () { var r = document.getElementById("root"); if (r && r.childElementCount > 0) { try { sessionStorage.removeItem(KEY); } catch (e) {} } }, 15000);
  });
})();
