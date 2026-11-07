import { createRoot } from 'react-dom/client';

import App from './App';
import { startAuthSessionMaintenance } from '@/lib/auth';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

startAuthSessionMaintenance();

function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!, {
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(<Root />);
