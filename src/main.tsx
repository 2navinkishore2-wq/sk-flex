import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './theme.css';
import './themes.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installDiagnostics } from './lib/diagnostics';
import { finishIntro, markIntroStart } from './lib/bootSplash';
import { applyTheme, loadCachedTheme } from './lib/themes';

declare global {
  interface Window {
    __skfbIntroStart?: number;
  }
}

// TEMP-DIAG: viewport snapshot + global error/lifecycle logging for the
// white-screen/landscape investigation (persists across a WebView restart).
installDiagnostics();

// The intro is already painting (static HTML). Record when it started so the
// five-second minimum is measured from the very first visible frame, and apply
// the cached theme before the first React render (no flash of the default).
markIntroStart(window.__skfbIntroStart || Date.now());
applyTheme(loadCachedTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

/**
 * Reveal the app after the full five-second intro. Auth and cached data keep
 * initializing behind the splash; if they are still running the app shows its
 * normal loading state instead of an empty screen.
 */
finishIntro();
