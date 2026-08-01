import { lazy, Suspense, useState } from 'react';
import SoloApp from './SoloApp';
import { shouldStartOnline } from './online/storage';

/**
 * Two ways to play, and one decision about which.
 *
 * The single-device game is the default and is untouched: `SoloApp` is the old
 * `App` body, moved across verbatim. Everything about the online mode lives
 * behind a lazy import, so a group playing on one phone never downloads the
 * WebRTC stack at all.
 */
const OnlineApp = lazy(() => import('./online/OnlineApp'));

export default function App() {
  // A shared join link, or a room this device was already in, opens straight
  // into the online mode.
  const [online, setOnline] = useState(shouldStartOnline);

  if (!online) return <SoloApp onGoOnline={() => setOnline(true)} />;

  return (
    <Suspense fallback={null}>
      <OnlineApp onExit={() => setOnline(false)} />
    </Suspense>
  );
}
