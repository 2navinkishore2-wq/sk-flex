import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './theme.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installDiagnostics } from './lib/diagnostics';

// TEMP-DIAG: viewport snapshot + global error/lifecycle logging for the
// white-screen/landscape investigation (persists across a WebView restart).
installDiagnostics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
