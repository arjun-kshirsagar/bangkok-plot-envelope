import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearSceneHash } from '../store'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last line of defence: a bad scene (for example a hand-edited URL) must never leave a white screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] render error', error, info.componentStack)
  }

  reset = () => {
    clearSceneHash()
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-screen" role="alert">
        <div className="error-card">
          <h1>Something went wrong</h1>
          <p className="muted">The scene could not be rendered. This usually means the link carried an invalid plot or camera.</p>
          <pre>{this.state.error.message}</pre>
          <button type="button" className="primary" onClick={this.reset}>
            Reset scene
          </button>
        </div>
      </div>
    )
  }
}
