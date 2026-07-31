import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Mobile browsers report `100vh` as the *largest* possible viewport, which
 * pushes content under the URL bar. Track the real height instead so no game
 * screen ever needs to scroll.
 */
function trackViewportHeight(): void {
  const apply = (): void => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  };
  apply();
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}

trackViewportHeight();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
