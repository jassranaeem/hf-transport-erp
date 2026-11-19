/**
 * An installed app (desktop or phone) can stay open for days on the build it started with — a new deploy never
 * reaches it until it is closed. Two ways it hears about a newer build: the server's Alerts feed (an alert with an
 * "Update now" button, see server/alerts.ts) and this watcher, which asks now and then and shows a bar with
 * "Reload". The bar is plain DOM (not React) so it still shows if the app itself is broken. Production only.
 */

/** Update now: forget every saved copy of the app (service worker + caches) and load the live build. */
export async function applyUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  } catch {
    /* reload anyway */
  }
  try {
    const keys = (await window.caches?.keys?.()) || [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* reload anyway */
  }
  location.reload();
}

/** The build this page is running: the name of its hashed script ("/assets/index-XXXX.js"); "" in development. */
export function myBuild(): string {
  try {
    return document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute("src") || "";
  } catch {
    return "";
  }
}

export function watchForNewVersion() {
  if (typeof document === "undefined") return;
  const mine = myBuild();
  if (!mine) return;
  let shown = false;

  const show = () => {
    if (shown) return;
    shown = true;
    const bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;left:12px;right:12px;margin-inline:auto;width:fit-content;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483647;" +
      "display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:center;max-width:calc(100vw - 24px);padding:10px 14px;border-radius:12px;" +
      "background:#1E3A6B;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)";
    const text = document.createElement("span");
    text.textContent = "A new version is ready · نیا ورژن تیار ہے";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Reload · ری لوڈ";
    btn.style.cssText = "border:0;border-radius:8px;padding:6px 12px;background:#fff;color:#1E3A6B;font:700 13px system-ui,sans-serif;cursor:pointer";
    btn.onclick = () => {
      btn.textContent = "…";
      void applyUpdate();
    };
    const later = document.createElement("button");
    later.type = "button";
    later.textContent = "Later";
    later.style.cssText = "border:0;background:transparent;color:#C9D7EC;font:600 12px system-ui,sans-serif;cursor:pointer";
    later.onclick = () => {
      bar.remove();
      shown = false;
      setTimeout(() => void check(true), 30 * 60_000); // ask again in half an hour
    };
    bar.append(text, btn, later);
    document.body.appendChild(bar);
  };

  const check = async (force = false) => {
    if (shown || (document.hidden && !force)) return;
    try {
      const r = await fetch(`/index.html?v=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const html = await r.text();
      const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/);
      if (m && m[1] !== mine) show();
    } catch {
      /* offline or the server is waking: try again later */
    }
  };

  setTimeout(() => void check(), 20_000);
  setInterval(() => void check(), 5 * 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
  window.addEventListener("online", () => void check());
}
