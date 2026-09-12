import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import ChatPage from './pages/chat';
import ChatShell from './pages/chat-shell';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

function ChatNavInjector() {
  useEffect(() => {
    let link: HTMLAnchorElement | null = null;

    const updateActive = () => {
      if (!link) return;
      const active = window.location.pathname === '/chat';
      link.className = `focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
      }`;
    };

    const addChatLink = () => {
      const nav = document.querySelector('aside nav');
      if (!nav || nav.querySelector('[data-chat-nav-link="true"]')) return;

      link = document.createElement('a');
      link.href = '/chat';
      link.dataset.chatNavLink = 'true';
      link.setAttribute('data-testid', 'link-nav-chat');
      link.className = 'focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground';

      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('width', '17');
      icon.setAttribute('height', '17');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.8');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.innerHTML = '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/>';

      const label = document.createElement('span');
      label.textContent = 'Chat';
      link.append(icon, label);
      nav.appendChild(link);

      link.addEventListener('click', updateActive);
      updateActive();
    };

    addChatLink();
    const observer = new MutationObserver(addChatLink);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (link) link.removeEventListener('click', updateActive);
    };
  }, []);

  return null;
}

function Root() {
  const isChat = window.location.pathname === '/chat';

  return (
    <ErrorBoundary>
      {!isChat && <ChatNavInjector />}
      {isChat ? (
        <ChatShell>
          <ChatPage />
        </ChatShell>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!, {
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(<Root />);
