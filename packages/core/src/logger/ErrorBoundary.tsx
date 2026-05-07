import { handleError } from "@gonogo/logger";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /**
   * Custom fallback rendered when a child throws. `reset` clears the error
   * state and retries the children — useful for isolated, recoverable
   * surfaces like dashboard widgets. When omitted, a plain message is shown.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    handleError(error);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <h1>Something went wrong.</h1>;
    }
    return this.props.children;
  }
}
