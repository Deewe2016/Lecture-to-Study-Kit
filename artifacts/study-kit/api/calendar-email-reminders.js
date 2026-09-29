import { createHash } from "node:crypto";

const FLEXUS_CALENDAR_URL = "https://flexus-workspace.vercel.app/calendar";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function minutesBefore(reminder) {
  return Math.max(0, Number(reminder && reminder.minutes_before) || 0);
}

function dateKey(date) {
  return date.getUTCFullYear() + "-" +
    String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(date.getUTCDate()).padStart(2, "0");
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function occurrenceMatches(rule, anchor, candidate) {
  if (candidate < startOfUtcDay(anchor)) return false;
  const interval = Math.max(1, Number(rule && rule.interval) || 1);
  const weekday = candidate.getUTCDay();

  if (rule && rule.frequency === "daily") {
    const diff = Math.round(
      (startOfUtcDay(candidate).getTime() - startOfUtcDay(anchor).getTime()) / 86400000,
    );
    return diff % interval === 0 &&
      (!Array.isArray(rule.byWeekday) || !rule.byWeekday.length || rule.byWeekday.includes(weekday));
  }

  if (rule && rule.frequency === "weekly") {
    const anchorWeek = startOfUtcDay(anchor);
    anchorWeek.setUTCDate(anchorWeek.getUTCDate() - anchorWeek.getUTCDay());
    const candidateWeek = startOfUtcDay(candidate);
    candidateWeek.setUTCDate(candidateWeek.getUTCDate() - candidateWeek.getUTCDay());
    const weeks = Math.round((candidateWeek.getTime() - anchorWeek.getTime()) / (7 * 86400000));
    const weekdays = Array.isArray(rule.byWeekday) && rule.byWeekday.length
      ? rule.byWeekday
      : [anchor.getUTCDay()];
    return weeks >= 0 && weeks % interval === 0 && weekdays.includes(weekday);
  }

  if (rule && rule.frequency === "monthly") {
    const months =
      (candidate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      candidate.getUTCMonth() - anchor.getUTCMonth();
    return months >= 0 &&
      months % interval === 0 &&
      candidate.getUTCDate() === (Number(rule.dayOfMonth) || anchor.getUTCDate());
  }

  if (rule && rule.frequency === "yearly") {
    const years = candidate.getUTCFullYear() - anchor.getUTCFullYear();
    return years >= 0 &&
      years % interval === 0 &&
      candidate.getUTCMonth() + 1 === (Number(rule.month) || anchor.getUTCMonth() + 1) &&
      candidate.getUTCDate() === (Number(rule.dayOfMonth) || anchor.getUTCDate());
  }

  return false;
}

function occurrenceAllowedByEnd(rule, anchor, candidate) {
  if (!rule || !rule.end) return true;
  if (rule.end.type === "date" && rule.end.date && dateKey(candidate) > rule.end.date) return false;
  if (rule.end.type !== "count") return true;

  const count = Math.max(0, Number(rule.end.count) || 0);
  if (!count) return false;
  const interval = Math.max(1, Number(rule.interval) || 1);

  if (rule.frequency === "monthly") {
    const months =
      (candidate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      candidate.getUTCMonth() - anchor.getUTCMonth();
    return Math.floor(months / interval) + 1 <= count;
  }

  if (rule.frequency === "yearly") {
    const years = candidate.getUTCFullYear() - anchor.getUTCFullYear();
    return Math.floor(years / interval) + 1 <= count;
  }

  if (rule.frequency === "weekly") {
    const anchorWeek = startOfUtcDay(anchor);
    anchorWeek.setUTCDate(anchorWeek.getUTCDate() - anchorWeek.getUTCDay());
    const candidateWeek = startOfUtcDay(candidate);
    candidateWeek.setUTCDate(candidateWeek.getUTCDate() - candidateWeek.getUTCDay());
    const weeks = Math.max(0, Math.round((candidateWeek.getTime() - anchorWeek.getTime()) / (7 * 86400000)));
    const weekdays = Array.isArray(rule.byWeekday) && rule.byWeekday.length
      ? [...rule.byWeekday].sort((a, b) => a - b)
      : [anchor.getUTCDay()];
    const position = Math.max(0, weekdays.indexOf(candidate.getUTCDay()));
    return Math.floor(weeks / interval) * weekdays.length + position + 1 <= count;
  }

  const diff = Math.max(0, Math.round(
    (startOfUtcDay(candidate).getTime() - startOfUtcDay(anchor).getTime()) / 86400000,
  ));
  if (rule.frequency === "daily" && Array.isArray(rule.byWeekday) && rule.byWeekday.length) {
    let matched = 0;
    for (let day = startOfUtcDay(anchor); day <= candidate; day = addUtcDays(day, 1)) {
      if (rule.byWeekday.includes(day.getUTCDay()) && occurrenceMatches(rule, anchor, day)) matched += 1;
    }
    return matched <= count;
  }
  return Math.floor(diff / interval) + 1 <= count;
}

function occurrenceStarts(event, rangeStart, rangeEnd) {
  if (!event.recurrence_rule) {
    const start = new Date(event.start_at);
    return start >= rangeStart && start <= rangeEnd ? [{ start, key: dateKey(start) }] : [];
  }

  const rule = event.recurrence_rule;
  const anchor = new Date(event.start_at);
  const exceptions = new Set(Array.isArray(rule.exceptions) ? rule.exceptions : []);
  const overrides = rule.overrides || {};
  const results = [];

  for (let day = startOfUtcDay(rangeStart); day <= startOfUtcDay(rangeEnd); day = addUtcDays(day, 1)) {
    if (!occurrenceMatches(rule, anchor, day)) continue;
    const key = dateKey(day);
    if (exceptions.has(key) || !occurrenceAllowedByEnd(rule, anchor, day)) continue;

    const start = new Date(anchor);
    start.setUTCFullYear(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    if (overrides[key] && overrides[key].start_at) start.setTime(new Date(overrides[key].start_at).getTime());
    if (start >= rangeStart && start <= rangeEnd) results.push({ start, key });
  }

  return results;
}

function formatEventDate(start, end, timeZone) {
  let safeZone = timeZone || "America/Los_Angeles";
  try { new Intl.DateTimeFormat("en-US", { timeZone: safeZone }).format(start); }
  catch { safeZone = "America/Los_Angeles"; }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const startText = formatter.format(start);
  const endText = formatter.format(end);
  return startText === endText ? startText : startText + " – " + endText;
}

function reminderHtml(event, occurrenceStart, occurrenceEnd) {
  const dateText = formatEventDate(occurrenceStart, occurrenceEnd, event.timezone);
  const location = event.location
    ? "<p style=\"margin:12px 0\"><strong>Location</strong><br>" + escapeHtml(event.location) + "</p>"
    : "";
  const description = event.description
    ? "<p style=\"margin:12px 0\"><strong>Description</strong><br>" +
      escapeHtml(event.description).replaceAll("\n", "<br>") + "</p>"
    : "";

  return "<div style=\"font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#202124\">" +
    "<h1 style=\"font-size:24px;margin:0 0 20px\">" + escapeHtml(event.title) + "</h1>" +
    "<p style=\"margin:12px 0\"><strong>Date and time</strong><br>" + escapeHtml(dateText) + "</p>" +
    location + description +
    "<p style=\"margin:28px 0\"><a href=\"" + FLEXUS_CALENDAR_URL +
    "\" style=\"display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600\">" +
    "View in Flexus</a></p></div>";
}

async function supabaseRequest(path, init = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log("[calendar-email-reminders] Supabase request", {
    method: init.method || "GET",
    path,
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    hasSUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
  if (!supabaseUrl || !supabaseKey) throw new Error("Server-side Supabase credentials are not configured.");

  const response = await fetch(supabaseUrl.replace(/\/$/, "") + path, {
    ...init,
    headers: {
      apikey: supabaseKey,
      Authorization: "Bearer " + supabaseKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  console.log("[calendar-email-reminders] Supabase response", {
    path,
    status: response.status,
    ok: response.ok,
    body: text.slice(0, 2000),
  });
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(
      typeof data === "object" && data
        ? String(data.message || data.details || data.hint || "Supabase request failed")
        : "Supabase request failed",
    );
  }
  return data;
}

async function sendResendEmail(to, event, occurrenceStart, occurrenceEnd, reminderId, occurrenceKey) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "Flexus Calendar <onboarding@resend.dev>";
  console.log("[calendar-email-reminders] Preparing Resend request", {
    recipient: to,
    eventId: event.id,
    eventTitle: event.title,
    occurrenceKey,
    reminderId,
    from,
    hasRESEND_API_KEY: Boolean(apiKey),
  });
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured in Vercel.");

  const idempotencyKey = "flexus-calendar/" + event.id + "/" + occurrenceKey + "/" + reminderId + "/" + to;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      "Idempotency-Key": idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Reminder: " + event.title,
      html: reminderHtml(event, occurrenceStart, occurrenceEnd),
    }),
  });

  const text = await response.text();
  console.log("[calendar-email-reminders] Resend response", {
    status: response.status,
    ok: response.ok,
    body: text.slice(0, 5000),
  });
  if (!response.ok) throw new Error("Resend HTTP " + response.status + ": " + text.slice(0, 500));
}

export default async function handler(req, res) {
  console.log("[calendar-email-reminders] Function called", {
    method: req.method,
    cronSecretSha256: process.env.CRON_SECRET
      ? createHash("sha256").update(process.env.CRON_SECRET).digest("hex")
      : null,
    hasAuthorizationHeader: Boolean(req.headers.authorization),
    hasCRON_SECRET: Boolean(process.env.CRON_SECRET),
    hasRESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
    hasRESEND_FROM_EMAIL: Boolean(process.env.RESEND_FROM_EMAIL),
    hasSUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    hasVITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL),
    hasSUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    hasSUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });

  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== "Bearer " + cronSecret) {
    console.error("[calendar-email-reminders] Authorization failed", {
      hasCRON_SECRET: Boolean(cronSecret),
      authorizationMatches: Boolean(cronSecret && req.headers.authorization === "Bearer " + cronSecret),
    });
    return res.status(401).json({ error: "Unauthorized." });
  }

  console.log("[calendar-email-reminders] Authorization passed.");

  try {
    const now = new Date();
    console.log("[calendar-email-reminders] Job started", { now: now.toISOString() });
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    const events = await supabaseRequest(
      "/rest/v1/calendar_events?select=id,owner_id,title,start_at,end_at,timezone,location,description,recurrence_rule,reminders,notify_invites&reminders=neq.%5B%5D&limit=1000",
    );
    const inviteRows = await supabaseRequest("/rest/v1/calendar_event_invites?select=event_id,user_id&limit=5000");
    const users = await supabaseRequest("/rest/v1/users?select=id,email&limit=5000");

    console.log("[calendar-email-reminders] Query results", {
      events: Array.isArray(events) ? events.length : "not-array",
      invites: Array.isArray(inviteRows) ? inviteRows.length : "not-array",
      users: Array.isArray(users) ? users.length : "not-array",
      eventsWithReminders: Array.isArray(events) ? events.filter((event) => Array.isArray(event.reminders) && event.reminders.length).length : 0,
    });

    const emailByUserId = new Map(
      (users || []).filter((user) => user && user.id && user.email).map((user) => [user.id, user.email]),
    );
    const invitesByEventId = new Map();
    for (const row of inviteRows || []) {
      if (!invitesByEventId.has(row.event_id)) invitesByEventId.set(row.event_id, []);
      invitesByEventId.get(row.event_id).push(row.user_id);
    }

    let sent = 0;
    let skipped = 0;
    const failures = [];

    for (const event of Array.isArray(events) ? events : []) {
      const reminders = Array.isArray(event.reminders) ? event.reminders : [];
      console.log("[calendar-email-reminders] Processing event", {
        eventId: event.id,
        title: event.title,
        startAt: event.start_at,
        reminders,
        notifyInvites: event.notify_invites,
      });
      if (!reminders.length) continue;

      const maxMinutes = Math.max(...reminders.map(minutesBefore), 0);
      const occurrences = occurrenceStarts(
        event,
        new Date(now.getTime() - 2 * 60 * 1000),
        new Date(now.getTime() + maxMinutes * 60 * 1000 + 2 * 60 * 1000),
      );

      const recipients = new Set();
      const ownerEmail = emailByUserId.get(event.owner_id);
      if (ownerEmail) recipients.add(ownerEmail);

      if (event.notify_invites) {
        for (const userId of invitesByEventId.get(event.id) || []) {
          const email = emailByUserId.get(userId);
          if (email) recipients.add(email);
        }
      }

      console.log("[calendar-email-reminders] Event scheduling", {
        eventId: event.id,
        occurrences: occurrences.map((occurrence) => ({ start: occurrence.start.toISOString(), key: occurrence.key })),
        recipients: [...recipients],
      });

      for (const occurrence of occurrences) {
        const duration = new Date(event.end_at).getTime() - new Date(event.start_at).getTime();
        const occurrenceEnd = new Date(occurrence.start.getTime() + Math.max(0, duration));

        for (const reminder of reminders) {
          const dueAt = new Date(occurrence.start.getTime() - minutesBefore(reminder) * 60000);
          console.log("[calendar-email-reminders] Reminder check", {
            eventId: event.id,
            occurrenceKey: occurrence.key,
            reminderId: reminder.id,
            minutesBefore: minutesBefore(reminder),
            dueAt: dueAt.toISOString(),
            now: now.toISOString(),
            due: !(dueAt > now || dueAt < twoMinutesAgo),
          });
          if (dueAt > now || dueAt < twoMinutesAgo) continue;

          for (const email of recipients) {
            const existing = await supabaseRequest(
              "/rest/v1/calendar_email_reminder_deliveries?select=id&event_id=eq." +
              event.id +
              "&occurrence_key=eq." + encodeURIComponent(occurrence.key) +
              "&reminder_id=eq." + encodeURIComponent(reminder.id) +
              "&recipient_email=eq." + encodeURIComponent(email) +
              "&limit=1",
            );
            if (Array.isArray(existing) && existing.length) {
              skipped += 1;
              continue;
            }

            try {
              console.log("[calendar-email-reminders] Sending reminder", {
                eventId: event.id,
                occurrenceKey: occurrence.key,
                reminderId: reminder.id,
                recipient: email,
              });
              await sendResendEmail(email, event, occurrence.start, occurrenceEnd, reminder.id, occurrence.key);
              await supabaseRequest("/rest/v1/calendar_email_reminder_deliveries", {
                method: "POST",
                headers: { Prefer: "return=minimal" },
                body: JSON.stringify({
                  event_id: event.id,
                  occurrence_key: occurrence.key,
                  reminder_id: reminder.id,
                  recipient_email: email,
                }),
              });
              sent += 1;
            } catch (error) {
              console.error("[calendar-email-reminders] Reminder send failed", error);
              failures.push({
                event_id: event.id,
                occurrence_key: occurrence.key,
                reminder_id: reminder.id,
                recipient: email,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    }

    console.log("[calendar-email-reminders] Job finished", { sent, skipped, failures });
    return res.status(failures.length ? 207 : 200).json({ ok: failures.length === 0, sent, skipped, failures });
  } catch (error) {
    console.error("[calendar-email-reminders] Job failed with full error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Calendar email reminder job failed.",
    });
  }
}
