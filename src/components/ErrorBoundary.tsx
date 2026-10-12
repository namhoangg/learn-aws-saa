import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

interface State {
  error: Error | null;
}

class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Page failed to render:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page error-page" role="alert" data-render-error="true">
          <h1>Something went wrong on this page</h1>
          <p>The rest of the site still works. The error was:</p>
          <pre className="error-page__detail">{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Resets after navigation so one broken page does not stick. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
