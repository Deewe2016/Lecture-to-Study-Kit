import {
  ArrowRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  FileText,
  Folder,
  GraduationCap,
  MessageCircle,
  Play,
  Sparkles,
  Users,
} from 'lucide-react';
import { Link } from 'wouter';

const features = [
  {
    icon: Brain,
    title: 'AI Study Kits',
    description:
      'Upload a lecture, video, or notes. Get flashcards, quizzes, and a review plan instantly.',
  },
  {
    icon: MessageCircle,
    title: 'AI Chat',
    description:
      'Ask questions about your material or anything else. Powered by Groq.',
  },
  {
    icon: Folder,
    title: 'File Storage',
    description:
      'Store, organize, and share your files and documents in one place.',
  },
  {
    icon: CalendarDays,
    title: 'Calendar',
    description:
      'Schedule study sessions, set email reminders, and invite teammates.',
  },
  {
    icon: FileText,
    title: 'Documents',
    description:
      'Create and edit documents directly in Flexus. No Google Docs tab needed.',
  },
  {
    icon: Users,
    title: 'Team Chat',
    description:
      'Message your study group, create spaces, and share study kits instantly.',
  },
];

const audiences = [
  {
    title: 'Students',
    description:
      'Turn class notes and lectures into organized study materials without jumping between apps.',
  },
  {
    title: 'Science Olympiad Teams',
    description:
      'Keep event notes, study kits, files, schedules, and team conversations together.',
  },
  {
    title: 'Lifelong Learners',
    description:
      'Build a focused workspace for exploring new subjects, reviewing material, and staying organized.',
  },
];

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground flex-shrink-0">
        <GraduationCap size={19} />
      </span>
      <span className="font-serif text-[17px] tracking-[-.02em] text-foreground">Flexus</span>
    </Link>
  );
}

function DashboardMockup() {
  return (
    <div className="relative mx-auto mt-12 w-full max-w-5xl">
      <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-primary/10 blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/40">
        <div className="flex h-11 items-center gap-2 border-b border-border bg-sidebar px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          <div className="mx-auto hidden h-6 w-64 rounded-md border border-border bg-background/60 sm:block" />
        </div>

        <div className="grid min-h-[360px] grid-cols-[150px_1fr] sm:grid-cols-[190px_1fr]">
          <aside className="border-r border-border bg-sidebar p-3 sm:p-4">
            <div className="mb-6 flex items-center gap-2">
              <span className="h-7 w-7 rounded-lg bg-primary/15" />
              <span className="hidden text-xs font-semibold sm:block">Flexus</span>
            </div>
            <div className="space-y-2">
              {['Files', 'Study Kits', 'Calendar', 'Chat', 'AI Chat'].map(
                (item, index) => (
                  <div
                    key={item}
                    className={`rounded-lg px-2.5 py-2 text-[10px] sm:text-xs ${
                      index === 0
                        ? 'bg-sidebar-accent text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {item}
                  </div>
                ),
              )}
            </div>
          </aside>

          <div className="min-w-0 p-5 sm:p-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[.18em] text-primary">
                  Workspace
                </div>
                <div className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                  Good afternoon
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Everything you need for your next study session.
                </div>
              </div>
              <div className="hidden rounded-lg bg-primary px-3 py-2 text-[10px] font-semibold text-primary-foreground sm:block">
                + New Study Kit
              </div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {[
                ['AI Study Kit', 'Physics · Waves', '12 cards'],
                ['Lecture Notes', 'Chemistry · Unit 4', 'PDF'],
                ['Study Session', 'Friday · 4:00 PM', '45 min'],
              ].map(([title, subtitle, meta]) => (
                <div
                  key={title}
                  className="rounded-xl border border-border bg-background/50 p-3.5"
                >
                  <div className="h-7 w-7 rounded-lg bg-primary/10" />
                  <div className="mt-4 text-xs font-semibold">{title}</div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">
                    {subtitle}
                  </div>
                  <div className="mt-3 font-mono text-[9px] text-primary">
                    {meta}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl border border-border bg-background/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Recent study kits</span>
                <span className="text-[10px] text-muted-foreground">
                  View all
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {['Astronomy · Stars', 'Chemistry · Reactions', 'History · WW2'].map(
                  (item, index) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 border-t border-border pt-3 first:border-0 first:pt-0"
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary text-primary">
                        {index === 0 ? (
                          <Sparkles size={13} />
                        ) : (
                          <FileText size={13} />
                        )}
                      </div>
                      <span className="text-[10px] font-medium">{item}</span>
                      <span className="ml-auto text-[9px] text-muted-foreground">
                        Ready
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="grain min-h-[100dvh] scroll-smooth overflow-x-hidden bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Brand />
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/auth"
              className="focus-ring inline-flex min-h-10 items-center justify-center rounded-lg px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground sm:px-4 sm:text-sm"
            >
              Sign in
            </Link>
            <Link
              href="/auth"
              className="focus-ring inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/10 transition-transform hover:-translate-y-0.5 sm:px-4 sm:text-sm"
            >
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden px-5 pb-16 pt-20 sm:px-8 sm:pb-24 sm:pt-28">
        <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-primary/[.07] blur-3xl" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="slide-up inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-primary">
            <Sparkles size={12} />
            One workspace for every study session
          </div>
          <h1 className="slide-up delay-1 mt-7 text-5xl font-semibold tracking-[-.055em] sm:text-6xl md:text-7xl">
            Stop Toggling 5 Tabs
            <span className="block text-primary">Just to Study.</span>
          </h1>
          <p className="slide-up delay-2 mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Flexus brings your notes, flashcards, chat, calendar, and lecture
            videos into one clean AI workspace.
          </p>
          <div className="slide-up delay-3 mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth"
              className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/10 transition-transform hover:-translate-y-0.5 sm:w-auto"
            >
              Get started free
              <ArrowRight size={16} />
            </Link>
            <a
              href="#features"
              className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-6 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-card sm:w-auto"
            >
              <Play size={15} />
              See how it works
            </a>
          </div>
        </div>
        <DashboardMockup />
      </section>

      <section id="features" className="scroll-mt-20 border-y border-border/70 bg-card/[.28] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">
              Everything in one place
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              Everything you need. Nothing you don't.
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:gap-4 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="group rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-1 hover:border-primary/30 hover:bg-card/80 sm:p-5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon size={18} />
                  </span>
                </div>
                <h3 className="mt-5 text-sm font-semibold sm:text-base">{title}</h3>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              From lecture to ready in minutes.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {[
              ['01', 'Upload your material', 'Add notes, PDFs, videos, or paste text from anywhere.'],
              ['02', 'AI builds your kit', 'Flexus generates flashcards, a quiz, chapter summaries, and a review plan.'],
              ['03', 'Study and ace it', 'Review, practice, and track your progress all in one place.'],
            ].map(([number, title, description]) => (
              <article
                key={number}
                className="relative rounded-2xl border border-border bg-card p-6"
              >
                <div className="font-mono text-xs tracking-[.16em] text-primary">
                  {number}
                </div>
                <CheckCircle2 className="mt-8 text-primary" size={22} />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border/70 bg-card/[.28] px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">
            Who it's for
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
            Built for serious students.
          </h2>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {audiences.map(({ title, description }) => (
              <article
                key={title}
                className="rounded-2xl border border-border bg-card p-6"
              >
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-24 text-center sm:px-8 sm:py-32">
        <div className="mx-auto max-w-3xl rounded-3xl border border-primary/20 bg-primary/[.04] px-6 py-12 shadow-[0_0_80px_hsl(195_100%_62%_/_0.05)] sm:px-10">
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">
            Start studying
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-.05em] sm:text-5xl">
            Ready to study smarter?
          </h2>
          <p className="mt-4 text-sm text-muted-foreground sm:text-base">
            Join Flexus free. No credit card required.
          </p>
          <Link
            href="/auth"
            className="focus-ring mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/10 transition-transform hover:-translate-y-0.5"
          >
            Get started free
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Brand />
            <p className="mt-3 max-w-xs text-xs leading-5 text-muted-foreground">
              One clean AI workspace for learning, studying, and staying organized.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            <Link href="/auth" className="hover:text-foreground">Sign in</Link>
            <Link href="/auth" className="hover:text-foreground">Get started</Link>
          </div>

          <p className="text-[11px] text-muted-foreground sm:text-right">
            © 2026 Flexus. Built for students.
          </p>
        </div>
      </footer>
    </main>
  );
}
