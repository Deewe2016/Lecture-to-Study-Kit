import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Home,
  Library,
  Menu,
  MessageCircle,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { getStoredUser, signOut } from '@/lib/auth';

const SIDEBAR_STORAGE_KEY = 'study-kit-sidebar-collapsed';

function ChatBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <a href="/" className={`focus-ring flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`} data-testid="link-brand">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <GraduationCap size={19} />
      </span>
      {!collapsed && <span className="font-serif text-[17px] tracking-[-.02em] text-foreground">study kit</span>}
    </a>
  );
}

export default function ChatShell({ children }: { children: React.ReactNode }) {
  const user = getStoredUser();
  const displayName = user?.name || 'Student';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true');
  const location = window.location.pathname;

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  };

  const nav = [
    { href: '/', label: 'My kits', icon: Library },
    { href: '/new', label: 'New study kit', icon: Plus },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/chat', label: 'Chat', icon: MessageCircle },
    { href: '/ai-chat', label: 'AI Chat', icon: Sparkles },
  ];

  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-30 border-r border-sidebar-border bg-sidebar py-6 transition-all duration-200 md:translate-x-0 ${collapsed ? 'w-[72px] px-3' : 'w-[248px] px-5'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between">
          <ChatBrand collapsed={collapsed} />
          <button className="focus-ring rounded-md p-1 text-muted-foreground md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close sidebar" data-testid="button-close-sidebar">
            <X size={18} />
          </button>
        </div>

        {!collapsed && <div className="mt-12 px-2 text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">Workspace</div>}

        <nav className={`space-y-1 ${collapsed ? 'mt-12' : 'mt-3'}`}>
          {nav.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? label : undefined}
              className={`focus-ring flex items-center rounded-lg py-2.5 text-sm transition-colors ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} ${location === href ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground'}`}
              data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {!collapsed && <span>{label}</span>}
              {!collapsed && href === '/new' && <span className="ml-auto text-primary"><ArrowRight size={14} /></span>}
            </a>
          ))}
        </nav>

        {!collapsed && (
          <div className="absolute bottom-6 left-5 right-5 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-4">
            <div className="flex items-center gap-2 text-xs text-sidebar-accent-foreground"><span className="h-2 w-2 rounded-full bg-emerald-400" />Local workspace</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Your kits and progress stay in this browser.</p>
          </div>
        )}

        <button
          onClick={toggleCollapsed}
          className="focus-ring absolute -right-3 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground md:flex"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-testid="button-toggle-sidebar"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {mobileOpen && <button className="fixed inset-0 z-20 bg-background/60 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-dismiss-sidebar" />}

      <main className={`min-h-[100dvh] transition-[padding] duration-200 ${collapsed ? 'md:pl-[72px]' : 'md:pl-[248px]'}`}>
        <header className="flex h-[72px] items-center justify-between border-b border-border/70 px-5 sm:px-8">
          <button className="focus-ring rounded-md p-2 text-muted-foreground md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-sidebar"><Menu size={20} /></button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><Home size={14} /><span className="text-muted-foreground/50">/</span><span>{location === '/ai-chat' ? 'AI Chat' : 'Chat'}</span></div>
          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Saved locally</div>
            <button onClick={() => { void signOut().finally(() => window.location.reload()); }} title="Log out" className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary text-xs font-medium text-foreground hover:border-primary/60" aria-label={`Log out ${displayName}`}>
              {displayName.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
