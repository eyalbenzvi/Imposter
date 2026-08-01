import { useEffect } from 'react';

/**
 * Stop the phone locking itself in the middle of a round.
 *
 * A party game is the worst case for a screen timeout: long stretches where
 * nobody touches the device — someone is talking, the group is arguing, a
 * discussion timer is running — and then a sudden need to tap. On the host's
 * phone in the online mode it is worse than an annoyance, because that device
 * *is* the server: it locking takes the room with it.
 *
 * Two things about the Screen Wake Lock API make this more than a one-liner:
 *
 *  • The lock is dropped automatically whenever the tab stops being visible,
 *    and is NOT restored when it comes back. Without re-taking it on
 *    `visibilitychange`, glancing at a notification silently ends the whole
 *    arrangement for the rest of the evening.
 *  • Requesting one while hidden throws. So the handler has to check first.
 *
 * Every failure is deliberately silent. The API is missing on older iOS
 * (before 16.4) and can be refused outright; neither is a reason to interrupt a
 * game, and there is no fallback worth the weight — the usual trick, a hidden
 * looping video, costs an embedded asset and can hijack the audio session.
 */
export function useKeepAwake(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return;

    const api = (navigator as WakeLockCapableNavigator).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async (): Promise<void> => {
      if (released || sentinel || document.visibilityState !== 'visible') return;
      try {
        const held = await api.request('screen');
        // The effect may have been torn down while we were awaiting.
        if (released) {
          void held.release().catch(() => {});
          return;
        }
        sentinel = held;
        held.addEventListener('release', () => {
          sentinel = null;
        });
      } catch {
        // Denied, unsupported, or the tab lost focus mid-request.
      }
    };

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
  }, [enabled]);
}

type WakeLockSentinel = {
  release(): Promise<void>;
  addEventListener(type: string, listener: () => void): void;
};

type WakeLockCapableNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
};
