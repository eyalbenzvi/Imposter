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
 */
const SCRIPT = /assets\/index-[A-Za-z0-9_-]+\.js/;

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
    // on a stale build, so re-check whenever it comes back into view.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, stale, check]);

  return { stale, reload: () => window.location.reload() };
}
