import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  GraduationCap,
  Home,
  Library,
  Menu,
  MessageCircle,
  Plus,
  X,
} from 'lucide-react';
import { getStoredUser, signOut } from '@/lib/auth';

function ChatBrand() {
  return (
    <a href="/" className="focus-ring flex items-center gap-3" data-testid="link-brand">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <GraduationCap size={19} />
      </span>
      <span className="font-serif text-[17px] tracking-[-.02em] text-foreground">study kit</span>
    </a>
  );
}

export default function ChatShell({ children }: { children: React.ReactNode }) {
  const user = getStoredUser();
  const displayName = user?.name || 'Student';
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = window.location.pathname;

  const nav = [
    { href: '/', label: 'My kits', icon: Library },
    { href: '/new', label: 'New study kit', icon: Plus },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/chat', label: 'Chat', icon: MessageCircle },
  ];

  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-30 w-[248px] border-r border-sidebar-border bg-sidebar px-5 py-6 transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between">
          <ChatBrand />
          <button className="focus-ring rounded-md p-1 text-muted-foreground md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-sidebar">
            <X size={18} />
          </button>
        </div>

        <div className="mt-12 px-2 text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">Workspace</div>

        <nav className="mt-3 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${location === href ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground'}`}
              data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {href === '/new' && <span className="ml-auto text-primary"><ArrowRight size={14} /></span>}
            </a>
          ))}
        </nav>

        <div className="absolute bottom-6 left-5 right-5 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-4">
          <div className="flex items-center gap-2 text-xs text-sidebar-accent-foreground"><span className="h-2 w-2 rounded-full bg-emerald-400" />Local workspace</div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Your kits and progress stay in this browser.</p>
        </div>
      </aside>

      {mobileOpen && <button className="fixed inset-0 z-20 bg-background/60 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-dismiss-sidebar" />}

      <main className="min-h-[100dvh] md:pl-[248px]">
        <header className="flex h-[72px] items-center justify-between border-b border-border/70 px-5 sm:px-8">
          <button className="focus-ring rounded-md p-2 text-muted-foreground md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-sidebar"><Menu size={20} /></button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><Home size={14} /><span className="text-muted-foreground/50">/</span><span>Chat</span></div>
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
