import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  MapPin,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';

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
  { id: 'tomato', label: 'Tomato', value: '#ea4335' },
  { id: 'flamingo', label: 'Flamingo', value: '#e91e63' },
  { id: 'tangerine', label: 'Tangerine', value: '#f4511e' },
  { id: 'banana', label: 'Banana', value: '#fbbc04' },
  { id: 'sage', label: 'Sage', value: '#33b679' },
  { id: 'basil', label: 'Basil', value: '#0b8043' },
  { id: 'peacock', label: 'Peacock', value: '#039be5' },
  { id: 'blueberry', label: 'Blueberry', value: '#4285f4' },
  { id: 'lavender', label: 'Lavender', value: '#7986cb' },
  { id: 'grape', label: 'Grape', value: '#8e24aa' },
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
              {events.filter((event) => eventOverlapsDay(event, day)).map((event) => {
                const start = new Date(event.start_at);
                const end = new Date(event.end_at);
                const top = Math.max(0, ((start.getHours() + start.getMinutes() / 60) - 7) * rowHeight);
                const duration = Math.max(0.5, (end.getTime() - start.getTime()) / 3600000);
                return (
                  <button
                    key={event.id}
                    onClick={() => onEvent(event)}
                    className="absolute left-1 right-1 overflow-hidden rounded-md px-2 py-1 text-left text-[10px] font-medium text-white shadow-sm hover:brightness-110"
                    style={{ ...eventStyle(event), top, height: Math.max(30, duration * rowHeight - 2) }}
                  >
                    <div className="truncate">{event.title}</div>
                    <div className="mt-0.5 opacity-80">{timeLabel(event.start_at)}</div>
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

function EventEditor({
  initialEvent,
  selectedDate,
  onClose,
  onSaved,
  onDeleted,
}: {
  initialEvent: CalendarEvent | null;
  selectedDate: Date;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
  onDeleted: (id: string) => void;
}) {
  const me = getStoredUser();
  const [title, setTitle] = useState(initialEvent?.title || '');
  const [start, setStart] = useState(initialEvent ? localDateTimeInput(initialEvent.start_at) : `${formatInputDate(selectedDate)}T09:00`);
  const [end, setEnd] = useState(initialEvent ? localDateTimeInput(initialEvent.end_at) : `${formatInputDate(selectedDate)}T10:00`);
  const [color, setColor] = useState(initialEvent?.color || 'blueberry');
  const [location, setLocation] = useState(initialEvent?.location || '');
  const [description, setDescription] = useState(initialEvent?.description || '');
  const [allDay, setAllDay] = useState(initialEvent?.all_day || false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<UserRow[]>([]);
  const [inviteSearch, setInviteSearch] = useState('');
  const [kits, setKits] = useState<StudyKitRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentType, setAttachmentType] = useState<'study_kit' | 'file'>('study_kit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    if (!me?.id) return;
    if (!title.trim()) { setError('Add an event title.'); return; }
    if (!start || !end || new Date(end) <= new Date(start)) { setError('End time must be after the start time.'); return; }

    setSaving(true);
    setError('');
    try {
      let event = initialEvent;
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
      };

      if (event) {
        event = await api<CalendarEvent[]>(`/rest/v1/calendar_events?id=eq.${event.id}`, {
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

      onSaved(event);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save event.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!initialEvent) return;
    setSaving(true);
    try {
      await api(`/rest/v1/calendar_events?id=eq.${initialEvent.id}`, { method: 'DELETE' });
      onDeleted(initialEvent.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete event.');
    } finally {
      setSaving(false);
    }
  };

  const attachmentItems = attachmentType === 'study_kit' ? kits : files;

  return (
    <div className="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-secondary" aria-label="Close event editor"><X size={20} /></button>
          <span className="text-xs font-medium text-muted-foreground">{initialEvent ? 'Edit event' : 'Create event'}</span>
        </div>
        <div className="flex items-center gap-2">
          {initialEvent && <button onClick={remove} disabled={saving} className="rounded-lg px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-400/10 disabled:opacity-50">Delete</button>}
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-10 sm:py-12">
          {error && <div className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-300">{error}</div>}
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
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const me = getStoredUser();
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [date, setDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [editor, setEditor] = useState<{ event: CalendarEvent | null; date: Date } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadEvents = async () => {
    if (!me?.id) return;
    setLoading(true);
    setError('');
    try {
      const [owned, inviteRows] = await Promise.all([
        api<CalendarEvent[]>(
          `/rest/v1/calendar_events?select=id,owner_id,title,start_at,end_at,timezone,color,location,description,all_day,created_at,updated_at&owner_id=eq.${me.id}&order=start_at.asc&limit=500`,
        ),
        api<InviteRow[]>(
          `/rest/v1/calendar_event_invites?select=id,event_id,user_id&user_id=eq.${me.id}&limit=500`,
        ),
      ]);

      const invitedIds = [...new Set(inviteRows.map((row) => row.event_id))];
      const invited = invitedIds.length
        ? await api<CalendarEvent[]>(
            `/rest/v1/calendar_events?select=id,owner_id,title,start_at,end_at,timezone,color,location,description,all_day,created_at,updated_at&id=in.(${invitedIds.join(',')})&order=start_at.asc&limit=500`,
          )
        : [];

      const byId = new Map<string, CalendarEvent>();
      [...owned, ...invited].forEach((event) => byId.set(event.id, event));
      setEvents([...byId.values()].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load calendar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadEvents(); }, [me?.id]);

  const visibleTitle = view === 'month' ? monthLabel(date) : view === 'week' ? `Week of ${shortDate(startOfWeek(date))}` : fullDateLabel(date);

  const navigate = (direction: number) => {
    if (view === 'month') setDate(new Date(date.getFullYear(), date.getMonth() + direction, 1));
    else if (view === 'week') setDate(addDays(date, direction * 7));
    else setDate(addDays(date, direction));
  };

  const openNew = () => setEditor({ event: null, date });
  const openEvent = (event: CalendarEvent) => setEditor({ event, date: new Date(event.start_at) });

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-background">
      <div className="flex min-h-[calc(100dvh-64px)]">
        <aside className="hidden w-64 shrink-0 border-r border-border p-4 lg:block">
          <button onClick={openNew} className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground shadow-sm"><Plus size={15} /> Create</button>
          <MiniCalendar value={date} onChange={(next) => { setDate(next); setView('day'); }} events={events} />
          <div className="mt-5 rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Calendar</p>
            <div className="mt-3 flex items-center gap-2 text-xs"><span className="h-3 w-3 rounded-full bg-primary" /> Flexus Calendar</div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
            <div className="flex items-center gap-2">
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

      {editor && (
        <EventEditor
          initialEvent={editor.event}
          selectedDate={editor.date}
          onClose={() => setEditor(null)}
          onSaved={(event) => { setEvents((current) => { const next = current.filter((item) => item.id !== event.id); return [...next, event].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()); }); setEditor(null); }}
          onDeleted={(id) => { setEvents((current) => current.filter((event) => event.id !== id)); setEditor(null); }}
        />
      )}
    </main>
  );
}
