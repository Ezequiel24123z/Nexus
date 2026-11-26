import React from 'react';
import { AlertTriangle, RefreshCw, Terminal } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('NEXUS UI ErrorBoundary:', error, info);
    void window.nexus?.invoke('logError', {
      source: 'ErrorBoundary',
      message: `${error?.stack || error?.message || error}\n${info?.componentStack || ''}`.slice(0, 2000),
    }).catch(() => {});
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--ink)' }}>
        <section className="panel-card" style={{ maxWidth: 540, width: '100%' }}>
          <div className="row" style={{ color: 'var(--err-fg)', marginBottom: 10 }}>
            <AlertTriangle size={20} />
            <h2 style={{ margin: 0 }}>Interface Render Recovery</h2>
          </div>
          <p className="hint">An unexpected rendering error occurred. Your chats, drafts, and workspace data are preserved.</p>
          <pre className="pre-box" style={{ maxHeight: 180, margin: '12px 0' }}>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          <div className="row">
            <button type="button" className="btn-primary" onClick={() => this.setState({ error: null })}><RefreshCw size={14} /> Recover UI</button>
            <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Reload App</button>
            <button type="button" className="btn-secondary" onClick={() => window.nexus?.invoke('openDevTools')}><Terminal size={14} /> DevTools</button>
          </div>
        </section>
      </div>
    );
  }
}
