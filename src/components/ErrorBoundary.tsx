import { Component, type ErrorInfo, type ReactNode } from 'react';
import { diagLog } from '../lib/diagnostics';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * TEMP-DIAG (keep): prevents an uncaught React render/lifecycle error from
 * unmounting the whole tree into a blank white screen. The error is written to
 * the on-device diagnostic log (localStorage `skfb:diag:events` + console) and
 * a recoverable panel is shown instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    diagLog('react.errorboundary', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack
    });
    // eslint-disable-next-line no-console
    console.error('[skfb-diag] React render error caught:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="auth-page">
          <div className="auth-card" style={{ textAlign: 'left' }}>
            <div className="auth-title" style={{ fontSize: 18 }}>
              Something went wrong
            </div>
            <div className="setup-steps" style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8 }}>
                The error below was recorded in the on-device diagnostic log (<code>skfb:diag:events</code>).
              </div>
              <code style={{ wordBreak: 'break-all' }}>{this.state.error.message}</code>
            </div>
            <button
              className="btn btn-primary btn-block"
              onClick={() => window.location.reload()}
              style={{ marginTop: 6 }}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
