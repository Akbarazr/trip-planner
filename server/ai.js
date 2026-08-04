// Conversational trip assistant named "Cotrip".
// Priority: 1) Google Gemini if a key is set, 2) Pollinations (free, no key)
// for a real ChatGPT-like chat, 3) a local rule-based fallback if offline.

const SYSTEM_PROMPT = `You are Cotrip, a precise travel-planning assistant.
Answer only what the user asked. Do not introduce yourself, greet the user, repeat
their question, add a sign-off, advertise features, or mention the AI provider.
Use one to four short sentences unless the user explicitly asks for a list or a
detailed plan.

HOW TO THINK (read carefully before replying):
- Read the WHOLE conversation, not just the last line. Follow-ups like "is there one
  on the way?", "which is closest?", or "any cheaper?" refer back to what was just
  discussed — answer THOSE, keeping the same topic (e.g. if we were talking about
  restaurants, stay on restaurants).
- Answer the EXACT question asked. If they ask "on the way", only talk about places
  between the origin and destination — do NOT list places at the destination, and
  vice-versa. If they ask "which one", pick and justify a single best option.
- Don't repeat a previous answer verbatim; build on it and add what they now asked for.
- Be concise and specific. Do not add loosely related alternatives.
- Do not say "I found something close" or substitute a nearby place when the exact
  requested type was not found. State that the exact match was unavailable.
- Never claim that a pin, dot, marker, itinerary stop, booking, or other app change
  was completed. The application performs those actions separately.

ACCURACY RULES:
- If the trip context includes driving_distance_miles or driving_time, use THOSE exact
  numbers. NEVER invent or guess distances or times.
- Only recommend real places that make sense for the given origin and destination and
  the requested location (on the way vs at destination). If unsure, don't fabricate.
- Strongly prefer the specific real places listed under "Real places found near the
  route" — they're already matched to the request.`;

export async function chat({ messages, context, kind, places, focus, note, request }) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  // Build a summary of the real places we found so the AI names specific spots.
  const placeText = (places && places.length)
    ? '\n\nReal places found near the route (mention THESE specific names if relevant):\n' +
      places.map((p) => `- ${p.name} (${p.where || 'nearby'})${p.details ? ' — ' + p.details : ''}`).join('\n')
    : '';
  const focusText = focus
    ? `\n\nThe user is asking specifically about places ${focus.toUpperCase()}. Only discuss places that are ${focus}.`
    : '';
  const noteText = note ? `\n\nIMPORTANT SEARCH RESULT (obey this exactly): ${note}` : '';
  const systemText = SYSTEM_PROMPT + '\n\nTrip context:\n' + JSON.stringify(context || {}) + placeText + focusText + noteText;

  if (geminiKey) {
    try {
      return { reply: cleanReply(await gemini(messages, systemText, geminiKey)), source: 'gemini' };
    } catch (e) {
      console.warn('Gemini failed, falling back:', e.message);
    }
  }

  if (groqKey) {
    try {
      return { reply: cleanReply(await groq(messages, systemText, groqKey)), source: 'groq' };
    } catch (e) {
      console.warn('Groq failed, falling back:', e.message);
    }
  }

  // Free, keyless conversational AI (OpenAI-compatible endpoint).
  try {
    return { reply: cleanReply(await pollinations(messages, systemText)), source: 'ai' };
  } catch (e) {
    console.warn('Pollinations failed, using local fallback:', e.message);
  }

  return { reply: localFallback(messages, context, kind, places, request), source: 'local' };
}

function cleanReply(reply) {
  return String(reply || '')
    .replace(/^(?:hello|hi|hey)[!,.:\s-]*/i, '')
    .replace(/^cotrip(?:\s+here)?[!,.:\s🌿👋-]*/iu, '')
    .replace(/\b(?:powered by|using)\s+(?:groq|gemini|pollinations)\b[^.]*\.?/gi, '')
    .trim();
}

async function pollinations(messages, systemText) {
  const chatMessages = [
    { role: 'system', content: systemText },
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai', messages: chatMessages, temperature: 0.4 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('empty reply');
  return reply;
}

async function groq(messages, systemText, key) {
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemText },
        ...messages.map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
      ],
      temperature: 0.3,
      max_tokens: 350,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('empty reply');
  return reply;
}

async function gemini(messages, systemText, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const body = {
    system_instruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 350 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
    "I couldn't come up with a reply just now — try rephrasing?"
  );
}

// Reasonable, specific replies so the app is genuinely useful with zero API
// keys. When we have real nearby places, name them so each kind of question
// (food vs lodging vs fuel vs attractions) gives a different, concrete answer.
function localFallback(messages, context, kind, places, request = {}) {
  const last = (messages[messages.length - 1]?.content || '').toLowerCase();
  const dest = context?.destination?.split(',')[0] || 'your destination';
  const origin = context?.origin?.split(',')[0] || 'your starting point';

  // De-duplicate places by name and split by where they are.
  const seen = new Set();
  const unique = (places || []).filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
  const onWay = unique.filter((p) => p.where === 'on the way');
  const atDest = unique.filter((p) => p.where === 'at destination');
  const list = (arr) => arr.map((p) => p.name).join(', ');

  if (request.strict && !unique.length) {
    const where = request.focus ? ` ${request.focus}` : ' near this trip';
    return `I couldn't find a mapped ${request.label || 'exact match'}${where}. I won't substitute or pin a different type of place. Try a nearby town or a wider part of the route.`;
  }

  if (kind && unique.length) {
    const noun = {
      lodging: 'places to stay',
      food: 'places to eat',
      fuel: 'fuel/charging stops',
      attraction: 'things to see',
    }[kind] || 'spots';
    const parts = [];
    parts.push(`Here are ${noun} for your ${origin} → ${dest} trip:`);
    if (onWay.length) parts.push(`\n🛣️ On the way: ${list(onWay)}.`);
    if (atDest.length) parts.push(`\n🏁 Around ${dest}: ${list(atDest)}.`);
    return parts.join('');
  }

  // No specific places found (or a non-place question) — give useful guidance.
  if (kind === 'lodging' || /overnight|stay|hotel|sleep/.test(last)) {
    return `For overnight stops between ${origin} and ${dest}, plan to stop every 4–5 hours of driving near a decent-sized town just off the highway (cheaper and safer). I couldn't pull live hotels for this exact route right now — tap the 🏕️ Stay button to try again.`;
  }
  if (kind === 'food' || /eat|food|restaurant|lunch/.test(last)) {
    return `Good food stops are usually in town centers rather than right on the highway. Aim for lunch around the halfway point of each day. Tap the 🍽️ Food button to pull up real nearby restaurants.`;
  }
  if (/safe|route|road/.test(last)) {
    return `For a safe drive to ${dest}: stick to major highways in daylight, keep fuel above a quarter tank, and take a 15-minute break every 2 hours. Add your stops and the map re-routes to pass close to each one.`;
  }
  if (/how long|time|hours|distance|far/.test(last)) {
    return `Check the "total drive" and "driving time" stats at the top of your trip — they update automatically as you add stops. Add a rest every 2 hours to the driving time for a realistic day.`;
  }
  return `Ask a specific question about your ${origin} → ${dest} trip, such as where to stop, eat, stay, refuel, or what to visit.`;
}
