// force-redeploy-2026-11-11-v2
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body || {};
  const action = body.action;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const events = Array.isArray(body.events) ? body.events : [];

  console.log('generate-events called, action:', action, 'events count:', events.length, 'prompt:', prompt.slice(0, 100));

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured.' });

  // FIND EVENTS TO DELETE
  if (action === 'find-to-delete') {
    console.log('Handling find-to-delete with', events.length, 'events');
    if (!prompt) return res.status(400).json({ error: 'Describe which events to delete.' });
    if (events.length === 0) return res.status(400).json({ error: 'No events provided.' });

    const eventList = events.map(e => ({ id: e.id, title: e.title, date: e.start_at }));
    
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          temperature: 0.1,
          max_tokens: 500,
          messages: [
            { role: 'system', content: 'Return ONLY a JSON array of event IDs that match the description. Example: ["id1","id2"]. No other text.' },
            { role: 'user', content: `Events: ${JSON.stringify(eventList)}\nDelete: ${prompt}` }
          ]
        })
      });
      const data = await groqRes.json();
      console.log('Groq delete response:', JSON.stringify(data).slice(0, 500));
      const content = data?.choices?.[0]?.message?.content || '[]';
      const start = content.indexOf('[');
      const end = content.lastIndexOf(']');
      const ids = start >= 0 ? JSON.parse(content.slice(start, end + 1)) : [];
      console.log('Found IDs to delete:', ids);
      return res.status(200).json({ ids });
    } catch (err) {
      console.error('Delete error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // CREATE EVENTS
  if (!prompt) return res.status(400).json({ error: 'Describe the events you want to create.' });

  function getNextWeekday(targetDay) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let daysToAdd = targetDay - today.getDay();
    if (daysToAdd <= 0) daysToAdd += 7;
    const result = new Date(today);
    result.setDate(today.getDate() + daysToAdd);
    const y = result.getFullYear();
    const m = String(result.getMonth() + 1).padStart(2, '0');
    const d = String(result.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayISO = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const todayDay = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const weekdayDates = {
    Sunday: getNextWeekday(0), Monday: getNextWeekday(1), Tuesday: getNextWeekday(2),
    Wednesday: getNextWeekday(3), Thursday: getNextWeekday(4), Friday: getNextWeekday(5), Saturday: getNextWeekday(6)
  };
  const weeks = Math.max(1, Math.min(52, parseInt(body.weeks) || 12));
  const color = body.color || 'tomato';
  const allDay = body.allDay === true;

  const fullPrompt = `YOU MUST USE ONLY THESE EXACT DATES. DO NOT CALCULATE DATES YOURSELF.
TODAY: ${todayISO} (${todayDay})
NEXT MONDAY: ${weekdayDates.Monday}
NEXT TUESDAY: ${weekdayDates.Tuesday}
NEXT WEDNESDAY: ${weekdayDates.Wednesday}
NEXT THURSDAY: ${weekdayDates.Thursday}
NEXT FRIDAY: ${weekdayDates.Friday}
NEXT SATURDAY: ${weekdayDates.Saturday}
NEXT SUNDAY: ${weekdayDates.Sunday}
Generate ${weeks} weeks of occurrences. Return ONLY a JSON array: [{"title":"string","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","color":"${color}","allDay":${allDay}}]`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        temperature: 0.1,
        max_tokens: 6000,
        messages: [
          { role: 'system', content: fullPrompt },
          { role: 'user', content: `Create calendar events for: ${prompt}` }
        ]
      })
    });
    const data = await groqRes.json();
    console.log('Groq create response:', JSON.stringify(data).slice(0, 300));
    const content = data?.choices?.[0]?.message?.content || '[]';
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']');
    const parsedEvents = start >= 0 ? JSON.parse(content.slice(start, end + 1)) : [];
    const result = parsedEvents.map(e => ({ ...e, color, all_day: allDay, startDate: e.date || e.startDate || todayISO }));
    return res.status(200).json({ events: result });
  } catch (err) {
    console.error('Create error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}