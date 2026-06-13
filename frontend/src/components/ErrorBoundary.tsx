import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', background: '#0a1117', color: '#a0b4c4', fontFamily: 'sans-serif',
        }}>
          <h1 style={{ color: '#FF00B8', fontFamily: 'monospace', marginBottom: '16px' }}>
            Algo salió mal
          </h1>
          <p style={{ marginBottom: '24px' }}>Ha ocurrido un error inesperado.</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.href = '/'; }}
            style={{
              padding: '12px 24px', background: '#FF00B8', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700,
            }}
          >
            Volver al inicio
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
