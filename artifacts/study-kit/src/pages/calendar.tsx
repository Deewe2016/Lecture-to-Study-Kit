import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  MapPin,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Loader2,
  Users,
  X,
} from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

type EmailReminder = {
  id: string;
  minutes_before: number;
};

type CalendarEvent = {
  id: string;
  owner_id: string;
  title: string;
  start_at: string;
  end_at: string;
  timezone: string;
  color: string;
  location: string | null;
  description: string | null;
  all_day: boolean;
  created_at: string;
  updated_at: string;
  recurrence_rule: RecurrenceRule | null;
  reminders: EmailReminder[];
  notify_invites: boolean;
  series_id?: string;
  occurrence_key?: string;
};


type RecurrenceEnd = {
  type: 'never' | 'date' | 'count';
  date?: string;
  count?: number;
};

type RecurrenceRule = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[];
  dayOfMonth?: number;
  month?: number;
  end?: RecurrenceEnd;
  exceptions?: string[];
  overrides?: Record<string, Partial<CalendarEvent>>;
};

type UserRow = { id: string; email: string; display_name: string };
type InviteRow = { id: string; event_id: string; user_id: string };
type AttachmentRow = {
  id: string;
  event_id: string;
  attachment_type: 'study_kit' | 'file';
  study_kit_id: string | null;
  file_id: string | null;
  name: string;
};
type StudyKitRow = { id: string; title: string; owner_id: string };
type FileRow = { id: string; name: string; type: string; owner_id: string };

const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const COLORS = [
  { id: 'tomato', label: 'Tomato', value: '#D50000' },
  { id: 'flamingo', label: 'Flamingo', value: '#E67C73' },
  { id: 'tangerine', label: 'Tangerine', value: '#F4511E' },
  { id: 'banana', label: 'Banana', value: '#F6BF26' },
  { id: 'sage', label: 'Sage', value: '#33B679' },
  { id: 'basil', label: 'Basil', value: '#0B8043' },
  { id: 'peacock', label: 'Peacock', value: '#039BE5' },
  { id: 'blueberry', label: 'Blueberry', value: '#3F51B5' },
  { id: 'lavender', label: 'Lavender', value: '#7986CB' },
  { id: 'grape', label: 'Grape', value: '#8E24AA' },
] as const;

const EVENT_COLOR = Object.fromEntries(COLORS.map((color) => [color.id, color.value]));

function api<T>(path: string, init: RequestInit = {}) {
  const token = getAccessToken();
  if (!token || !url || !anon) throw new Error('Calendar is not configured.');
  return fetch(url + path, {
    ...init,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  }).then(async (response) => {
    const body = await response.text();
    let data: unknown = null;
    try { data = body ? JSON.parse(body) : null; } catch { data = body; }
    if (!response.ok) {
      const message =
        typeof data === 'object' && data
          ? String((data as any).message || (data as any).details || (data as any).hint || `Request failed (${response.status})`)
          : `Request failed (${response.status})`;
      throw new Error(message);
    }
    return data as T;
  });
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function fullDateLabel(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function shortDate(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function localDateTimeInput(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string) {
  return new Date(value).toISOString();
}

function formatInputDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}


function cloneDateWithLocalDay(date: Date, day: Date) {
  const next = new Date(date);
  next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
  return next;
}

function occurrenceMatches(rule: RecurrenceRule, anchor: Date, candidate: Date) {
  if (candidate < startOfDay(anchor)) return false;
  const interval = Math.max(1, rule.interval || 1);
  const weekday = candidate.getDay();

  if (rule.frequency === 'daily') {
    const diff = Math.round((startOfDay(candidate).getTime() - startOfDay(anchor).getTime()) / 86400000);
    return diff % interval === 0 && (!rule.byWeekday?.length || rule.byWeekday.includes(weekday));
  }

  if (rule.frequency === 'weekly') {
    const anchorWeek = startOfWeek(anchor).getTime();
    const candidateWeek = startOfWeek(candidate).getTime();
    const weeks = Math.round((candidateWeek - anchorWeek) / (7 * 86400000));
    return weeks >= 0 && weeks % interval === 0 && (rule.byWeekday?.length ? rule.byWeekday.includes(weekday) : weekday === anchor.getDay());
  }

  if (rule.frequency === 'monthly') {
    const months = (candidate.getFullYear() - anchor.getFullYear()) * 12 + candidate.getMonth() - anchor.getMonth();
    const day = rule.dayOfMonth || anchor.getDate();
    return months >= 0 && months % interval === 0 && candidate.getDate() === day;
  }

  const years = candidate.getFullYear() - anchor.getFullYear();
  const month = rule.month || anchor.getMonth() + 1;
  const day = rule.dayOfMonth || anchor.getDate();
  return years >= 0 && years % interval === 0 && candidate.getMonth() + 1 === month && candidate.getDate() === day;
}

function generateEventOccurrences(baseEvents: CalendarEvent[], rangeStart: Date, rangeEnd: Date) {
  const output: CalendarEvent[] = [];

  for (const event of baseEvents) {
    if (!event.recurrence_rule) {
      if (eventOverlapsRange(event, rangeStart, rangeEnd)) output.push(event);
      continue;
    }

    const rule = event.recurrence_rule;
    const anchor = new Date(event.start_at);
    const duration = new Date(event.end_at).getTime() - anchor.getTime();
    const exceptions = new Set(rule.exceptions || []);
    const overrides = rule.overrides || {};
    let occurrenceCount = 0;

    for (let day = startOfDay(anchor); day < rangeEnd; day = addDays(day, 1)) {
      if (!occurrenceMatches(rule, anchor, day)) continue;

      const key = dateKey(day);
      occurrenceCount += 1;

      if (rule.end?.type === 'count' && occurrenceCount > Math.max(0, rule.end.count || 0)) break;
      if (rule.end?.type === 'date' && rule.end.date && key > rule.end.date) break;
      if (exceptions.has(key)) continue;

      const start = cloneDateWithLocalDay(anchor, day);
      const generated: CalendarEvent = {
        ...event,
        id: event.id + '::' + key,
        series_id: event.id,
        occurrence_key: key,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + duration).toISOString(),
      };

      const override = overrides[key];
      if (override) Object.assign(generated, override);
      if (eventOverlapsRange(generated, rangeStart, rangeEnd)) output.push(generated);
    }
  }

  return output.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
}

function eventOverlapsRange(event: CalendarEvent, rangeStart: Date, rangeEnd: Date) {
  const start = new Date(event.start_at).getTime();
  const end = new Date(event.end_at).getTime();
  return start < rangeEnd.getTime() && end > rangeStart.getTime();
}

function calendarRange(date: Date, view: 'month' | 'week' | 'day') {
  if (view === 'month') {
    const start = startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
    return { start, end: addDays(start, 42) };
  }
  if (view === 'week') {
    const start = startOfWeek(date);
    return { start, end: addDays(start, 7) };
  }
  const start = startOfDay(date);
  return { start, end: addDays(start, 1) };
}

function eventOverlapsDay(event: CalendarEvent, date: Date) {
  const dayStart = startOfDay(date).getTime();
  const dayEnd = addDays(startOfDay(date), 1).getTime();
  const start = new Date(event.start_at).getTime();
  const end = new Date(event.end_at).getTime();
  return start < dayEnd && end > dayStart;
}

function eventStyle(event: CalendarEvent) {
  return {
    backgroundColor: EVENT_COLOR[event.color] || EVENT_COLOR.blueberry,
  };
}

type PositionedEvent = {
  event: CalendarEvent;
  column: number;
  columnCount: number;
  top: number;
  height: number;
};

function layoutOverlappingEvents(events: CalendarEvent[], day: Date, rowHeight: number): PositionedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const visibleStart = dayStart + 7 * 60 * 60 * 1000;
  const visibleEnd = dayStart + 22 * 60 * 60 * 1000;

  const dayEvents = events
    .filter((event) => eventOverlapsDay(event, day))
    .map((event) => ({
      event,
      start: Math.max(new Date(event.start_at).getTime(), dayStart),
      end: Math.min(new Date(event.end_at).getTime(), dayEnd),
    }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const groups: Array<typeof dayEvents> = [];

  for (const item of dayEvents) {
    const currentGroup = groups[groups.length - 1];
    if (!currentGroup || item.start >= Math.max(...currentGroup.map((entry) => entry.end))) {
      groups.push([item]);
    } else {
      currentGroup.push(item);
    }
  }

  return groups.flatMap((group) => {
    const columns: Array<number> = [];
    const positioned = group.map((item) => {
      let column = 0;
      while (columns[column] !== undefined && columns[column] > item.start) column += 1;
      columns[column] = item.end;

      return { ...item, column };
    });

    const columnCount = Math.max(...positioned.map((item) => item.column)) + 1;

    return positioned.map(({ event, start, end, column }) => {
      const clippedStart = Math.max(start, visibleStart);
      const clippedEnd = Math.min(end, visibleEnd);
      const top = Math.max(0, ((clippedStart - visibleStart) / 3600000) * rowHeight);
      const durationHours = Math.max(0.5, (clippedEnd - clippedStart) / 3600000);

      return {
        event,
        column,
        columnCount,
        top,
        height: Math.max(30, durationHours * rowHeight - 2),
      };
    }).filter((item) => item.top < 15 * rowHeight && item.height > 0);
  });
}

function MiniCalendar({
  value,
  onChange,
  events,
}: {
  value: Date;
  onChange: (date: Date) => void;
  events: CalendarEvent[];
}) {
  const [month, setMonth] = useState(new Date(value.getFullYear(), value.getMonth(), 1));
  const first = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        <div className="flex">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-md p-1.5 hover:bg-secondary" aria-label="Previous month"><ChevronLeft size={15} /></button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-md p-1.5 hover:bg-secondary" aria-label="Next month"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[9px] font-medium text-muted-foreground">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
        {days.map((day) => {
          const active = dateKey(day) === dateKey(value);
          const today = dateKey(day) === dateKey(new Date());
          const hasEvent = events.some((event) => eventOverlapsDay(event, day));
          return (
            <button
              key={day.toISOString()}
              onClick={() => onChange(day)}
              className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[10px] ${day.getMonth() === month.getMonth() ? 'text-foreground' : 'text-muted-foreground/40'} ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'} ${today && !active ? 'font-bold ring-1 ring-primary/50' : ''}`}
            >
              {day.getDate()}
              {hasEvent && !active && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({ event, onClick, compact = false }: { event: CalendarEvent; onClick: () => void; compact?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-full truncate rounded-md px-2 py-1 text-left text-[10px] font-medium text-white shadow-sm hover:brightness-110 ${compact ? 'min-h-6' : ''}`}
      style={eventStyle(event)}
      title={event.title}
    >
      {!event.all_day && <span className="mr-1 opacity-80">{timeLabel(event.start_at)}</span>}
      {event.recurrence_rule && <Repeat size={10} className="mr-1 inline opacity-90" />}
      {event.title}
    </button>
  );
}

function MonthView({
  date,
  events,
  onSelectDay,
  onEvent,
}: {
  date: Date;
  events: CalendarEvent[];
  onSelectDay: (date: Date) => void;
  onEvent: (event: CalendarEvent) => void;
}) {
  const first = startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));

  return (
    <div className="min-w-[760px] overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-secondary/40">
        {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => (
          <div key={day} className="border-r border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground last:border-r-0">{day.slice(0, 3)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = events.filter((event) => eventOverlapsDay(event, day));
          const currentMonth = day.getMonth() === date.getMonth();
          const today = dateKey(day) === dateKey(new Date());
          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelectDay(day)}
              className="min-h-[125px] border-b border-r border-border p-2 text-left align-top hover:bg-secondary/30"
            >
              <div className={`mb-2 flex h-6 w-6 items-center justify-center rounded-full text-xs ${today ? 'bg-primary font-semibold text-primary-foreground' : currentMonth ? 'text-foreground' : 'text-muted-foreground/40'}`}>{day.getDate()}</div>
              <div className="space-y-1">
                {dayEvents.slice(0, 4).map((event) => <EventChip key={event.id} event={event} compact onClick={() => onEvent(event)} />)}
                {dayEvents.length > 4 && <p className="px-1 text-[9px] text-muted-foreground">+{dayEvents.length - 4} more</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({
  date,
  events,
  days,
  onEvent,
}: {
  date: Date;
  events: CalendarEvent[];
  days: Date[];
  onEvent: (event: CalendarEvent) => void;
}) {
  const hours = Array.from({ length: 15 }, (_, index) => index + 7);
  const gridDays = days.length ? days : [date];
  const rowHeight = 72;

  return (
    <div className="overflow-auto rounded-xl border border-border bg-card">
      <div className="min-w-[720px]">
        <div className="sticky top-0 z-10 grid border-b border-border bg-card" style={{ gridTemplateColumns: `64px repeat(${gridDays.length}, minmax(120px, 1fr))` }}>
          <div />
          {gridDays.map((day) => {
            const today = dateKey(day) === dateKey(new Date());
            return (
              <div key={day.toISOString()} className="border-l border-border px-2 py-3 text-center">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{day.toLocaleDateString(undefined, { weekday: 'short' })}</p>
                <p className={`mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-xs ${today ? 'bg-primary font-semibold text-primary-foreground' : ''}`}>{day.getDate()}</p>
              </div>
            );
          })}
        </div>
        <div className="relative grid" style={{ gridTemplateColumns: `64px repeat(${gridDays.length}, minmax(120px, 1fr))` }}>
          <div>
            {hours.map((hour) => (
              <div key={hour} className="relative border-b border-border" style={{ height: rowHeight }}>
                <span className="absolute -top-2 right-2 text-[9px] text-muted-foreground">{hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}</span>
              </div>
            ))}
          </div>
          {gridDays.map((day) => (
            <div key={day.toISOString()} className="relative border-l border-border">
              {hours.map((hour) => <div key={hour} className="border-b border-border" style={{ height: rowHeight }} />)}
              {layoutOverlappingEvents(events, day, rowHeight).map((item) => {
                const gapCount = Math.max(0, item.columnCount - 1);
                const width = `calc((100% - ${gapCount * 2}px) / ${item.columnCount})`;
                const left = `calc(${item.column} * ((100% - ${gapCount * 2}px) / ${item.columnCount} + 2px))`;

                return (
                  <button
                    key={item.event.id}
                    onClick={() => onEvent(item.event)}
                    className="absolute overflow-hidden rounded-md px-2 py-1 text-left text-[10px] font-medium text-white shadow-sm hover:brightness-110"
                    style={{
                      ...eventStyle(item.event),
                      top: item.top,
                      height: item.height,
                      width,
                      left,
                    }}
                  >
                    <div className="truncate">{item.event.recurrence_rule && <Repeat size={10} className="mr-1 inline opacity-90" />}{item.event.title}</div>
                    <div className="mt-0.5 opacity-80">{timeLabel(item.event.start_at)}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type AIEventDraft = { id: string; title: string; startTime: string; endTime: string; recurrence: 'none'|'daily'|'weekly'|'monthly'|'yearly'; daysOfWeek: string[]; color: string; startDate: string; endDate?: string };
const WEEKDAY_INDEX: Record<string,number> = { sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6 };
function cleanAIJson(value:string) { let v=value.replace(/```json\s*/gi,'').replace(/```/g,'').trim(); const a=v.indexOf('['),b=v.lastIndexOf(']'); return a>=0&&b>a?v.slice(a,b+1):v; }
function normalizeAIEvents(raw:any):AIEventDraft[] {
 if(!Array.isArray(raw)) throw new Error('The AI response did not contain an event list. Please try again.');
 return raw.map((item:any,i:number)=>{const cv=String(item?.color||'blueberry').toLowerCase();const aliases:Record<string,string>={blue:'blueberry',red:'tomato',pink:'flamingo',orange:'tangerine',yellow:'banana',green:'basil',purple:'grape'};const color=COLORS.some(c=>c.id===cv)?cv:aliases[cv]||'blueberry';const recurrence=['daily','weekly','monthly','yearly'].includes(String(item?.recurrence).toLowerCase())?String(item.recurrence).toLowerCase() as AIEventDraft['recurrence']:'none';const days=Array.isArray(item?.daysOfWeek)?item.daysOfWeek.map((d:any)=>String(d).toLowerCase()).filter((d:string)=>d in WEEKDAY_INDEX):[];return {id:'ai-'+Date.now()+'-'+i,title:String(item?.title||'Untitled event'),startTime:/^\d{1,2}:\d{2}$/.test(String(item?.startTime))?String(item.startTime).padStart(5,'0'):'09:00',endTime:/^\d{1,2}:\d{2}$/.test(String(item?.endTime))?String(item.endTime).padStart(5,'0'):'10:00',recurrence,daysOfWeek:[...new Set(days)],color,startDate:String(item?.date||item?.startDate||'today'),endDate:item?.endDate};});
}
function nextAIEventDate(startDate:string,recurrence:AIEventDraft['recurrence'],days:string[]) {const today=startOfDay(new Date());if(startDate.toLowerCase()!=='today'){const d=new Date(startDate+'T00:00:00');if(!Number.isNaN(d.getTime()))return d;}if(recurrence==='weekly'&&days.length){for(let n=1;n<=7;n++){const d=addDays(today,n);if(days.some(day=>WEEKDAY_INDEX[day]===d.getDay()))return d;}}return today;}
type CalendarErrorBoundaryProps = {
  children: ReactNode;
  onError?: (error: Error) => void;
};

type CalendarErrorBoundaryState = {
  error: Error | null;
};

class CalendarErrorBoundary extends Component<CalendarErrorBoundaryProps, CalendarErrorBoundaryState> {
  state: CalendarErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CalendarErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[100] flex min-h-[100dvh] items-center justify-center bg-background p-6">
          <div className="w-full max-w-lg rounded-xl border border-red-400/30 bg-card p-6 shadow-xl">
            <p className="font-serif text-2xl">Calendar editor error</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The event editor could not be opened. The calendar is still available.
            </p>
            <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 font-mono text-xs text-red-300">
              {this.state.error.message || 'Unknown calendar editor error'}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => this.setState({ error: null })}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-secondary"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function EventEditor({
  initialEvent,
  selectedDate,
  editScope,
  onClose,
  onSaved,
  onRequestDelete,
}: {
  initialEvent: CalendarEvent | null;
  selectedDate: Date;
  editScope: 'series' | 'occurrence';
  onClose: () => void;
  onSaved: () => void;
  onRequestDelete: (event: CalendarEvent) => void;
}) {
  const me = getStoredUser();
  const { toast } = useToast();
  const [title, setTitle] = useState(initialEvent?.title || '');
  const [start, setStart] = useState(initialEvent ? localDateTimeInput(initialEvent.start_at) : `${formatInputDate(selectedDate)}T09:00`);
  const [end, setEnd] = useState(initialEvent ? localDateTimeInput(initialEvent.end_at) : `${formatInputDate(selectedDate)}T10:00`);
  const [color, setColor] = useState(initialEvent?.color || 'blueberry');
  const [location, setLocation] = useState(initialEvent?.location || '');
  const [description, setDescription] = useState(initialEvent?.description || '');
  const [allDay, setAllDay] = useState(initialEvent?.all_day || false);
  const initialRule = initialEvent?.recurrence_rule || null;
  const initialWeekday = new Date(initialEvent?.start_at || start).getDay();
  const [repeatPreset, setRepeatPreset] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom'>(() => {
    if (!initialRule) return 'none';
    if (initialRule.frequency === 'daily' && initialRule.interval === 1 && !initialRule.byWeekday?.length) return 'daily';
    if (initialRule.frequency === 'weekly' && initialRule.interval === 1 && initialRule.byWeekday?.length === 1) return 'weekly';
    if (initialRule.frequency === 'monthly' && initialRule.interval === 1) return 'monthly';
    if (initialRule.frequency === 'yearly' && initialRule.interval === 1) return 'yearly';
    if (initialRule.frequency === 'weekly' && initialRule.interval === 1 && JSON.stringify(initialRule.byWeekday) === JSON.stringify([1,2,3,4,5])) return 'weekdays';
    return 'custom';
  });
  const [customFrequency, setCustomFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>(initialRule?.frequency || 'weekly');
  const [customInterval, setCustomInterval] = useState(Math.max(1, initialRule?.interval || 1));
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(initialRule?.byWeekday?.length ? initialRule.byWeekday : [initialWeekday]);
  const [customEndType, setCustomEndType] = useState<'never' | 'date' | 'count'>(initialRule?.end?.type || 'never');
  const [customEndDate, setCustomEndDate] = useState(initialRule?.end?.date || '');
  const [customOccurrences, setCustomOccurrences] = useState(initialRule?.end?.count || 10);
  const [reminders, setReminders] = useState<EmailReminder[]>(() => (
    Array.isArray(initialEvent?.reminders)
      ? initialEvent!.reminders.map((reminder) => ({
          id: reminder.id || `reminder-${Date.now()}-${Math.random()}`,
          minutes_before: Math.max(0, Number(reminder.minutes_before) || 0),
        }))
      : []
  ));
  const [notifyInvites, setNotifyInvites] = useState(Boolean(initialEvent?.notify_invites));
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<UserRow[]>([]);
  const [inviteSearch, setInviteSearch] = useState('');
  const [kits, setKits] = useState<StudyKitRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentType, setAttachmentType] = useState<'study_kit' | 'file'>('study_kit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorTab, setEditorTab] = useState<'manual'|'ai'>('manual');
  const [aiDescription, setAiDescription] = useState('');
  const [aiWeeks, setAiWeeks] = useState('12');
  const [aiColor, setAiColor] = useState('tomato');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiEvents, setAiEvents] = useState<AIEventDraft[]>([]);
  const [aiSuccess, setAiSuccess] = useState('');

  useEffect(() => {
    void Promise.all([
      api<UserRow[]>('/rest/v1/users?select=id,email,display_name&order=display_name.asc&limit=100'),
      api<StudyKitRow[]>('/rest/v1/study_kits?select=id,title,owner_id&order=updated_at.desc&limit=100'),
      api<FileRow[]>('/rest/v1/files?select=id,name,type,owner_id&owner_id=eq.' + me?.id + '&order=created_at.desc&limit=100'),
      initialEvent
        ? api<InviteRow[]>('/rest/v1/calendar_event_invites?select=id,event_id,user_id&event_id=eq.' + initialEvent.id)
        : Promise.resolve([] as InviteRow[]),
      initialEvent
        ? api<AttachmentRow[]>('/rest/v1/calendar_event_attachments?select=id,event_id,attachment_type,study_kit_id,file_id,name&event_id=eq.' + initialEvent.id)
        : Promise.resolve([] as AttachmentRow[]),
    ]).then(([userRows, kitRows, fileRows, inviteRows, attachmentRows]) => {
      setUsers(userRows.filter((user) => user.id !== me?.id));
      setKits(kitRows);
      setFiles(fileRows);
      setAttachments(attachmentRows);
      if (inviteRows.length) {
        const ids = new Set(inviteRows.map((row) => row.user_id));
        setInvites(userRows.filter((user) => ids.has(user.id)));
      }
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load event options.'));
  }, [initialEvent?.id, me?.id]);

  const filteredUsers = useMemo(() => {
    const query = inviteSearch.trim().toLowerCase();
    if (!query) return users.filter((user) => !invites.some((item) => item.id === user.id)).slice(0, 8);
    return users.filter((user) => !invites.some((item) => item.id === user.id) && `${user.display_name} ${user.email}`.toLowerCase().includes(query)).slice(0, 8);
  }, [users, invites, inviteSearch]);

  const addInvite = (user: UserRow) => {
    setInvites((current) => [...current, user]);
    setInviteSearch('');
  };

  const addAttachment = (item: StudyKitRow | FileRow) => {
    const type = attachmentType;
    const exists = attachments.some((attachment) => type === 'study_kit' ? attachment.study_kit_id === item.id : attachment.file_id === item.id);
    if (exists) return;
    setAttachments((current) => [
      ...current,
      {
        id: `new-${item.id}-${Date.now()}`,
        event_id: initialEvent?.id || '',
        attachment_type: type,
        study_kit_id: type === 'study_kit' ? item.id : null,
        file_id: type === 'file' ? item.id : null,
        name: item.title ?? item.name,
      },
    ]);
  };

  const save = async () => {
    if (!me?.id) {
      setError('You are not signed in. Please sign in again before creating a calendar event.');
      return;
    }
    if (!title.trim()) { setError('Add an event title.'); return; }
    if (!start || !end || new Date(end) <= new Date(start)) { setError('End time must be after the start time.'); return; }

    setSaving(true);
    setError('');
    try {
      let event = initialEvent;
      const baseRule = event?.recurrence_rule || null;
      let recurrenceRule: RecurrenceRule | null = null;
      if (editScope === 'occurrence' && baseRule) {
        recurrenceRule = {
          ...baseRule,
          exceptions: [...(baseRule.exceptions || [])],
          overrides: { ...(baseRule.overrides || {}) },
        };
        recurrenceRule.overrides![initialEvent!.occurrence_key!] = {
          title: title.trim(),
          start_at: toIso(start),
          end_at: toIso(end),
          color,
          location: location.trim() || null,
          description: description.trim() || null,
          all_day: allDay,
        };
      } else if (repeatPreset !== 'none') {
        recurrenceRule = {
          frequency: repeatPreset === 'weekdays' ? 'weekly' : repeatPreset === 'weekly' ? 'weekly' : repeatPreset,
          interval: repeatPreset === 'weekdays' ? 1 : repeatPreset === 'custom' ? customInterval : 1,
          byWeekday: repeatPreset === 'weekdays' ? [1,2,3,4,5] : repeatPreset === 'weekly' ? [new Date(start).getDay()] : repeatPreset === 'custom' && customFrequency === 'weekly' ? [...selectedWeekdays].sort() : undefined,
          dayOfMonth: repeatPreset === 'monthly' || (repeatPreset === 'custom' && customFrequency === 'monthly') ? new Date(start).getDate() : undefined,
          month: repeatPreset === 'yearly' || (repeatPreset === 'custom' && customFrequency === 'yearly') ? new Date(start).getMonth() + 1 : undefined,
          end: repeatPreset === 'custom'
            ? { type: customEndType, ...(customEndType === 'date' ? { date: customEndDate } : {}), ...(customEndType === 'count' ? { count: Math.max(1, customOccurrences) } : {}) }
            : { type: 'never' },
        };
        if (repeatPreset === 'daily') recurrenceRule.byWeekday = undefined;
        if (repeatPreset === 'custom') recurrenceRule.frequency = customFrequency;
      }

      const payload = {
        owner_id: me.id,
        title: title.trim(),
        start_at: toIso(start),
        end_at: toIso(end),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
        color,
        location: location.trim() || null,
        description: description.trim() || null,
        all_day: allDay,
        recurrence_rule: recurrenceRule,
        reminders: reminders.map((reminder) => ({
          id: reminder.id,
          minutes_before: Math.max(0, Number(reminder.minutes_before) || 0),
        })),
        notify_invites: notifyInvites && invites.length > 0,
      };

      const targetId = editScope === 'occurrence' ? initialEvent!.series_id! : event?.id;
      if (targetId) {
        event = await api<CalendarEvent[]>(`/rest/v1/calendar_events?id=eq.${targetId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        }).then((rows) => rows[0]);
      } else {
        event = await api<CalendarEvent[]>('/rest/v1/calendar_events', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        }).then((rows) => rows[0]);
      }

      await api(`/rest/v1/calendar_event_invites?event_id=eq.${event.id}`, { method: 'DELETE' }).catch(() => undefined);
      if (invites.length) {
        await api('/rest/v1/calendar_event_invites', {
          method: 'POST',
          body: JSON.stringify(invites.map((user) => ({ event_id: event!.id, user_id: user.id }))),
        });
      }

      await api(`/rest/v1/calendar_event_attachments?event_id=eq.${event.id}`, { method: 'DELETE' }).catch(() => undefined);
      if (attachments.length) {
        await api('/rest/v1/calendar_event_attachments', {
          method: 'POST',
          body: JSON.stringify(attachments.map((attachment) => ({
            event_id: event!.id,
            attachment_type: attachment.attachment_type,
            study_kit_id: attachment.study_kit_id,
            file_id: attachment.file_id,
            name: attachment.name,
          }))),
        });
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save event.');
    } finally {
      setSaving(false);
    }
  };

  const attachmentItems = attachmentType === 'study_kit' ? kits : files;
  const generateAIEvents = async () => {
    console.log('Generate events clicked');
    try {
      const prompt = aiDescription.trim();
      if (!prompt) { setError('Describe the events you want to create.'); return; }
      const weeks = Number(aiWeeks.trim());
      if (!Number.isSafeInteger(weeks) || weeks <= 0) { setError('Enter a positive whole number of weeks.'); return; }
      const selectedColor = COLORS.find((color) => color.id === aiColor) || COLORS[0];
      setAiGenerating(true);
      setError('');
      setAiSuccess('');
      console.log('[Calendar AI UI] Starting event generation', { prompt, weeks, color: selectedColor.id });
      console.log('About to call API');
      const response = await fetch('/api/generate-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, weeks, color: selectedColor.id }),
      });
      console.log('API response:', response.status);
      console.log('[Calendar AI UI] Generate-events response status', { status: response.status, ok: response.ok });
      const body = await response.json().catch((parseError) => {
        console.error('[Calendar AI UI] API response JSON parse error:', parseError);
        throw parseError;
      });
      console.log('[Calendar AI UI] Generate-events response body', body);
      if (!response.ok) {
        console.error('[Calendar AI UI] Generate-events endpoint failed', { status: response.status, error: body?.error });
        throw new Error(body?.error || `Request failed with status ${response.status}`);
      }
      if (!Array.isArray(body?.events)) {
        console.error('[Calendar AI UI] Response did not contain an events array', body);
        throw new Error(body?.error || 'The API response did not contain an events array.');
      }
      const normalized = normalizeAIEvents(body.events).map((event) => ({ ...event, color: selectedColor.id }));
      console.log('[Calendar AI UI] Final normalized events array', normalized);
      if (!normalized.length) throw new Error('No events were found. Try describing days and times more specifically.');
      setAiEvents(normalized);
    } catch (err) {
      console.error('Generate events frontend error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAiGenerating(false);
    }
  };
  const saveAIEvents = async () => {
    if(!me?.id){setError('You are not signed in. Please sign in again before creating calendar events.');return;} if(!aiEvents.length)return;
    setAiSaving(true);setError('');
    try { const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Los_Angeles'; const payload=aiEvents.map(item=>{const day=nextAIEventDate(item.startDate,item.recurrence,item.daysOfWeek);const parts=item.startTime.split(':').map(Number),ends=item.endTime.split(':').map(Number);const st=new Date(day);st.setHours(parts[0],parts[1],0,0);const en=new Date(day);en.setHours(ends[0],ends[1],0,0);if(en<=st)en.setDate(en.getDate()+1);let rule:RecurrenceRule|null=null;if(item.recurrence!=='none'){const byWeekday=item.recurrence==='weekly'&&item.daysOfWeek.length?item.daysOfWeek.map(d=>WEEKDAY_INDEX[d]).sort((a,b)=>a-b):undefined;let end:RecurrenceEnd={type:'never'};if(item.endDate)end={type:'date',date:item.endDate};const weeks=aiDescription.match(/for the next\s+(\d+)\s+weeks?/i);if(!item.endDate&&weeks&&item.recurrence==='weekly')end={type:'date',date:formatInputDate(addDays(day,Number(weeks[1])*7))};rule={frequency:item.recurrence,interval:1,byWeekday,dayOfMonth:item.recurrence==='monthly'?day.getDate():undefined,month:item.recurrence==='yearly'?day.getMonth()+1:undefined,end};}return {owner_id:me.id,title:item.title.trim(),start_at:st.toISOString(),end_at:en.toISOString(),timezone,color:item.color,location:null,description:null,all_day:false,recurrence_rule:rule,reminders:[],notify_invites:false};}); await api('/rest/v1/calendar_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(payload)});setAiSuccess(payload.length+' events created successfully!');toast({title:payload.length+' events created successfully!'});setAiEvents([]);setAiDescription('');onSaved(); }
    catch(e){setError(e instanceof Error?e.message:'Could not save events. Please try again.');}finally{setAiSaving(false);}
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-secondary" aria-label="Close event editor"><X size={20} /></button>
          <span className="text-xs font-medium text-muted-foreground">{initialEvent ? 'Edit event' : 'Create event'}</span>
        </div>
        <div className="flex items-center gap-2">
          {initialEvent && <button onClick={() => onRequestDelete(initialEvent)} disabled={saving} className="rounded-lg px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-400/10 disabled:opacity-50">Delete</button>}
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-secondary">Cancel</button>
          {(editorTab === 'manual' || initialEvent) && (
            <button onClick={save} disabled={saving} className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-10 sm:py-12">
          {!initialEvent && <div className="mb-8 flex gap-2 rounded-xl border border-border bg-card p-1.5"><button type="button" onClick={()=>setEditorTab('manual')} className={editorTab==='manual'?'flex-1 rounded-lg bg-secondary px-4 py-3 text-sm font-semibold':'flex-1 rounded-lg px-4 py-3 text-sm text-muted-foreground'}>Manual form</button><button type="button" onClick={()=>setEditorTab('ai')} className={editorTab==='ai'?'flex-1 rounded-lg bg-secondary px-4 py-3 text-sm font-semibold':'flex-1 rounded-lg px-4 py-3 text-sm text-muted-foreground'}><Sparkles size={15} className="mr-2 inline"/> Ask AI</button></div>}
          {aiSuccess&&<div className="mb-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{aiSuccess}</div>}
          {error && <div className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-300">{error}</div>}
          {editorTab==='ai'&&!initialEvent ? <section className="space-y-5"><h2 className="font-serif text-3xl">Describe your events</h2><textarea value={aiDescription} onChange={e=>setAiDescription(e.target.value)} placeholder="Describe your events in plain English... e.g. I have math class every Monday and Wednesday from 3-4pm, Science Olympiad practice every Saturday at 10am for 2 hours" rows={7} className="min-h-48 w-full resize-y rounded-xl border border-input bg-card p-4 text-sm leading-6"/><label className="block max-w-xs text-xs font-medium">How many weeks?<input type="text" inputMode="numeric" value={aiWeeks} onChange={e=>setAiWeeks(e.target.value)} placeholder="Number of weeks (e.g. 12)" className="mt-2 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" /></label><div className="flex flex-wrap gap-2">{['Class every Monday 5-6pm','Team meeting every Friday at 2pm for 1 hour','Study session daily at 8pm for 30 minutes'].map(v=><button key={v} type="button" onClick={()=>setAiDescription(v)} className="rounded-full border border-border bg-card px-3 py-2 text-xs hover:bg-secondary">{v}</button>)}</div><div className="space-y-2"><p className="text-xs font-medium">Event color</p><div className="flex flex-wrap items-center gap-3">{COLORS.map((color) => <button key={color.id} type="button" onClick={() => setAiColor(color.id)} aria-label={color.label} aria-pressed={aiColor === color.id} className={`h-7 w-7 rounded-full border-2 transition ${aiColor === color.id ? 'border-white ring-2 ring-white/40' : 'border-transparent hover:border-white/50'}`} style={{ backgroundColor: color.value }} />)}</div></div><button type="button" onClick={()=>void generateAIEvents()} disabled={aiGenerating||aiSaving||!aiDescription.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{aiGenerating?<Loader2 size={16} className="animate-spin"/>:<Sparkles size={16}/>} {aiGenerating?'Generating events…':'Generate Events'}</button>{aiEvents.length>0&&<div className="space-y-4 border-t border-border pt-6"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Preview events</h3><button type="button" onClick={()=>void saveAIEvents()} disabled={aiSaving} className="rounded-lg bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground">{aiSaving?'Saving…':'Save all events'}</button></div>{aiEvents.map(item=><article key={item.id} className="rounded-xl border border-border bg-card p-4"><div className="flex items-start gap-3"><span className="mt-3 h-3 w-3 rounded-full" style={{backgroundColor:EVENT_COLOR[item.color]||EVENT_COLOR.blueberry}}/><div className="min-w-0 flex-1 space-y-3"><p className="text-xs text-muted-foreground">{fullDateLabel(new Date((item.startDate.toLowerCase()==="today"?formatInputDate(new Date()):item.startDate)+"T00:00:00"))}</p><input value={item.title} aria-label="Event title" onChange={e=>setAiEvents(cur=>cur.map(v=>v.id===item.id?{...v,title:e.target.value}:v))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold"/><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Start time<input type="time" value={item.startTime} onChange={e=>setAiEvents(cur=>cur.map(v=>v.id===item.id?{...v,startTime:e.target.value}:v))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"/></label><label className="text-xs">End time<input type="time" value={item.endTime} onChange={e=>setAiEvents(cur=>cur.map(v=>v.id===item.id?{...v,endTime:e.target.value}:v))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"/></label><label className="text-xs">Recurrence<select value={item.recurrence} onChange={e=>setAiEvents(cur=>cur.map(v=>v.id===item.id?{...v,recurrence:e.target.value as AIEventDraft['recurrence']}:v))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"><option value="none">One time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><label className="text-xs">Color<select value={item.color} onChange={e=>setAiEvents(cur=>cur.map(v=>v.id===item.id?{...v,color:e.target.value}:v))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3">{COLORS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label className="text-xs sm:col-span-2">Start date<input type="date" value={item.startDate.toLowerCase()==='today'?formatInputDate(new Date()):item.startDate} onChange={e=>setAiEvents(cur=>cur.map(v=>v.id===item.id?{...v,startDate:e.target.value}:v))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"/></label></div><div className="text-xs text-muted-foreground">{item.recurrence==='weekly'&&item.daysOfWeek.length?'Weekly: '+item.daysOfWeek.join(', '):item.recurrence==='none'?'One time':item.recurrence} · {COLORS.find(c=>c.id===item.color)?.label}</div></div><button type="button" aria-label="Remove event" onClick={()=>setAiEvents(cur=>cur.filter(v=>v.id!==item.id))} className="rounded-md p-2 hover:bg-secondary"><X size={16}/></button></div></article>)}</div>}</section> : <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Event title" className="w-full border-0 bg-transparent font-serif text-4xl tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-5xl" />

          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_300px]">
            <div className="space-y-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="mb-2 block font-semibold">Starts</span>
                  <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm" />
                </label>
                <label className="text-xs">
                  <span className="mb-2 block font-semibold">Ends</span>
                  <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm" />
                </label>
              </div>

              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4" />
                All day
              </label>

              <section className="space-y-3">
                <label className="block text-xs">
                  <span className="mb-2 block font-semibold">Repeat</span>
                  <select value={repeatPreset} onChange={(e) => setRepeatPreset(e.target.value as typeof repeatPreset)} disabled={editScope === 'occurrence'} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm disabled:opacity-60">
                    <option value="none">Does not repeat</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week on {new Date(start).toLocaleDateString(undefined, { weekday: 'long' })}</option>
                    <option value="monthly">Every month on the {new Date(start).getDate()}</option>
                    <option value="yearly">Every year on {new Date(start).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</option>
                    <option value="weekdays">Every weekday (Monday to Friday)</option>
                    <option value="custom">Custom...</option>
                  </select>
                  {editScope === 'occurrence' && <p className="mt-1 text-[10px] text-muted-foreground">Edit all events in the series to change the repeat rule.</p>}
                </label>
                {repeatPreset === 'custom' && editScope !== 'occurrence' && (
                  <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span>Repeat every</span>
                      <input type="number" min={1} value={customInterval} onChange={(e) => setCustomInterval(Math.max(1, Number(e.target.value) || 1))} className="h-9 w-20 rounded-md border border-input bg-background px-2" />
                      <select value={customFrequency} onChange={(e) => setCustomFrequency(e.target.value as typeof customFrequency)} className="h-9 rounded-md border border-input bg-background px-2">
                        <option value="daily">day(s)</option>
                        <option value="weekly">week(s)</option>
                        <option value="monthly">month(s)</option>
                        <option value="yearly">year(s)</option>
                      </select>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold">Repeat on</p>
                      <div className="grid grid-cols-7 gap-1">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                          <label key={day} className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-border px-1 py-2 text-[10px]">
                            <input type="checkbox" checked={selectedWeekdays.includes(index)} onChange={(e) => setSelectedWeekdays((current) => e.target.checked ? [...new Set([...current, index])] : current.filter((item) => item !== index))} />
                            {day}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold">Ends</p>
                      <div className="space-y-2 text-xs">
                        <label className="flex items-center gap-2"><input type="radio" checked={customEndType === 'never'} onChange={() => setCustomEndType('never')} /> Never</label>
                        <label className="flex items-center gap-2"><input type="radio" checked={customEndType === 'date'} onChange={() => setCustomEndType('date')} /> On <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2" /></label>
                        <label className="flex items-center gap-2"><input type="radio" checked={customEndType === 'count'} onChange={() => setCustomEndType('count')} /> After <input type="number" min={1} value={customOccurrences} onChange={(e) => setCustomOccurrences(Math.max(1, Number(e.target.value) || 1))} className="h-9 w-20 rounded-md border border-input bg-background px-2" /> occurrences</label>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <div>
                <p className="mb-2 text-xs font-semibold">Color</p>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((item) => (
                    <button key={item.id} onClick={() => setColor(item.id)} title={item.label} aria-label={item.label} className={`h-8 w-8 rounded-full border-2 ${color === item.id ? 'border-foreground' : 'border-transparent'}`} style={{ backgroundColor: item.value }} />
                  ))}
                </div>
              </div>

              <label className="block text-xs">
                <span className="mb-2 flex items-center gap-2 font-semibold"><MapPin size={15} /> Location</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add a location" className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm" />
              </label>

              <label className="block text-xs">
                <span className="mb-2 block font-semibold">Description / notes</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add notes" rows={6} className="w-full resize-y rounded-lg border border-input bg-card p-3 text-sm outline-none focus:border-primary" />
              </label>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold">Email reminder</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">Send one or more reminder emails before this event.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReminders((current) => [...current, { id: `reminder-${Date.now()}-${Math.random()}`, minutes_before: 10 }])}
                    className="rounded-lg border border-border px-3 py-2 text-[10px] font-semibold hover:bg-secondary"
                  >
                    + Add reminder
                  </button>
                </div>

                {reminders.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-[10px] text-muted-foreground">
                    No email reminders set.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reminders.map((reminder) => {
                      const preset = [0, 10, 30, 60, 1440, 10080].includes(reminder.minutes_before)
                        ? String(reminder.minutes_before)
                        : 'custom';
                      return (
                        <div key={reminder.id} className="rounded-lg border border-border bg-card p-3">
                          <div className="flex items-center gap-2">
                            <select
                              value={preset}
                              onChange={(e) => {
                                const value = e.target.value;
                                setReminders((current) => current.map((item) => item.id === reminder.id
                                  ? { ...item, minutes_before: value === 'custom' ? Math.max(1, item.minutes_before || 15) : Number(value) }
                                  : item
                                ));
                              }}
                              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                            >
                              <option value="0">At time of event</option>
                              <option value="10">10 minutes before</option>
                              <option value="30">30 minutes before</option>
                              <option value="60">1 hour before</option>
                              <option value="1440">1 day before</option>
                              <option value="10080">1 week before</option>
                              <option value="custom">Custom time</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => setReminders((current) => current.filter((item) => item.id !== reminder.id))}
                              className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              aria-label="Remove reminder"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          {preset === 'custom' && (
                            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>Send</span>
                              <input
                                type="number"
                                min={1}
                                value={Math.max(1, Math.round(reminder.minutes_before))}
                                onChange={(e) => setReminders((current) => current.map((item) => item.id === reminder.id
                                  ? { ...item, minutes_before: Math.max(1, Number(e.target.value) || 1) }
                                  : item
                                ))}
                                className="h-9 w-24 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                              />
                              <span>minutes before the event.</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-3 text-xs">
                  <span>
                    <span className="block font-semibold">Email invited users</span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">Also send these reminders to everyone invited to this event.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={notifyInvites}
                    onChange={(e) => setNotifyInvites(e.target.checked)}
                    disabled={invites.length === 0}
                    className="h-4 w-4 shrink-0"
                  />
                </label>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><Users size={15} /> Invite Flexus users</div>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
                  <input value={inviteSearch} onChange={(e) => setInviteSearch(e.target.value)} placeholder="Search by name or email" className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-xs" />
                </div>
                {filteredUsers.length > 0 && (
                  <div className="mt-2 rounded-lg border border-border bg-card p-1">
                    {filteredUsers.map((user) => (
                      <button key={user.id} onClick={() => addInvite(user)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-secondary">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{(user.display_name || user.email).slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{user.display_name}</span><span className="block truncate text-[10px] text-muted-foreground">{user.email}</span></span>
                      </button>
                    ))}
                  </div>
                )}
                {invites.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {invites.map((user) => (
                      <span key={user.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-[10px]">
                        {user.display_name || user.email}
                        <button onClick={() => setInvites((current) => current.filter((item) => item.id !== user.id))} aria-label={`Remove ${user.display_name}`}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><FileText size={15} /> Attach from your library</div>
                <div className="mb-3 flex rounded-lg border border-border bg-card p-1">
                  <button onClick={() => setAttachmentType('study_kit')} className={`flex-1 rounded-md px-3 py-2 text-[10px] font-semibold ${attachmentType === 'study_kit' ? 'bg-secondary' : 'text-muted-foreground'}`}>Study kits</button>
                  <button onClick={() => setAttachmentType('file')} className={`flex-1 rounded-md px-3 py-2 text-[10px] font-semibold ${attachmentType === 'file' ? 'bg-secondary' : 'text-muted-foreground'}`}>Files</button>
                </div>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-card">
                  {attachmentItems.length === 0 ? (
                    <p className="p-4 text-xs text-muted-foreground">{attachmentType === 'study_kit' ? 'No study kits found.' : 'No files found.'}</p>
                  ) : attachmentItems.map((item) => {
                    const itemId = item.id;
                    const selected = attachments.some((attachment) => attachment.attachment_type === attachmentType && (attachmentType === 'study_kit' ? attachment.study_kit_id === itemId : attachment.file_id === itemId));
                    return (
                      <button key={itemId} onClick={() => selected ? setAttachments((current) => current.filter((attachment) => !(attachment.attachment_type === attachmentType && (attachmentType === 'study_kit' ? attachment.study_kit_id === itemId : attachment.file_id === itemId)))) : addAttachment(item)} className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-secondary">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${selected ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}><FileText size={14} /></span>
                        <span className="min-w-0 flex-1 truncate text-xs">{attachmentType === 'study_kit' ? (item as StudyKitRow).title : (item as FileRow).name}</span>
                        {selected && <span className="text-[10px] font-semibold text-primary">Attached</span>}
                      </button>
                    );
                  })}
                </div>
                {attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                      <span key={attachment.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-[10px]">
                        {attachment.name}
                        <button onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} aria-label={`Remove ${attachment.name}`}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside className="hidden lg:block">
              <div className="sticky top-6 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 text-xs font-semibold"><CalendarDays size={15} /> Event preview</div>
                <div className="mt-5 border-l-4 pl-4" style={{ borderColor: EVENT_COLOR[color] || EVENT_COLOR.blueberry }}>
                  <p className="font-serif text-xl">{title || 'Untitled event'}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{new Date(start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                  {!allDay && <p className="mt-1 text-xs text-muted-foreground">{new Date(start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – {new Date(end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</p>}
                  {location && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><MapPin size={13} /> {location}</p>}
                </div>
              </div>
            </aside>
          </div>
          </>}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const me = getStoredUser();
  const [view, setView] = useState<'month' | 'week' | 'day'>('day');
  const [miniCalendarOpen, setMiniCalendarOpen] = useState(false);
  const [date, setDate] = useState(new Date());
  const [baseEvents, setBaseEvents] = useState<CalendarEvent[]>([]);
  const [editor, setEditor] = useState<{ event: CalendarEvent | null; date: Date; editScope: 'series' | 'occurrence' } | null>(null);
  const [seriesDialog, setSeriesDialog] = useState<{ event: CalendarEvent; action: 'edit' | 'delete' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadEvents = async () => {
    if (!me?.id) return;
    setLoading(true);
    setError('');
    try {
      const [owned, inviteRows] = await Promise.all([
        api<CalendarEvent[]>(
          `/rest/v1/calendar_events?select=id,owner_id,title,start_at,end_at,timezone,color,location,description,all_day,recurrence_rule,reminders,notify_invites,created_at,updated_at&owner_id=eq.${me.id}&order=start_at.asc&limit=500`,
        ),
        api<InviteRow[]>(
          `/rest/v1/calendar_event_invites?select=id,event_id,user_id&user_id=eq.${me.id}&limit=500`,
        ),
      ]);

      const invitedIds = [...new Set(inviteRows.map((row) => row.event_id))];
      const invited = invitedIds.length
        ? await api<CalendarEvent[]>(
            `/rest/v1/calendar_events?select=id,owner_id,title,start_at,end_at,timezone,color,location,description,all_day,recurrence_rule,reminders,notify_invites,created_at,updated_at&id=in.(${invitedIds.join(',')})&order=start_at.asc&limit=500`,
          )
        : [];

      const byId = new Map<string, CalendarEvent>();
      [...owned, ...invited].forEach((event) => byId.set(event.id, event));
      setBaseEvents([...byId.values()].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load calendar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadEvents(); }, [me?.id]);

  const range = calendarRange(date, view);
  const events = useMemo(() => generateEventOccurrences(baseEvents, range.start, range.end), [baseEvents, range.start.getTime(), range.end.getTime()]);
  const visibleTitle = view === 'month' ? monthLabel(date) : view === 'week' ? `Week of ${shortDate(startOfWeek(date))}` : fullDateLabel(date);

  const navigate = (direction: number) => {
    if (view === 'month') setDate(new Date(date.getFullYear(), date.getMonth() + direction, 1));
    else if (view === 'week') setDate(addDays(date, direction * 7));
    else setDate(addDays(date, direction));
  };

  const openNew = () => setEditor({ event: null, date, editScope: 'series' });
  const openEvent = (event: CalendarEvent) => {
    if (event.recurrence_rule && event.series_id && event.occurrence_key) setSeriesDialog({ event, action: 'edit' });
    else setEditor({ event, date: new Date(event.start_at), editScope: 'series' });
  };

  const deleteEvent = async (event: CalendarEvent, scope: 'series' | 'occurrence') => {
    try {
      if (scope === 'series') {
        await api(`/rest/v1/calendar_events?id=eq.${event.series_id || event.id}`, { method: 'DELETE' });
      } else {
        const seriesId = event.series_id || event.id;
        const rows = await api<CalendarEvent[]>(`/rest/v1/calendar_events?id=eq.${seriesId}`);
        const series = rows[0];
        if (!series?.recurrence_rule || !event.occurrence_key) return;
        const rule = { ...series.recurrence_rule, exceptions: [...(series.recurrence_rule.exceptions || []), event.occurrence_key] };
        await api(`/rest/v1/calendar_events?id=eq.${seriesId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ recurrence_rule: rule }) });
      }
      setSeriesDialog(null);
      setEditor(null);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete event.');
    }
  };

  const requestDelete = (event: CalendarEvent) => {
    if (event.recurrence_rule && event.series_id && event.occurrence_key) setSeriesDialog({ event, action: 'delete' });
    else void deleteEvent(event, 'series');
  };

  const chooseEditScope = (scope: 'series' | 'occurrence') => {
    if (!seriesDialog) return;
    const event = seriesDialog.event;
    setEditor({ event, date: new Date(event.start_at), editScope: scope });
    setSeriesDialog(null);
  };

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-background">
      <div className="flex min-h-[calc(100dvh-64px)]">
        <aside className={miniCalendarOpen ? "w-64 shrink-0 border-r border-border p-4 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-[100] max-lg:bg-background max-lg:shadow-2xl max-lg:overflow-y-auto lg:block" : "hidden w-64 shrink-0 border-r border-border p-4 lg:block"}>
          <div className="mb-3 flex items-center justify-between lg:hidden"><span className="text-sm font-semibold">Calendar</span><button type="button" onClick={() => setMiniCalendarOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Close mini calendar"><X size={18}/></button></div><button onClick={() => { openNew(); setMiniCalendarOpen(false); }} className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground shadow-sm"><Plus size={15} /> Create</button>
          <MiniCalendar value={date} onChange={(next) => { setDate(next); setView('day'); }} events={events} />
          <div className="mt-5 rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Calendar</p>
            <div className="mt-3 flex items-center gap-2 text-xs"><span className="h-3 w-3 rounded-full bg-primary" /> Flexus Calendar</div>
          </div>
        </aside>
        {miniCalendarOpen && <button type="button" onClick={() => setMiniCalendarOpen(false)} className="fixed inset-0 z-[90] bg-black/50 lg:hidden" aria-label="Close mini calendar" />}

        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
            <div className="flex items-center gap-2 min-w-0"><button type="button" onClick={() => setMiniCalendarOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border lg:hidden" aria-label="Open mini calendar"><CalendarDays size={17}/></button>
              <button onClick={() => setDate(new Date())} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary">Today</button>
              <button onClick={() => navigate(-1)} className="rounded-lg p-2 hover:bg-secondary" aria-label="Previous"><ChevronLeft size={18} /></button>
              <button onClick={() => navigate(1)} className="rounded-lg p-2 hover:bg-secondary" aria-label="Next"><ChevronRight size={18} /></button>
              <h1 className="ml-1 font-serif text-xl tracking-tight sm:text-2xl">{visibleTitle}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openNew} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground lg:hidden"><Plus size={14} /> Create</button>
              <div className="flex rounded-lg border border-border bg-card p-1">
                {(['month', 'week', 'day'] as const).map((item) => (
                  <button key={item} onClick={() => setView(item)} className={`rounded-md px-3 py-1.5 text-[10px] font-semibold capitalize ${view === item ? 'bg-secondary' : 'text-muted-foreground hover:text-foreground'}`}>{item}</button>
                ))}
              </div>
            </div>
          </header>

          {error && <div className="mx-4 mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-300 sm:mx-6">{error}</div>}
          {loading ? (
            <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading calendar…</div>
          ) : (
            <div className="overflow-auto p-4 sm:p-6">
              {view === 'month' && <MonthView date={date} events={events} onSelectDay={(next) => { setDate(next); setView('day'); }} onEvent={openEvent} />}
              {view === 'week' && <TimeGrid date={date} events={events} days={Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date), index))} onEvent={openEvent} />}
              {view === 'day' && <TimeGrid date={date} events={events} days={[date]} onEvent={openEvent} />}
            </div>
          )}
        </div>
      </div>

      {seriesDialog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
            <p className="font-serif text-xl">{seriesDialog.action === 'edit' ? 'Edit recurring event' : 'Delete recurring event'}</p>
            <p className="mt-2 text-xs text-muted-foreground">{seriesDialog.action === 'edit' ? 'Would you like to edit this event or edit all events in the series?' : 'Would you like to delete this event or delete all events in the series?'}</p>
            <div className="mt-5 grid gap-2">
              {seriesDialog.action === 'edit' ? (
                <>
                  <button onClick={() => chooseEditScope('occurrence')} className="rounded-lg bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground">Edit this event</button>
                  <button onClick={() => chooseEditScope('series')} className="rounded-lg border border-border px-4 py-3 text-xs font-semibold hover:bg-secondary">Edit all events in series</button>
                </>
              ) : (
                <>
                  <button onClick={() => void deleteEvent(seriesDialog.event, 'occurrence')} className="rounded-lg bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground">Delete this event</button>
                  <button onClick={() => void deleteEvent(seriesDialog.event, 'series')} className="rounded-lg border border-border px-4 py-3 text-xs font-semibold hover:bg-secondary">Delete all events in series</button>
                </>
              )}
              <button onClick={() => setSeriesDialog(null)} className="rounded-lg px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editor && (
        <CalendarErrorBoundary
          key={editor.event?.id || editor.date.getTime()}
          onError={(error) => setError(`Calendar editor error: ${error.message}`)}
        >
          <EventEditor
            initialEvent={editor.event}
            selectedDate={editor.date}
            editScope={editor.editScope}
            onClose={() => setEditor(null)}
            onSaved={() => { setEditor(null); void loadEvents(); }}
            onRequestDelete={requestDelete}
          />
        </CalendarErrorBoundary>
      )}
    </main>
  );
}
