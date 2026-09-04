import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { deleteStudyKit, transcribeVideo, useGenerateKit, useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import type { StudyKit, StudyKitInput } from '@workspace/api-client-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { saveKit, deleteKit as deleteStoredKit, saveProgress as saveIndexedProgress, loadKits, loadProgress } from '@/lib/kit-store';
import {
  ArrowLeft, ArrowRight, BookOpen, Brain, CalendarDays, Check, CheckCircle2, ChevronLeft,
  ChevronRight, Circle, CircleHelp, Clock3, FileText, GraduationCap, Home, Library,
  Menu, MoreHorizontal, PanelLeft, PenLine, Play, Plus, RotateCcw, Search, Sparkles,
  Target, UploadCloud, Video, Volume2, X
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AuthPage from '@/pages/auth';
import { getCurrentUser, getStoredUser, signOut, type AuthUser } from '@/lib/auth';
import './index.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const PDF_METADATA_HEADER = /^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i;

function cleanPdfText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !PDF_METADATA_HEADER.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pdfItemsToLines(items: Array<{ str?: string; transform?: number[] }>) {
  const lines = new Map<number, string[]>();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform?.[5] ?? 0);
    const line = lines.get(y) ?? [];
    line.push(item.str.trim());
    lines.set(y, line);
  }
  return [...lines.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, line]) => line.join(" "));
}

type Material = { name: string; kind: string; text: string; size?: string };
type Progress = { reviewed: string[]; completedTasks: string[]; answers: Record<string, number>; lastOpened?: string };
type LocalKit = StudyKit & { id: string; materials: Material[]; createdAt: string };

const queryClient = new QueryClient();
const STORAGE = 'lecture-study-kits';
const PROGRESS = 'lecture-study-progress';
const CALENDAR_STORAGE = 'lecture-study-calendar';
const DELETED_KITS = 'lecture-study-deleted-kits';
type StudySession = { id: string; date: string; title: string; kitId?: string; minutes: number };

const demoKit: LocalKit = {
  id: 'cognitive-science-demo',
  title: 'How We Remember',
  courseLabel: 'PSYC 204 · Cognitive Science',
  overview: 'A focused guide to the architecture of memory: from the first spark of attention to the stories we tell ourselves about the past.',
  chapters: [
    { id: 'encoding', title: 'Encoding & Attention', summary: 'Memory begins before storage. Attention selects the signals that will become meaningful enough to keep.', keyPoints: ['Selective attention filters competing sensory input.', 'Deep, elaborative encoding creates stronger traces.', 'Working memory holds roughly four meaningful chunks at once.'], objective: 'Explain how attention changes what gets encoded.' },
    { id: 'storage', title: 'Storage & Consolidation', summary: 'New memories stabilize over time, moving from a fragile state into distributed long-term representations.', keyPoints: ['The hippocampus binds details into an episode.', 'Sleep supports consolidation and integration.', 'Retrieval itself can strengthen or distort a memory.'], objective: 'Compare short-term stabilization with long-term consolidation.' },
    { id: 'retrieval', title: 'Retrieval & Forgetting', summary: 'Remembering is an active reconstruction shaped by cues, context, and what happened after the original event.', keyPoints: ['Specific cues unlock otherwise inaccessible memories.', 'Interference explains many everyday forgetting experiences.', 'Confidence and accuracy are separate measures.'], objective: 'Use retrieval cues to account for patterns of forgetting.' },
  ],
  reviewPlan: [
    { day: 1, label: 'Start here', focus: 'Build the map', tasks: ['Read the overview and chapter summaries', 'Make a two-column attention example'], minutes: 25 },
    { day: 2, label: 'Connect', focus: 'Encoding & attention', tasks: ['Review key points', 'Complete 6 flashcards'], minutes: 30 },
    { day: 3, label: 'Sleep on it', focus: 'Storage & consolidation', tasks: ['Explain consolidation aloud', 'Review yesterday’s cards'], minutes: 20 },
    { day: 4, label: 'Practice', focus: 'Retrieval cues', tasks: ['Take the practice exam', 'Mark two uncertain answers'], minutes: 35 },
    { day: 5, label: 'Repair', focus: 'Your weak spots', tasks: ['Revisit missed questions', 'Write one concrete example'], minutes: 25 },
    { day: 6, label: 'Mix it up', focus: 'All chapters', tasks: ['Shuffle flashcards', 'Teach a friend the memory model'], minutes: 30 },
    { day: 7, label: 'Light review', focus: 'Ready check', tasks: ['Scan the key points', 'Take three deep breaths before the exam'], minutes: 15 },
  ],
  questions: [
    { id: 'q1', chapterId: 'encoding', prompt: 'Which study approach most directly supports deep, elaborative encoding?', options: ['Rereading the same paragraph quickly', 'Connecting a concept to a personal example', 'Studying with louder music', 'Copying a definition three times'], answer: 1, explanation: 'Personal examples add meaning and associations, giving the idea more retrieval paths.', difficulty: 'Core' },
    { id: 'q2', chapterId: 'storage', prompt: 'What is the hippocampus especially important for?', options: ['Binding details into an episode', 'Detecting the brightness of a screen', 'Controlling reflexive breathing', 'Producing all long-term memories'], answer: 0, explanation: 'The hippocampus helps bind the elements of an event while a memory is being formed.', difficulty: 'Core' },
    { id: 'q3', chapterId: 'retrieval', prompt: 'Why can confidence be a poor guide to memory accuracy?', options: ['Confidence is never felt during recall', 'Confidence can be inflated by repetition or vivid detail', 'Accurate memories are always uncertain', 'Context has no effect on recall'], answer: 1, explanation: 'Vividness and repetition can make a recollection feel certain even when its details are wrong.', difficulty: 'Stretch' },
  ],
  flashcards: [
    { id: 'f1', chapterId: 'encoding', front: 'What is elaborative encoding?', back: 'Linking new information to meaning, prior knowledge, or examples so it has more routes for retrieval.', hint: 'Think beyond repetition.' },
    { id: 'f2', chapterId: 'encoding', front: 'What does attention do in memory?', back: 'It selects a limited portion of incoming information for deeper processing.', hint: 'A gate, not a camera.' },
    { id: 'f3', chapterId: 'storage', front: 'What is consolidation?', back: 'The gradual stabilization and integration of a newly formed memory over time.', hint: 'It is slower than encoding.' },
    { id: 'f4', chapterId: 'storage', front: 'How does sleep help memory?', back: 'Sleep supports the neural reorganization that strengthens and integrates memories.', hint: 'The brain keeps working.' },
    { id: 'f5', chapterId: 'retrieval', front: 'Why do retrieval cues help?', back: 'They provide a path or context that makes a stored memory easier to access.', hint: 'A handle for a drawer.' },
    { id: 'f6', chapterId: 'retrieval', front: 'What is interference?', back: 'When competing memories make it harder to retrieve the target memory.', hint: 'Old and new can compete.' },
  ],
  materials: [{ name: 'lecture-07-memory.pdf', kind: 'slides', text: 'Demo lecture slides' }],
  createdAt: new Date().toISOString(),
};

function getDeletedKitIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_KITS) || '[]')); } catch { return new Set(); }
}

function readKits(): LocalKit[] {
  const deleted = getDeletedKitIds();
  try {
    const raw = localStorage.getItem(STORAGE);
    const parsed = raw === null ? [demoKit] : JSON.parse(raw);
    const kits = Array.isArray(parsed) ? parsed : [demoKit];
    return kits.filter((kit): kit is LocalKit => Boolean(kit?.id) && !deleted.has(kit.id));
  } catch {
    return [demoKit].filter((kit) => !deleted.has(kit.id));
  }
}

function saveKits(kits: LocalKit[]) {
  const deleted = getDeletedKitIds();
  const active = kits.filter((kit) => !deleted.has(kit.id));
  localStorage.setItem(STORAGE, JSON.stringify(active));
  active.forEach((kit) => void saveKit(kit));
}
function readProgress(id: string): Progress {
  try { return JSON.parse(localStorage.getItem(`${PROGRESS}-${id}`) || 'null') || { reviewed: [], completedTasks: [], answers: {} }; } catch { return { reviewed: [], completedTasks: [], answers: {} }; }
}
function saveProgress(id: string, progress: Progress) {
  localStorage.setItem(`${PROGRESS}-${id}`, JSON.stringify(progress));
  void saveIndexedProgress({ ...progress, id });
}
function readSessions(): StudySession[] { try { return JSON.parse(localStorage.getItem(CALENDAR_STORAGE) || '[]'); } catch { return []; } }
function saveSessions(sessions: StudySession[]) { localStorage.setItem(CALENDAR_STORAGE, JSON.stringify(sessions)); }
function makeId() { return `kit-${Date.now()}`; }
function Brand() {
  return <Link href="/" className="focus-ring flex items-center gap-3" data-testid="link-brand">
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap size={19} /></span>
    <span className="font-serif text-[17px] tracking-[-.02em] text-foreground">study kit</span>
  </Link>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const user = getStoredUser();
  const displayName = user?.name || 'Student';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 60000 } });
  const nav = [
    { href: '/', label: 'My kits', icon: Library },
    { href: '/new', label: 'New study kit', icon: Plus },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  ];
  return <div className="grain min-h-[100dvh] bg-background text-foreground">
    <aside className={`fixed inset-y-0 left-0 z-30 w-[248px] border-r border-sidebar-border bg-sidebar px-5 py-6 transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between"><Brand /><button className="focus-ring rounded-md p-1 text-muted-foreground md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-sidebar"><X size={18} /></button></div>
      <div className="mt-12 px-2 text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">Workspace</div>
      <nav className="mt-3 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`focus-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${location === href ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{href === '/new' && <span className="ml-auto text-primary"><ArrowRight size={14} /></span>}</Link>)}
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
        <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><Home size={14} /> <span className="text-muted-foreground/50">/</span> <span>{location === '/' ? 'Library' : location === '/new' ? 'New kit' : 'Study space'}</span></div>
        <div className="ml-auto flex items-center gap-4"><div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Saved locally</div><button onClick={() => { void signOut().finally(() => window.location.reload()); }} title="Log out" className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary text-xs font-medium text-foreground hover:border-primary/60" aria-label={`Log out ${displayName}`}>{displayName.slice(0, 2).toUpperCase()}</button></div>
      </header>
      {children}
    </main>
  </div>;
}

function LibraryPage() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const [, setLocation] = useLocation();
  const [kits, setKits] = useState<LocalKit[]>([]);
  const [kitsReady, setKitsReady] = useState(false);
  const deletedDuringLoad = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const localSnapshot = readKits();
    setKits(localSnapshot);

    void loadKits().then((stored) => {
      if (cancelled) return;
      const deleted = deletedDuringLoad.current;
      const next = (stored as LocalKit[]).filter((kit) => !deleted.has(kit.id) && !getDeletedKitIds().has(kit.id));
      setKits(next.length > 0 ? next : localSnapshot.filter((kit) => !deleted.has(kit.id) && !getDeletedKitIds().has(kit.id)));
      setKitsReady(true);
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!kitsReady) return;
    saveKits(kits);
  }, [kits, kitsReady]);

  const remove = async (id: string) => {
    if (!window.confirm('Permanently delete this study kit?')) return;

    // The local tombstone, localStorage removal, IndexedDB cleanup, and React
    // state update all happen before the server request. Server availability
    // must never decide whether a local deletion is real.
    deletedDuringLoad.current.add(id);
    deleteStoredKit(id);
    setKits(prev => prev.filter(k => k.id !== id));

    try {
      await deleteStudyKit(id);
    } catch {
      // The server is best-effort. The local kit remains deleted regardless of
      // a network/API failure, and the tombstone blocks stale re-saves/loads.
    }
  };
  return <section className="mx-auto max-w-6xl px-5 py-10 sm:px-9 sm:py-14">
    <div className="slide-up flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><p className="font-mono text-[11px] uppercase tracking-[.2em] text-primary">{greeting}, {displayName}</p><h1 className="mt-3 font-serif text-4xl leading-tight tracking-[-.04em] text-foreground sm:text-5xl">Your study workspace</h1><p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">Your study space for the ideas worth keeping.</p></div><Link href="/new" className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-create-kit"><Plus size={17} /> Create a study kit</Link></div>
    <div className="mt-14 flex items-center justify-between border-b border-border pb-3"><h2 className="text-sm font-semibold">Your kits <span className="ml-1 text-muted-foreground">{kits.length}</span></h2><button className="focus-ring flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setKits([...kits].sort((a, b) => a.title.localeCompare(b.title)))} data-testid="button-sort-kits"><Search size={14} /> Sort alphabetically</button></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      {kits.map((kit, index) => <KitCard key={kit.id} kit={kit} index={index} onOpen={() => setLocation(`/kit/${kit.id}`)} onRemove={() => remove(kit.id)} />)}
      <Link href="/new" className="focus-ring group flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/30 p-6 text-center transition-colors hover:border-primary/60 hover:bg-card/60" data-testid="link-empty-create-kit"><span className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors group-hover:border-primary group-hover:text-primary"><Plus size={19} /></span><span className="mt-4 text-sm font-medium">Start another kit</span><span className="mt-1 text-xs text-muted-foreground">Slides, notes, or pasted text</span></Link>
    </div>
    <div className="mt-14 grid gap-4 md:grid-cols-3">
      {[['01', 'Bring the material', 'Add the notes, slides, or text you already have.'], ['02', 'Get the shape of it', 'Your material becomes a map, a review plan, and practice.'], ['03', 'Study one thing', 'Short sessions keep the useful parts close.']].map(([n, title, copy]) => <div key={n} className="border-t border-border pt-4"><span className="font-mono text-xs text-primary">{n}</span><h3 className="mt-5 text-sm font-semibold">{title}</h3><p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">{copy}</p></div>)}
    </div>
  </section>;
}

function KitCard({ kit, index, onOpen, onRemove }: { kit: LocalKit; index: number; onOpen: () => void; onRemove: () => void }) {
  const progress = readProgress(kit.id);
  const pct = Math.min(100, Math.round((progress.reviewed.length / Math.max(1, kit.flashcards.length)) * 100));
  return <article className={`slide-up delay-${Math.min(index + 1, 3)} group relative overflow-hidden rounded-xl border border-card-border bg-card p-6 shadow-sm transition-transform hover:-translate-y-0.5`}>
    <div className="absolute right-0 top-0 h-28 w-28 rounded-bl-full bg-primary/5" />
    <div className="relative flex items-start justify-between"><div><span className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">{kit.courseLabel}</span><h3 className="mt-3 font-serif text-2xl tracking-[-.03em]">{kit.title}</h3></div><button className="focus-ring rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onRemove} aria-label={`Remove ${kit.title}`} data-testid={`button-remove-kit-${kit.id}`}><MoreHorizontal size={17} /></button></div>
    <p className="relative mt-3 max-w-md text-sm leading-6 text-muted-foreground">{kit.overview}</p>
    <div className="relative mt-7 flex items-center gap-5 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><BookOpen size={14} /> {kit.chapters.length} chapters</span><span className="flex items-center gap-1.5"><Brain size={14} /> {kit.flashcards.length} cards</span><span className="flex items-center gap-1.5"><Clock3 size={14} /> 25 min</span></div>
    <div className="relative mt-6"><div className="mb-2 flex justify-between text-[11px]"><span className="text-muted-foreground">Review progress</span><span className="font-mono text-primary">{pct}%</span></div><div className="h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div></div>
    <button className="focus-ring relative mt-6 flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80" onClick={onOpen} data-testid={`button-open-kit-${kit.id}`}>Continue studying <ArrowRight size={15} /></button>
  </article>;
}

function NewPage() {
  const [, setLocation] = useLocation();
  const generate = useGenerateKit();
  const [title, setTitle] = useState('');
  const [syllabus, setSyllabus] = useState('');
  const [planDays, setPlanDays] = useState(7);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sourceMode, setSourceMode] = useState<'materials' | 'video'>('materials');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'form' | 'generating' | 'error'>('form');
  const [progress, setProgress] = useState(0);
  const [stageLabel, setStageLabel] = useState('Preparing your study space');
  const [error, setError] = useState('');
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Material[] = [];
    for (const file of Array.from(files)) {
      let text = file.type.startsWith('text/') ? await file.text() : `${file.name} uploaded for extraction`;
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const textItems = content.items.filter((item) => 'str' in item).map((item) => ({
            str: item.str,
            transform: Array.from(item.transform ?? []),
          }));
          pages.push(pdfItemsToLines(textItems).join("\n"));
        }
        text = cleanPdfText(pages.join('\n\n')) || `${file.name} contained no selectable text`;
      }
      next.push({ name: file.name, kind: file.type.includes('pdf') ? 'slides' : file.type.includes('presentation') ? 'slides' : 'notes', text, size: `${Math.max(1, Math.round(file.size / 1024))} KB` });
    }
    setMaterials(prev => [...prev, ...next]);
  };
  const submit = async () => {
    if (!title.trim() || (sourceMode === 'materials' && materials.length === 0) || (sourceMode === 'video' && !videoUrl.trim() && !videoFile)) { setError('Add a title and a lecture source to continue.'); return; }
    setError(''); setStage('generating'); setProgress(12);
    let generationMaterials = materials;
    if (sourceMode === 'video') {
      try {
        let transcript;
        if (videoFile) {
          const uploadResponse = await fetch('/api/transcribe-video-upload', {
            method: 'POST',
            headers: { 'Content-Type': videoFile.type || 'application/octet-stream', 'X-File-Name': videoFile.name },
            body: videoFile,
          });
          if (!uploadResponse.ok) {
            const payload = await uploadResponse.json().catch(() => null) as { error?: string } | null;
            throw new Error(payload?.error || 'Could not transcribe this upload.');
          }
          transcript = await uploadResponse.json() as { text: string; title: string };
        } else {
          transcript = await transcribeVideo({ url: videoUrl.trim() || null, fileName: null, fileData: null, mimeType: null });
        }
        generationMaterials = [{ name: transcript.title, kind: 'transcript', text: transcript.text }];
      } catch (transcriptionError) {
        setStage('error');
        setError(transcriptionError instanceof Error ? transcriptionError.message : 'Could not transcribe this video.');
        return;
      }
    }
    const steps = [['Reading your material', 31], ['Finding the through-line', 55], ['Writing review prompts', 78], ['Setting your first week', 94]] as const;
    steps.forEach(([label, value], i) => window.setTimeout(() => { setStageLabel(label); setProgress(value); }, (i + 1) * 850));
    const id = makeId();
    const payload: StudyKitInput = { id, title: title.trim(), planDays, syllabus: syllabus.trim() || null, materials: generationMaterials.map(({ name, kind, text }) => ({ name, kind, text })) };
    generate.mutate({ data: payload }, {
      onSuccess: result => {
        const kit: LocalKit = { ...result, id, materials: generationMaterials, createdAt: new Date().toISOString() };
        const kits = readKits().filter(k => k.id !== demoKit.id || k.title !== demoKit.title);
        saveKits([kit, ...kits]); setProgress(100); setStageLabel('Your kit is ready');
        window.setTimeout(() => setLocation(`/kit/${kit.id}`), 500);
      },
      onError: () => {
        setStage('error'); setError('The generator could not reach the study service. Your files are still here — try again or use a demo structure.');
      },
    });
  };
  const useLocalFallback = () => {
    const reviewPlan = Array.from({ length: planDays }, (_, index) => ({ ...demoKit.reviewPlan[index % demoKit.reviewPlan.length], day: index + 1 }));
    const kit = { ...demoKit, id: makeId(), title: title.trim() || 'Untitled study kit', courseLabel: 'Personal study space', overview: 'A starting structure for your material. Refine it as you study.', reviewPlan, materials, createdAt: new Date().toISOString() };
    saveKits([kit, ...readKits()]); setLocation(`/kit/${kit.id}`);
  };
  return <section className="mx-auto max-w-4xl px-5 py-10 sm:px-9 sm:py-14">
    <Link href="/" className="focus-ring inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-library"><ArrowLeft size={14} /> Back to library</Link>
    {stage === 'form' || stage === 'error' ? <div className="slide-up mt-12"><div className="max-w-xl"><p className="font-mono text-[11px] uppercase tracking-[.2em] text-primary">New study kit</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em] sm:text-5xl">Create a study kit</h1><p className="mt-4 text-sm leading-6 text-muted-foreground">Add what you have. We’ll turn it into a calm, focused space for the week ahead.</p></div>
       <div className="mt-12 space-y-8">
        <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">What are you studying?</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Week 7 · Memory & Cognition" className="focus-ring h-12 w-full rounded-lg border border-input bg-card px-4 text-sm outline-none placeholder:text-muted-foreground/60" data-testid="input-kit-title" /></label>
         <label className="block max-w-xs"><span className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">How many days do you have?</span><div className="flex items-center gap-3"><input type="number" min={1} max={30} value={planDays} onChange={e => setPlanDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} className="focus-ring h-12 w-24 rounded-lg border border-input bg-card px-4 text-sm outline-none" data-testid="input-plan-days" /><span className="text-xs text-muted-foreground">day review plan</span></div></label>
        <div><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Your source</span><span className="text-[11px] text-muted-foreground">{sourceMode === 'video' ? 'Video transcript' : `${materials.length}/8 added`}</span></div><div className="mb-3 flex gap-2"><button onClick={() => setSourceMode('materials')} className={`rounded-full border px-3 py-1.5 text-xs ${sourceMode === 'materials' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`} data-testid="button-source-materials">Slides & notes</button><button onClick={() => setSourceMode('video')} className={`rounded-full border px-3 py-1.5 text-xs ${sourceMode === 'video' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`} data-testid="button-source-video"><Video size={13} className="mr-1 inline" />Video</button></div>{sourceMode === 'video' ? <div className="grid gap-3 sm:grid-cols-2"><label className="rounded-xl border border-border bg-card p-4"><span className="text-sm font-medium">YouTube URL</span><input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="focus-ring mt-3 h-10 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none" data-testid="input-youtube-url" /></label><label className="rounded-xl border border-dashed border-primary/50 bg-primary/[.04] p-4"><input type="file" accept="video/mp4,audio/*,.mp4" className="sr-only" onChange={e => setVideoFile(e.target.files?.[0] || null)} data-testid="input-upload-video" /><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><UploadCloud size={18} /></span><span className="mt-3 block text-sm font-medium">{videoFile?.name || 'Upload MP4 or audio'}</span><span className="mt-1 block text-xs text-muted-foreground">We’ll extract the transcript before building your kit.</span></label></div> : <div className="grid gap-3 sm:grid-cols-2"><label className="focus-ring flex min-h-[122px] cursor-pointer flex-col justify-between rounded-xl border border-dashed border-primary/50 bg-primary/[.04] p-4 transition-colors hover:bg-primary/[.08]"><input type="file" multiple accept=".pdf,.ppt,.pptx,.txt,.md" className="sr-only" onChange={e => void addFiles(e.target.files)} data-testid="input-upload-materials" /><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"><UploadCloud size={18} /></span><span><span className="block text-sm font-medium">Upload slides or notes</span><span className="mt-1 block text-xs text-muted-foreground">PDF, PowerPoint, TXT, or Markdown</span></span></label><button disabled className="flex min-h-[122px] cursor-not-allowed flex-col justify-between rounded-xl border border-border bg-card/40 p-4 text-left opacity-60" data-testid="button-audio-coming-soon"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground"><Volume2 size={18} /></span><span><span className="block text-sm font-medium">Lecture audio <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Soon</span></span><span className="mt-1 block text-xs text-muted-foreground">Audio transcription is on its way</span></span></button></div>}
          {materials.length > 0 && <div className="mt-3 space-y-2">{materials.map((m, i) => <div key={`${m.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"><FileText size={15} className="text-primary" /><span className="min-w-0 flex-1 truncate text-xs">{m.name}</span><span className="font-mono text-[10px] text-emerald-300">Ready</span><button className="focus-ring rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => setMaterials(materials.filter((_, j) => j !== i))} aria-label={`Remove ${m.name}`} data-testid={`button-remove-material-${i}`}><X size={14} /></button></div>)}</div>}
        </div>
        <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Syllabus <span className="font-normal normal-case tracking-normal text-muted-foreground/70">optional</span></span><textarea value={syllabus} onChange={e => setSyllabus(e.target.value)} placeholder="Paste exam dates, learning goals, or a course outline…" rows={4} className="focus-ring w-full resize-none rounded-lg border border-input bg-card px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/60" data-testid="textarea-syllabus" /></label>
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs leading-5 text-red-200" data-testid="status-generation-error">{error}</div>}
        <div className="flex flex-col items-start justify-between gap-3 border-t border-border pt-6 sm:flex-row sm:items-center"><p className="max-w-sm text-xs leading-5 text-muted-foreground">Generation usually takes less than a minute. You can keep studying while it runs.</p><div className="flex gap-2"><button onClick={useLocalFallback} className="focus-ring rounded-lg border border-border px-4 py-2.5 text-xs font-medium hover:bg-secondary" data-testid="button-use-local-template">Use a starter structure</button><button onClick={submit} className="focus-ring flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90" data-testid="button-generate-kit"><Sparkles size={15} /> Build my kit <ArrowRight size={14} /></button></div></div>
      </div></div> : <GeneratingState progress={progress} label={stageLabel} />}
  </section>;
}

function GeneratingState({ progress, label }: { progress: number; label: string }) {
  return <div className="slide-up mx-auto max-w-xl py-20 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><Sparkles size={24} /></div><p className="mt-8 font-mono text-[11px] uppercase tracking-[.2em] text-primary">Making sense of it</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em]">A thoughtful kit<br />takes a minute.</h1><p className="mt-4 text-sm text-muted-foreground">{label}</p><div className="mt-10 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${progress}%` }} /></div><div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground"><span>Extracting</span><span>{progress}%</span><span>Organizing</span></div></div>;
}

function KitPage() {
  const { id } = useParams<{ id: string }>();
  const [kits] = useState(readKits);
  const kit = kits.find(k => k.id === id) || (id === demoKit.id ? demoKit : undefined);
  if (!kit) return <section className="p-10"><h1 className="font-serif text-3xl">Kit not found</h1><Link href="/" className="mt-4 inline-block text-primary" data-testid="link-return-library">Return to library</Link></section>;
  return <KitWorkspace kit={kit} />;
}

function KitWorkspace({ kit }: { kit: LocalKit }) {
  const [tab, setTab] = useState<'overview' | 'plan' | 'flashcards' | 'exam'>('overview');
  const [progress, setProgress] = useState<Progress>(() => readProgress(kit.id));
  useEffect(() => {
    void loadProgress(kit.id).then((stored) => {
      if (stored) {
        const { id: _id, ...rest } = stored;
        setProgress(rest);
      }
    });
  }, [kit.id]);
  const update = (patch: Partial<Progress>) => setProgress(prev => { const next = { ...prev, ...patch }; saveProgress(kit.id, next); return next; });
  const completed = progress.completedTasks.length;
  return <section className="mx-auto max-w-6xl px-5 py-8 sm:px-9 sm:py-11">
    <div className="flex flex-col justify-between gap-5 border-b border-border pb-7 sm:flex-row sm:items-end"><div><Link href="/" className="focus-ring mb-5 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="link-kit-back"><ArrowLeft size={14} /> Library</Link><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">{kit.courseLabel}</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em] sm:text-5xl">{kit.title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{kit.overview}</p></div><div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="rounded-full border border-border px-3 py-1.5">{kit.chapters.length} chapters</span><span className="rounded-full border border-border px-3 py-1.5">{kit.flashcards.length} cards</span></div></div>
    <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Kit sections">{(['overview', 'plan', 'flashcards', 'exam'] as const).map(item => <button key={item} onClick={() => setTab(item)} className={`focus-ring relative whitespace-nowrap px-4 pb-3 text-xs font-semibold capitalize ${tab === item ? 'text-primary after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`button-tab-${item}`}>{item === 'plan' ? '7-day plan' : item === 'exam' ? 'Practice exam' : item}</button>)}</nav>
    <div className="mt-8">{tab === 'overview' && <Overview kit={kit} onTab={setTab} />}{tab === 'plan' && <ReviewPlan kit={kit} progress={progress} update={update} />}{tab === 'flashcards' && <Flashcards kit={kit} progress={progress} update={update} />}{tab === 'exam' && <PracticeExam kit={kit} progress={progress} update={update} />}</div>
    <div className="mt-12 flex items-center gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground"><PanelLeft size={14} className="text-primary" /> Progress is saved locally in this browser.</div>
  </section>;
}

function Overview({ kit, onTab }: { kit: LocalKit; onTab: (tab: 'plan' | 'flashcards' | 'exam') => void }) {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const askTutor = async () => {
    if (!prompt.trim()) return;
    setAsking(true); setAnswer('');
    try {
      const context = JSON.stringify({ title: kit.title, overview: kit.overview, chapters: kit.chapters, flashcards: kit.flashcards, questions: kit.questions });
      const response = await fetch('/api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt.trim(), context }) });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6)) as { content?: string };
            if (event.content) setAnswer((current) => current + event.content);
          }
        }
      }
    } catch { setAnswer('The tutor is unavailable right now. Try restating the idea in your own words, then compare it with the chapter summary.'); }
    finally { setAsking(false); }
  };
  return <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]"><div><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">The shape of this lecture</h2><span className="font-mono text-[10px] text-muted-foreground">{kit.chapters.length} chapters</span></div><div className="space-y-3">{kit.chapters.map((chapter, i) => <article key={chapter.id} className="paper-surface group rounded-xl p-5 shadow-md transition-transform hover:-translate-y-0.5"><div className="flex gap-4"><span className="font-mono text-xs text-indigo-700/60">0{i + 1}</span><div className="flex-1"><h3 className="font-serif text-xl tracking-[-.025em]">{chapter.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{chapter.summary}</p><div className="mt-4 flex flex-wrap gap-2">{chapter.keyPoints.map(point => <span key={point} className="rounded-full bg-slate-900/[.06] px-2.5 py-1 text-[10px] text-slate-600">{point}</span>)}</div></div><ChevronRight size={17} className="mt-1 text-slate-400 transition-transform group-hover:translate-x-1" /></div></article>)}</div></div><div className="space-y-4"><div className="rounded-xl border border-primary/25 bg-primary/[.07] p-6"><div className="flex items-center gap-2 text-xs font-semibold text-primary"><Target size={15} /> Your next best move</div><h3 className="mt-5 font-serif text-2xl tracking-[-.03em]">Build the map first.</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Start with today’s short review, then come back tomorrow when the ideas have had time to settle.</p><button onClick={() => onTab('plan')} className="focus-ring mt-6 flex items-center gap-2 text-xs font-semibold text-primary" data-testid="button-start-review">Open day 1 <ArrowRight size={14} /></button></div><div className="rounded-xl border border-border bg-card p-6"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Quick study</h3><Clock3 size={17} className="text-muted-foreground" /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">A small win, right now. No setup required.</p><div className="mt-5 grid gap-2"><button onClick={() => onTab('flashcards')} className="focus-ring flex items-center gap-3 rounded-lg bg-secondary px-3 py-3 text-left text-xs hover:bg-secondary/80" data-testid="button-quick-flashcards"><Brain size={15} className="text-primary" /><span className="flex-1">Review flashcards</span><ArrowRight size={14} className="text-muted-foreground" /></button><button onClick={() => onTab('exam')} className="focus-ring flex items-center gap-3 rounded-lg bg-secondary px-3 py-3 text-left text-xs hover:bg-secondary/80" data-testid="button-quick-exam"><CircleHelp size={15} className="text-primary" /><span className="flex-1">Try the practice exam</span><ArrowRight size={14} className="text-muted-foreground" /></button></div></div><div className="rounded-xl border border-border bg-card p-6"><div className="flex items-center gap-2 text-xs font-semibold"><Sparkles size={15} className="text-primary" /> Explain differently</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Stuck on an idea? Ask for a simpler angle.</p><div className="mt-4 flex gap-2"><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void askTutor(); }} placeholder="What feels fuzzy?" className="focus-ring min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none" data-testid="input-tutor-prompt" /><button onClick={() => void askTutor()} disabled={asking || !prompt.trim()} className="focus-ring rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40" data-testid="button-ask-tutor">{asking ? 'Thinking…' : 'Ask'}</button></div>{answer && <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground" data-testid="text-tutor-answer">{answer}</p>}</div></div></div>;
}

function ReviewPlan({ kit, progress, update }: { kit: LocalKit; progress: Progress; update: (patch: Partial<Progress>) => void }) {
  const toggle = (task: string) => update({ completedTasks: progress.completedTasks.includes(task) ? progress.completedTasks.filter(t => t !== task) : [...progress.completedTasks, task] });
  const done = progress.completedTasks.length;
  return <div className="max-w-4xl"><div className="flex items-end justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">A week that compounds</p><h2 className="mt-3 font-serif text-3xl tracking-[-.03em]">Seven gentle steps.</h2><p className="mt-2 text-sm text-muted-foreground">Short sessions, spaced just enough to make the ideas stick.</p></div><span className="font-mono text-xs text-muted-foreground">{done}/{kit.reviewPlan.flatMap(d => d.tasks).length} tasks</span></div><div className="mt-8 space-y-3">{kit.reviewPlan.map(day => <div key={day.day} className={`rounded-xl border p-5 transition-colors ${day.day === 1 ? 'border-primary/40 bg-primary/[.05]' : 'border-border bg-card'}`}><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className="flex items-center gap-3 sm:w-44"><span className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-xs ${day.day === 1 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{String(day.day).padStart(2, '0')}</span><div><p className="text-[11px] text-muted-foreground">{day.label}</p><p className="text-sm font-semibold">{day.focus}</p></div></div><div className="flex-1 space-y-2">{day.tasks.map(task => <label key={task} className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" checked={progress.completedTasks.includes(task)} onChange={() => toggle(task)} className="peer sr-only" data-testid={`checkbox-task-${day.day}-${task.slice(0, 8)}`} /><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${progress.completedTasks.includes(task) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'}`}>{progress.completedTasks.includes(task) && <Check size={11} />}</span><span className={progress.completedTasks.includes(task) ? 'text-muted-foreground line-through' : 'text-foreground'}>{task}</span></label>)}</div><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 size={13} /> {day.minutes} min</span></div></div>)}</div></div>;
}

function CalendarPage() {
  const [kits] = useState(readKits);
  const [sessions, setSessions] = useState<StudySession[]>(readSessions);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState('');
  const [kitId, setKitId] = useState(kits[0]?.id || '');
  const [minutes, setMinutes] = useState(30);
  useEffect(() => saveSessions(sessions), [sessions]);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const start = new Date(year, monthIndex, 1).getDay();
  const dateKey = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const addSession = () => {
    if (!title.trim()) return;
    setSessions(prev => [...prev, { id: makeId(), date: selectedDate, title: title.trim(), kitId: kitId || undefined, minutes }]);
    setTitle('');
  };
  const selectedSessions = sessions.filter(session => session.date === selectedDate);
  const upcoming = sessions.filter(session => session.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const deadlines = kits.flatMap(kit => kit.reviewPlan.map(day => ({ date: new Date(Date.now() + (day.day - 1) * 86400000).toISOString().slice(0, 10), title: `${kit.title} · ${day.focus}` }))).filter(item => item.date >= new Date().toISOString().slice(0, 10)).slice(0, 5);
  return <section className="mx-auto max-w-6xl px-5 py-10 sm:px-9 sm:py-14"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="font-mono text-[11px] uppercase tracking-[.2em] text-primary">Study planner</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em] sm:text-5xl">Make room to remember.</h1><p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">Schedule focused sessions, assign kits to dates, and keep upcoming reviews in view.</p></div><div className="flex items-center gap-2"><button onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} className="rounded-lg border border-border px-3 py-2 text-xs">Previous</button><span className="min-w-32 text-center text-sm font-semibold">{month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</span><button onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} className="rounded-lg border border-border px-3 py-2 text-xs">Next</button></div></div><div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_.7fr]"><div className="rounded-2xl border border-border bg-card p-5 sm:p-7"><div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[.12em] text-muted-foreground">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <span key={day} className="py-2">{day}</span>)}{Array.from({ length: start }).map((_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => i + 1).map(day => { const date = dateKey(day); const count = sessions.filter(item => item.date === date).length; return <button key={date} onClick={() => setSelectedDate(date)} className={`min-h-16 rounded-lg border p-2 text-left text-xs transition-colors ${selectedDate === date ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border hover:bg-secondary'}`}><span className="font-mono">{day}</span>{count > 0 && <span className="mt-2 block rounded bg-primary/20 px-1.5 py-1 text-[10px] text-primary">{count} session{count > 1 ? 's' : ''}</span>}</button>; })}</div><div className="mt-6 border-t border-border pt-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Sessions on {selectedDate}</h2><span className="text-xs text-muted-foreground">{selectedSessions.length} planned</span></div>{selectedSessions.length === 0 ? <p className="mt-4 text-xs text-muted-foreground">Nothing scheduled yet.</p> : <div className="mt-3 space-y-2">{selectedSessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5 text-xs"><CalendarDays size={14} className="text-primary" /><span className="flex-1">{session.title}</span><span className="text-muted-foreground">{session.minutes} min</span><button onClick={() => setSessions(prev => prev.filter(item => item.id !== session.id))} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${session.title}`}>×</button></div>)}</div>}</div></div><aside className="space-y-4"><div className="rounded-xl border border-primary/25 bg-primary/[.07] p-5"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Add a session</p><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Review Vocabulary" className="focus-ring mt-4 h-10 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none" data-testid="input-session-title" /><select value={kitId} onChange={e => setKitId(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-xs" data-testid="select-session-kit"><option value="">No study kit</option>{kits.filter(kit => kit.id !== demoKit.id).map(kit => <option key={kit.id} value={kit.id}>{kit.title}</option>)}</select><div className="mt-2 flex gap-2"><input type="number" min={5} max={180} value={minutes} onChange={e => setMinutes(Number(e.target.value) || 30)} className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-xs" /><button onClick={addSession} className="flex-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground" data-testid="button-add-session">Schedule for {selectedDate}</button></div></div><div className="rounded-xl border border-border bg-card p-5"><h2 className="text-sm font-semibold">Upcoming sessions</h2>{upcoming.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">Your calendar is clear.</p> : <div className="mt-3 space-y-3">{upcoming.map(session => <button key={session.id} onClick={() => { setSelectedDate(session.date); const [y, m] = session.date.split('-').map(Number); setMonth(new Date(y, m - 1, 1)); }} className="flex w-full items-start gap-3 text-left text-xs"><span className="font-mono text-primary">{session.date.slice(5)}</span><span className="flex-1">{session.title}<span className="block mt-1 text-[10px] text-muted-foreground">{session.minutes} min</span></span></button>)}</div>}</div><div className="rounded-xl border border-border bg-card p-5"><h2 className="text-sm font-semibold">Review deadlines</h2><div className="mt-3 space-y-3">{deadlines.map(item => <div key={`${item.date}-${item.title}`} className="flex gap-3 text-xs"><span className="font-mono text-amber-300">{item.date.slice(5)}</span><span className="text-muted-foreground">{item.title}</span></div>)}</div></div></aside></div></section>;
}

function Flashcards({ kit, progress, update }: { kit: LocalKit; progress: Progress; update: (patch: Partial<Progress>) => void }) {
  const [index, setIndex] = useState(0); const [revealed, setRevealed] = useState(false);
  const card = kit.flashcards[index]; const reviewed = progress.reviewed.includes(card.id);
  const move = (direction: number) => { setRevealed(false); setIndex((index + direction + kit.flashcards.length) % kit.flashcards.length); };
  const mark = () => { if (!reviewed) update({ reviewed: [...progress.reviewed, card.id] }); setRevealed(true); };
  return <div className="mx-auto max-w-3xl"><div className="flex items-end justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Single-focus mode</p><h2 className="mt-3 font-serif text-3xl tracking-[-.03em]">One card at a time.</h2></div><span className="font-mono text-xs text-muted-foreground">{index + 1} / {kit.flashcards.length}</span></div><div className="mt-8 paper-surface relative min-h-[310px] rounded-2xl p-7 shadow-lg sm:p-12"><div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500"><span>Flashcard</span><span>{reviewed ? 'Reviewed' : 'In progress'}</span></div><div className="flex min-h-[205px] flex-col justify-center"><p className="font-serif text-3xl leading-snug tracking-[-.03em] sm:text-4xl">{revealed ? card.back : card.front}</p>{!revealed && card.hint && <p className="mt-5 text-xs italic text-slate-500">Hint: {card.hint}</p>}{revealed && <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.15em] text-indigo-700">Answer</p>}</div><div className="flex items-center justify-between border-t border-slate-900/10 pt-5"><button onClick={() => setRevealed(!revealed)} className="focus-ring flex items-center gap-2 text-xs font-semibold text-indigo-700" data-testid="button-reveal-card"><RotateCcw size={14} /> {revealed ? 'Hide answer' : 'Reveal answer'}</button><span className="text-[10px] text-slate-500">{kit.chapters.find(c => c.id === card.chapterId)?.title}</span></div></div><div className="mt-5 flex items-center justify-center gap-3"><button onClick={() => move(-1)} className="focus-ring flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-secondary" aria-label="Previous card" data-testid="button-previous-card"><ChevronLeft size={17} /></button><button onClick={mark} className={`focus-ring h-10 rounded-lg px-5 text-xs font-semibold ${reviewed ? 'border border-border bg-secondary' : 'bg-primary text-primary-foreground'}`} data-testid="button-mark-card">{reviewed ? 'Reviewed' : 'Mark as reviewed'}</button><button onClick={() => move(1)} className="focus-ring flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-secondary" aria-label="Next card" data-testid="button-next-card"><ChevronRight size={17} /></button></div><p className="mt-6 text-center text-xs text-muted-foreground">Use the arrow keys or buttons to move through the deck.</p></div>;
}

function PracticeExam({ kit, progress, update }: { kit: LocalKit; progress: Progress; update: (patch: Partial<Progress>) => void }) {
  const [index, setIndex] = useState(0); const [submitted, setSubmitted] = useState(false); const question = kit.questions[index]; const selected = progress.answers[question.id]; const score = kit.questions.filter(q => progress.answers[q.id] === q.answer).length;
  const choose = (option: number) => { if (!submitted) update({ answers: { ...progress.answers, [question.id]: option } }); };
  const next = () => { setSubmitted(false); setIndex((index + 1) % kit.questions.length); };
  return <div className="mx-auto max-w-3xl"><div className="flex items-end justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Closed-book practice</p><h2 className="mt-3 font-serif text-3xl tracking-[-.03em]">See what stayed.</h2></div><span className="rounded-full border border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">Score {score}/{kit.questions.length}</span></div><div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-9"><div className="flex items-center justify-between"><span className="font-mono text-xs text-primary">Question {index + 1} of {kit.questions.length}</span><span className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">{question.difficulty}</span></div><h3 className="mt-8 font-serif text-2xl leading-snug tracking-[-.025em] sm:text-3xl">{question.prompt}</h3><div className="mt-8 space-y-2.5">{question.options.map((option, i) => <button key={option} onClick={() => choose(i)} className={`focus-ring flex w-full items-center gap-3 rounded-lg border p-3.5 text-left text-sm transition-colors ${selected === i ? submitted ? i === question.answer ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-red-300/50 bg-red-300/10' : 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}`} data-testid={`button-answer-${question.id}-${i}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${selected === i ? 'border-primary text-primary' : 'border-muted-foreground/40 text-muted-foreground'}`}>{String.fromCharCode(65 + i)}</span>{option}{submitted && i === question.answer && <Check size={15} className="ml-auto text-emerald-300" />}</button>)}</div>{submitted && <div className="mt-6 rounded-lg border border-primary/20 bg-primary/[.06] p-4 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">Why:</span> {question.explanation}</div>}<div className="mt-7 flex justify-between border-t border-border pt-5"><button onClick={() => { setSubmitted(false); setIndex((index - 1 + kit.questions.length) % kit.questions.length); }} className="focus-ring flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="button-previous-question"><ChevronLeft size={15} /> Previous</button>{submitted ? <button onClick={next} className="focus-ring flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground" data-testid="button-next-question">Next question <ChevronRight size={14} /></button> : <button disabled={selected === undefined} onClick={() => setSubmitted(true)} className="focus-ring flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-check-answer">Check answer <Check size={14} /></button>}</div></div></div>;
}

function Router() {
  return <ErrorBoundary><Shell><Switch><Route path="/" component={LibraryPage} /><Route path="/new" component={NewPage} /><Route path="/calendar" component={CalendarPage} /><Route path="/kit/:id" component={KitPage} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}
function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void getCurrentUser().then(setUser).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  if (checking) return <main className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">Loading workspace…</main>;
  if (!user) return <AuthPage onAuthenticated={setUser} />;

  return <QueryClientProvider client={queryClient}><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;