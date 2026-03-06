import { createServer } from 'node:http';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadDotEnv();

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS ?? '180000', 10);
const REQUEST_BODY_LIMIT_BYTES = 1_000_000;
const CACHE_TTL_MS = Number.parseInt(process.env.AI_CACHE_TTL_MS ?? '300000', 10);
const CACHE_MAX_ENTRIES = Number.parseInt(process.env.AI_CACHE_MAX_ENTRIES ?? '100', 10);

const SYSTEM_PROMPT = 'You create backing-track arrangements as strict JSON. Return only valid JSON. No markdown fences. Follow the requested schema exactly.';
const ARRANGEMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'instrumentPlans'],
  properties: {
    title: { type: 'string', minLength: 1 },
    instrumentPlans: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['instrument'],
        properties: {
          instrument: { type: 'string' },
          notes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['midi', 'startBeats', 'durationBeats', 'velocity'],
              properties: {
                midi: { type: 'number' },
                startBeats: { type: 'number' },
                durationBeats: { type: 'number' },
                velocity: { type: 'number' },
              },
            },
          },
          drumHits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'startBeats', 'velocity'],
              properties: {
                kind: { type: 'string', enum: ['kick', 'snare', 'hat', 'openHat'] },
                startBeats: { type: 'number' },
                velocity: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
};
const ALLOWED_TIME_SIGNATURES = new Set(['4/4', '3/4', '6/8', '5/4', '7/8']);
const ALLOWED_GENRES = new Set([
  'jazz', 'blues', 'rock', 'pop', 'hip-hop',
  'electronic', 'classical', 'country', 'funk',
  'latin', 'reggae', 'metal', 'soul', 'rnb',
]);
const ALLOWED_INSTRUMENTS = new Set([
  'drums', 'bass', 'piano', 'guitar-acoustic', 'guitar-electric',
  'saxophone', 'trumpet', 'trombone', 'violin', 'cello',
  'synth-lead', 'synth-pad', 'strings', 'choir', 'organ',
  'flute', 'clarinet', 'vibraphone', 'harp', 'harmonica',
]);

const arrangementCache = new Map();
const inFlightRequests = new Map();

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    writeJson(res, 200, {
      ok: true,
      openAiConfigured: Boolean(OPENAI_API_KEY),
      cacheEntries: arrangementCache.size,
      inflightRequests: inFlightRequests.size,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/backing-track') {
    if (!OPENAI_API_KEY) {
      writeJson(res, 500, {
        error: 'OPENAI_API_KEY is not set. Add it to your backend environment before using AI backing track generation.',
      });
      return;
    }

    try {
      const requestBody = await readJsonBody(req);
      const config = normalizeBackingTrackRequest(requestBody);
      const cacheKey = createCacheKey(config);
      const cached = getCachedArrangement(cacheKey);
      if (cached) {
        writeJson(res, 200, cached);
        return;
      }

      const existingRequest = inFlightRequests.get(cacheKey);
      const arrangementPromise = existingRequest ?? requestArrangement(config).finally(() => {
        if (inFlightRequests.get(cacheKey) === arrangementPromise) {
          inFlightRequests.delete(cacheKey);
        }
      });
      if (!existingRequest) {
        inFlightRequests.set(cacheKey, arrangementPromise);
      }

      const arrangement = await arrangementPromise;
      setCachedArrangement(cacheKey, arrangement);
      writeJson(res, 200, arrangement);
    } catch (error) {
      console.error('Failed to generate backing track plan:', error);
      const message = error instanceof Error ? error.message : 'Unknown server error.';
      const status = getStatusCodeForError(error);
      writeJson(res, status, { error: message });
    }
    return;
  }

  writeJson(res, 404, { error: 'Not found.' });
}).listen(PORT, () => {
  console.log(`AI backend listening on http://localhost:${PORT}`);
});

async function requestArrangement(config) {
  const prompt = buildPrompt(config);
  let payload;

  try {
    payload = await requestOpenAiResponse(prompt, { structuredOutput: true });
  } catch (error) {
    if (!isStructuredOutputCompatibilityError(error)) {
      throw error;
    }
    payload = await requestOpenAiResponse(prompt, { structuredOutput: false });
  }

  const text = extractOutputText(payload);
  const parsed = safeJsonParse(text);
  validateArrangement(parsed, config.instruments);
  return parsed;
}

async function requestOpenAiResponse(prompt, { structuredOutput }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let response;

  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
        ...(structuredOutput ? {
          text: {
            format: {
              type: 'json_schema',
              name: 'backing_track_arrangement',
              schema: ARRANGEMENT_JSON_SCHEMA,
              strict: true,
            },
          },
        } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`OpenAI request timed out after ${OPENAI_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  return payload;
}

function buildPrompt(config) {
  const snippetSection = config.snippetFeatures
    ? `
- reference snippet features:
  durationSeconds=${config.snippetFeatures.durationSeconds.toFixed(2)}
  rms=${config.snippetFeatures.rms.toFixed(3)}
  peak=${config.snippetFeatures.peak.toFixed(3)}
  dynamicRangeDb=${config.snippetFeatures.dynamicRangeDb.toFixed(1)}
  onsetDensity=${config.snippetFeatures.onsetDensity.toFixed(2)} onsets/sec
  pulseBpm=${config.snippetFeatures.pulseBpm ?? 'unknown'}`
    : '';

  return `
Generate a backing-track arrangement for these settings:
- genre: ${config.genre}
- bpm: ${config.bpm}
- key: ${config.key}
- timeSignature: ${config.timeSignature}
- bars: ${config.bars}
- instruments: ${config.instruments.join(', ')}
${snippetSection}

Return JSON in this shape:
{
  "title": "short title",
  "instrumentPlans": [
    {
      "instrument": "drums",
      "drumHits": [
        { "kind": "kick" | "snare" | "hat" | "openHat", "startBeats": number, "velocity": number }
      ]
    },
    {
      "instrument": "bass",
      "notes": [
        { "midi": number, "startBeats": number, "durationBeats": number, "velocity": number }
      ]
    }
  ]
}

Rules:
- Include exactly one instrumentPlans item per requested instrument.
- For non-drum instruments, use only the "notes" array.
- For drums, use only the "drumHits" array.
- startBeats and durationBeats must fit inside the total bar length.
- velocity must be between 0.2 and 1.
- Keep note MIDI values strictly within these ranges (out-of-range notes will sound completely wrong):
  guitar-acoustic and guitar-electric: 40–84 (E2–C6); bass: 28–55 (E1–G3);
  piano/organ: 48–84 (C3–C6); trumpet: 52–82 (E3–Bb5); trombone: 40–72 (E2–C5);
  clarinet: 50–90 (D3–F#6); flute: 60–96 (C4–C7); violin: 55–96 (G3–C7);
  viola: 48–84 (C3–C6); cello: 36–76 (C2–E5); saxophone: 49–90 (Db3–F#6);
  harmonica: 60–84 (C4–C6); vibraphone: 53–89 (F3–F6); harp: 24–103 (C1–G7);
  strings/choir/synth-pad/synth-lead: 48–84.
- For guitar parts, use chords rooted in the E2–G3 range (MIDI 40–55). Write strummed chords as 4 near-simultaneous notes offset +0.02 beats per string, not high single-note melodies.
- Make the arrangement musical, loopable, and stylistically appropriate.
- Prioritize pocket, phrase continuity, and parts that lock together as an ensemble.
- Avoid machine-gun staccato or hyper-fragmented note patterns unless the genre explicitly needs it.
- Prefer fewer, stronger phrases over busy note spam.
- Avoid bland sustained blocks unless the style specifically calls for them.
- Add phrase variation, rhythmic motion, passing tones, fills, and syncopation across the full form.
- Use meaningful velocity variation so the part breathes instead of feeling step-sequenced.
- Bass should groove and connect harmony with approach notes or rhythmic anticipation, not only roots.
- Harmony instruments should use fuller voicings, inversions, and tasteful movement when appropriate.
- Lead instruments should develop motifs across bars instead of repeating one cell unchanged.
- Drum parts should include hat motion, occasional open hats, and fills near phrase boundaries.
- If reference snippet features are provided, shape rhythmic density and dynamics to match:
  - Keep note density within ±20% of reference onsetDensity unless genre constraints conflict.
  - If pulseBpm is known and differs from requested BPM, interpret the snippet as half-time/double-time feel and keep that relationship.
  - Track dynamic contour using rms and dynamicRangeDb (flatter for low dynamic range, more accents for high).
`.trim();
}

function normalizeBackingTrackRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be a JSON object.');
  }

  const genre = typeof body.genre === 'string' ? body.genre : '';
  const bpm = Number.parseInt(String(body.bpm ?? ''), 10);
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const timeSignature = typeof body.timeSignature === 'string' ? body.timeSignature : '';
  const bars = Number.parseInt(String(body.bars ?? ''), 10);
  const instruments = Array.isArray(body.instruments)
    ? body.instruments.filter(instrument => typeof instrument === 'string')
    : [];
  const snippetFeatures = parseSnippetFeatures(body.snippetFeatures);

  if (!ALLOWED_GENRES.has(genre)) throw new Error('Invalid genre.');
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('BPM must be between 40 and 240.');
  if (!key || key.length > 4) throw new Error('Invalid key.');
  if (!ALLOWED_TIME_SIGNATURES.has(timeSignature)) throw new Error('Invalid time signature.');
  if (!Number.isFinite(bars) || ![4, 8, 16, 32, 64].includes(bars)) throw new Error('Bars must be one of 4, 8, 16, 32, or 64.');
  if (!instruments.length) throw new Error('Select at least one instrument.');

  const uniqueInstruments = [...new Set(instruments)];
  for (const instrument of uniqueInstruments) {
    if (!ALLOWED_INSTRUMENTS.has(instrument)) {
      throw new Error(`Invalid instrument: ${instrument}`);
    }
  }

  return {
    genre,
    bpm,
    key,
    timeSignature,
    bars,
    instruments: uniqueInstruments.sort(),
    ...(snippetFeatures ? { snippetFeatures } : {}),
  };
}

function parseSnippetFeatures(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid snippetFeatures payload.');
  }

  const durationSeconds = parseFiniteNumber(raw.durationSeconds, 'snippetFeatures.durationSeconds', 0.5, 20);
  const rms = parseFiniteNumber(raw.rms, 'snippetFeatures.rms', 0, 1);
  const peak = parseFiniteNumber(raw.peak, 'snippetFeatures.peak', 0, 1);
  const dynamicRangeDb = parseFiniteNumber(raw.dynamicRangeDb, 'snippetFeatures.dynamicRangeDb', 0, 36);
  const onsetDensity = parseFiniteNumber(raw.onsetDensity, 'snippetFeatures.onsetDensity', 0, 30);
  const pulseBpm = raw.pulseBpm == null
    ? null
    : parseFiniteNumber(raw.pulseBpm, 'snippetFeatures.pulseBpm', 50, 220);

  return {
    durationSeconds,
    rms,
    peak,
    dynamicRangeDb,
    onsetDensity,
    pulseBpm: pulseBpm == null ? null : Math.round(pulseBpm),
  };
}

function parseFiniteNumber(value, fieldName, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function createCacheKey(config) {
  return JSON.stringify(config);
}

function getCachedArrangement(cacheKey) {
  const cached = arrangementCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    arrangementCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedArrangement(cacheKey, value) {
  arrangementCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  if (arrangementCache.size <= CACHE_MAX_ENTRIES) return;

  const oldestKey = arrangementCache.keys().next().value;
  if (oldestKey) {
    arrangementCache.delete(oldestKey);
  }
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload?.output_text)) {
    const arrayText = payload.output_text
      .map(item => (typeof item === 'string' ? item : item?.text ?? ''))
      .join('\n')
      .trim();
    if (arrayText) return arrayText;
  }

  if (Array.isArray(payload?.output)) {
    const textFromMessages = payload.output
      .flatMap(item => item?.content ?? [])
      .flatMap(content => {
        if (typeof content?.text === 'string') return [content.text];
        if (Array.isArray(content?.text)) {
          return content.text
            .map(part => (typeof part === 'string' ? part : part?.text ?? ''))
            .filter(Boolean);
        }
        return [];
      })
      .join('\n')
      .trim();
    if (textFromMessages) return textFromMessages;
  }

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const text = (payload.output ?? [])
    .flatMap(item => item.content ?? [])
    .filter(content => content.type === 'output_text' || content.type === 'text')
    .map(content => content.text ?? '')
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('OpenAI response did not include output text.');
  }

  return text;
}

function safeJsonParse(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('The model did not return valid JSON.');
    return JSON.parse(match[0]);
  }
}

function isStructuredOutputCompatibilityError(error) {
  const message = error instanceof Error ? error.message : '';
  return (
    message.includes('json_schema')
    || message.includes('text.format')
    || message.includes('response_format')
    || message.includes('Unsupported parameter')
  );
}

function validateArrangement(arrangement, requestedInstruments) {
  if (!arrangement || !Array.isArray(arrangement.instrumentPlans)) {
    throw new Error('Arrangement response is missing instrumentPlans.');
  }

  const returnedInstruments = arrangement.instrumentPlans.map(plan => plan.instrument);
  for (const instrument of requestedInstruments) {
    if (!returnedInstruments.includes(instrument)) {
      throw new Error(`Arrangement response is missing requested instrument: ${instrument}`);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > REQUEST_BODY_LIMIT_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });
    req.on('error', reject);
  });
}

function getStatusCodeForError(error) {
  const message = error instanceof Error ? error.message : '';
  if (
    message.includes('Invalid ')
    || message.includes('must be ')
    || message.includes('Select at least one instrument')
    || message.includes('Request body')
  ) {
    return 400;
  }
  if (message.includes('timed out')) return 504;
  if (message.includes('OpenAI API error')) return 502;
  return 500;
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function writeJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function loadDotEnv() {
  const envPath = resolve(process.cwd(), '.env');
  let raw = '';
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
