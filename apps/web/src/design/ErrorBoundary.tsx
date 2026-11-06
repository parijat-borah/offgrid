import { Component, type ReactNode } from "react";
import { ErrorState } from "./States";

/**
 * Catches a crash in one screen so the header, navigation and emergency numbers stay usable.
 * Without it, any render error blanks the whole app, which is a bad failure on a trail.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    // Navigating to another screen clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="This screen hit a problem"
          detail={`${this.state.error.message}\n\nYour data is safe. Emergency: 112.`}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
