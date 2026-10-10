export default async function handler(req, res) {
  console.log('Handler called');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'A prompt is required.' });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[Generate Events] GROQ_API_KEY is not configured.');
    return res.status(500).json({ error: 'Event generation is not configured.' });
  }
  const messages = [
    { role: 'system', content: 'You are a calendar assistant. Return ONLY a valid JSON array of events. No markdown, no explanation, just the raw JSON array starting with [ and ending with ]. Each event must have title, startTime (HH:MM), endTime (HH:MM), recurrence (none|daily|weekly|monthly|yearly), daysOfWeek (array of lowercase weekday names), color, and startDate (YYYY-MM-DD or today). If the user specifies a duration, calculate endTime. If a weekly recurrence has an end period, include endDate. Do not invent extra events.' },
    { role: 'user', content: 'Extract calendar events from this description: ' + prompt + '\n\nReturn a JSON array like: [{"title":"Math Class","startTime":"15:00","endTime":"16:00","recurrence":"weekly","daysOfWeek":["monday"],"color":"blue","startDate":"today"}]' },
  ];
  try {
    console.log('[Generate Events] Starting Groq request', { model: 'openai/gpt-oss-20b', promptLength: prompt.length });
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-20b', messages, max_tokens: 2000, temperature: 0.1 }),
    });
    console.log('Groq raw response status:', response.status);
    const raw = await response.text();
    console.log('Groq raw text:', raw);
    console.log('[Generate Events] Groq HTTP status', response.status);
    if (!response.ok) {
      console.error('[Generate Events] Groq API error', { status: response.status, body: raw.slice(0, 2000) });
      return res.status(502).json({ error: 'Could not generate events. Please try again.' });
    }
    let data;
    try { data = JSON.parse(raw); }
    catch (error) {
      console.error('[Generate Events] Groq response was not valid API JSON', error, raw.slice(0, 2000));
      return res.status(502).json({ error: 'Could not generate events. Please try again.' });
    }
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid Groq response:', JSON.stringify(data));
      return res.status(500).json({ error: 'Invalid response from AI: ' + JSON.stringify(data) });
    }
    const content = data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      console.error('[Generate Events] Groq returned empty message content', JSON.stringify(data).slice(0, 2000));
      return res.status(502).json({ error: 'Could not generate events. Please try again.' });
    }
    let cleaned = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket < 0 || lastBracket < firstBracket) {
      console.error('[Generate Events] Groq response did not contain a complete JSON array', content.slice(0, 2000));
      return res.status(502).json({ error: 'Could not generate events. Please try again.' });
    }
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
    let events;
    try { events = JSON.parse(cleaned); }
    catch (error) {
      console.error('[Generate Events] Event JSON parse failed', error, cleaned.slice(0, 2000));
      return res.status(502).json({ error: 'Could not generate events. Please try again.' });
    }
    if (!Array.isArray(events)) {
      console.error('[Generate Events] Parsed result was not an array');
      return res.status(502).json({ error: 'Could not generate events. Please try again.' });
    }
    const validEvents = events.filter((event) => event && typeof event.title === 'string' && typeof event.startTime === 'string' && typeof event.endTime === 'string');
    if (validEvents.length !== events.length) console.warn('[Generate Events] Some generated items were missing required fields', { received: events.length, valid: validEvents.length });
    console.log('[Generate Events] Successfully parsed events', { count: validEvents.length });
    return res.status(200).json({ events: validEvents });
  } catch (err) {
    console.error('Unhandled error:', err.message, err.stack);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Could not generate events. Please try again.' });
    }
  }
}
