/**
 * Keep the host's screen alive while a room is open.
 *
 * The host device *is* the server, so a locked phone takes the game with it.
 * Wake Lock is the only free lever available, and it is a partial one: it keeps
 * the screen on but does nothing about the user switching apps, and iOS then
 * suspends the tab and drops every data channel. `useHost` pairs this with a
 * `visibilitychange` recovery, and the lobby says so out loud.
 *
 * Every failure here is silent by design — an unsupported browser is not a
 * reason to refuse to run the game.
 */

type Sentinel = { release(): Promise<void>; addEventListener(t: string, cb: () => void): void };

type WakeLockCapableNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> };
};

export function keepScreenAwake(): () => void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const api = (navigator as WakeLockCapableNavigator).wakeLock;
  if (!api) return () => {};

  let sentinel: Sentinel | null = null;
  let released = false;

  const acquire = async (): Promise<void> => {
    if (released || sentinel || document.visibilityState !== 'visible') return;
    try {
      sentinel = await api.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      // Denied, unsupported, or the tab lost focus mid-request.
    }
  };

  // The lock is dropped whenever the tab goes away, so it has to be re-taken
  // every time the host comes back to the game.
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void acquire();
  };

  void acquire();
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    void sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
