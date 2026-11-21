/**
 * Same-origin proxy for the Overpass road-width lookup (see docs/DECISIONS.md).
 * Browsers cannot reach the public Overpass mirrors (406 without CORS headers,
 * or timeouts), so this stateless function forwards exactly one query shape:
 *   [out:json][timeout:20];way["highway"](around:R,lat,lng);out tags;
 * with R <= 100 m and lat/lng inside a Bangkok bounding box. Anything else is 400.
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const MAX_BODY_BYTES = 500
const PER_MIRROR_TIMEOUT_MS = 4000
const QUERY_RE =
  /^\[out:json\]\[timeout:20\];way\["highway"\]\(around:(\d{1,3}),(-?\d{1,3}\.\d{1,8}),(-?\d{1,3}\.\d{1,8})\);out tags;$/
const BBOX = { minLat: 13.4, maxLat: 14.1, minLng: 100.2, maxLng: 101.0 }

function send(res, status, obj, extraHeaders) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  for (const [k, v] of Object.entries(extraHeaders ?? {})) res.setHeader(k, v)
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj))
}

async function readRawBody(req) {
  // Vercel may have parsed the body already; otherwise read the stream.
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (req.body && typeof req.body === 'object') {
    return typeof req.body.data === 'string' ? `data=${encodeURIComponent(req.body.data)}` : null
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES * 4) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Returns the validated query string, or null. Exported for local testing. */
export function validateBody(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || Buffer.byteLength(raw) > MAX_BODY_BYTES) return null
  if (!raw.startsWith('data=')) return null
  let query
  try {
    query = decodeURIComponent(raw.slice(5).replace(/\+/g, '%20'))
  } catch {
    return null
  }
  const m = QUERY_RE.exec(query)
  if (!m) return null
  const radius = Number(m[1])
  const lat = Number(m[2])
  const lng = Number(m[3])
  if (!(radius >= 1 && radius <= 100)) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return query
}

async function tryMirror(url, query, raceSignal) {
  const res = await fetch(url, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'plot-envelope-tool/1.0',
    },
    signal: AbortSignal.any([raceSignal, AbortSignal.timeout(PER_MIRROR_TIMEOUT_MS)]),
  })
  if (!res.ok) throw new Error(`${url} responded ${res.status}`)
  const text = await res.text()
  const json = JSON.parse(text)
  if (!Array.isArray(json.elements) || json.remark) throw new Error(`${url}: ${json.remark ?? 'no elements'}`)
  return text
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return send(res, 405, { error: 'POST only' })
  }
  let raw
  try {
    raw = await readRawBody(req)
  } catch {
    raw = null
  }
  const query = validateBody(raw)
  if (!query) return send(res, 400, { error: 'Invalid query' })

  // Mirrors raced in parallel; total budget is one per-mirror timeout (~4 s).
  const race = new AbortController()
  try {
    const text = await Promise.any(MIRRORS.map((u) => tryMirror(u, query, race.signal)))
    return send(res, 200, text, { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800' })
  } catch (err) {
    const errors = err instanceof AggregateError ? err.errors.map((e) => String(e?.message ?? e)) : [String(err)]
    return send(res, 502, { error: 'All Overpass mirrors failed', details: errors }, { 'Cache-Control': 'no-store' })
  } finally {
    race.abort()
  }
}
