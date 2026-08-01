import { useCallback, useEffect, useState } from 'react';

/**
 * Detects that a newer build has been published.
 *
 * GitHub Pages serves `index.html` with `cache-control: max-age=600`, and a
 * phone keeps a game tab alive for days. Because the asset filenames are
 * content-hashed, a cached `index.html` pins the browser to the OLD bundle —
 * the app looks up to date while silently missing everything shipped since.
 * That is not a hypothetical: it already cost a round of confusion over a
 * button that was live but invisible.
 *
 * So compare the script this page is running against the one a fresh copy of
 * `index.html` names. Any failure — offline, blocked, unexpected markup — is
 * treated as "nothing to report", because the game must keep working with no
 * network at all.
 *
 * Detecting the new build is only half of it: see `reload` below for why
 * `location.reload()` is not enough to actually get onto it.
 */
const SCRIPT = /assets\/index-[A-Za-z0-9_-]+\.js/;

/** How often an open tab re-checks. Cheap: one conditional-free HTML fetch. */
const POLL_MS = 60_000;

/**
 * Marks a navigation as "I am deliberately going around the HTTP cache".
 * Stripped from the address bar once the fresh page is up, so it never gets
 * bookmarked or shared.
 */
const BUST = 'fresh';

function runningScript(): string | null {
  for (const el of document.querySelectorAll<HTMLScriptElement>('script[src]')) {
    const match = el.getAttribute('src')?.match(SCRIPT);
    if (match) return match[0];
  }
  return null;
}

async function publishedScript(): Promise<string | null> {
  const res = await fetch('./index.html', { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.text()).match(SCRIPT)?.[0] ?? null;
}

/**
 * Loads the new build, rather than merely asking for it.
 *
 * `location.reload()` re-requests the *same* URL, and a still-fresh
 * `max-age=600` entry means the browser is entitled to answer that from disk
 * without going near the network — which is how a phone can sit on a banner
 * that says "new version available", tap it, and land right back on the old
 * bundle. A URL the cache has never seen has no such entry, so the HTML must
 * come off the network; the content-hashed assets it names then follow.
 *
 * Belt and braces around it: any Cache Storage entry and any service worker
 * left over from an earlier version of this app would outrank the HTTP cache,
 * so both are cleared first. The game currently registers neither — this is
 * here so that shipping one later cannot quietly resurrect the same bug.
 */
async function loadFreshBuild(): Promise<void> {
  try {
    await Promise.all([
      window.caches?.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
      navigator.serviceWorker
        ?.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister()))),
    ]);
  } catch {
    // Both are best-effort; a refusal here must not block the reload.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(BUST, String(Date.now()));
  // replace(), not assign(): the stale page should not sit in the back stack.
  window.location.replace(url.toString());
}

/**
 * Drops the cache-busting marker from the address bar. Same document, so it
 * costs nothing — the fresh HTML is already loaded and running.
 */
export function stripCacheBuster(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(BUST)) return;
  url.searchParams.delete(BUST);
  window.history.replaceState(null, '', url.toString());
}

export function useFreshBuild(enabled: boolean): { stale: boolean; reload: () => void } {
  const [stale, setStale] = useState(false);

  const check = useCallback(async () => {
    const mine = runningScript();
    if (!mine) return;
    try {
      const published = await publishedScript();
      if (published && published !== mine) setStale(true);
    } catch {
      // Offline or blocked: say nothing.
    }
  }, []);

  useEffect(() => {
    if (!enabled || stale) return;
    void check();
    // A tab that has been in the background for days is the usual way to end up
    // on a stale build, so re-check whenever it comes back into view — and on
    // `pageshow`, which is the only signal a bfcache restore gives.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    // A phone left on the setup screen mid-party never fires either event, so
    // poll as well: a deploy during the evening should still be picked up.
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.clearInterval(timer);
    };
  }, [enabled, stale, check]);

  return { stale, reload: () => void loadFreshBuild() };
}
