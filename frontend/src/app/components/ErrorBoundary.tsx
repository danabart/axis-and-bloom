import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorReporter';

// Observability Foundation Part C — the last resort for a render error that
// nothing else caught. Reports via the same global reporter every other
// catch block in the app now uses (Part D), then renders a warm, on-brand
// fallback instead of a blank white screen. House-style copy: no jargon, no
// blame, a clear single action.

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError('[ErrorBoundary]', error, { componentStack: info.componentStack?.slice(0, 500) });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full min-h-screen bg-[#f2f1ea] flex items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <p className="text-[#a33726] text-xs uppercase tracking-[0.2em] mb-3">Something went sideways</p>
            <p className="text-[#45474a] text-sm mb-6">A refresh usually fixes it — we've made a note and we'll take a look.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-[#a33726] text-[#f2f1ea] py-4 px-8 text-xs uppercase tracking-[0.2em] hover:bg-[#8e2e1f] transition-colors"
            >
              Refresh the page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
