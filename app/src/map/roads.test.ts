import { afterEach, describe, expect, it, vi } from 'vitest'
import { overpassRoadNear } from './roads'

type FetchInit = { signal?: AbortSignal }

/** A fetch that never resolves until its signal aborts, like a hung mirror. */
function hanging(_url: string, init?: FetchInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
  })
}

function okResponse(elements: unknown[]): Response {
  return new Response(JSON.stringify({ elements }), { status: 200 })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('overpassRoadNear', () => {
  it('takes the first successful mirror, aborts the rest, and prefers tagged ways', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: FetchInit) => {
        if (init?.signal) signals.push(init.signal)
        if (url.includes('kumi')) {
          return Promise.resolve(
            okResponse([
              { type: 'way', tags: { highway: 'residential' } },
              { type: 'way', tags: { highway: 'secondary', lanes: '4' } },
            ]),
          )
        }
        if (url.includes('coffee')) return Promise.resolve(new Response('no', { status: 406 }))
        return hanging(url, init)
      }),
    )
    const start = Date.now()
    const tags = await overpassRoadNear([100.5, 13.7], new AbortController().signal)
    expect(tags).toEqual({ highway: 'secondary', lanes: '4' })
    expect(Date.now() - start).toBeLessThan(1000)
    expect(signals.length).toBe(4)
    expect(signals.every((s) => s.aborted)).toBe(true)
  })

  it('races the same-origin proxy and wins with it when the direct mirrors fail', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: FetchInit) => {
        urls.push(url)
        if (url === '/api/overpass') {
          return Promise.resolve(okResponse([{ type: 'way', tags: { highway: 'primary', width: '20' } }]))
        }
        if (url.includes('overpass-api.de')) return Promise.resolve(new Response('no', { status: 406 }))
        return hanging(url, init)
      }),
    )
    const tags = await overpassRoadNear([100.5604, 13.7373], new AbortController().signal)
    expect(tags).toEqual({ highway: 'primary', width: '20' })
    expect(urls).toContain('/api/overpass')
    expect(urls.length).toBe(4)
  })

  it('falls back to a direct mirror when the proxy is missing (npm run dev)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: FetchInit) => {
        if (url === '/api/overpass') return Promise.resolve(new Response('Not Found', { status: 404 }))
        if (url.includes('coffee')) return Promise.resolve(okResponse([{ type: 'way', tags: { highway: 'tertiary', lanes: '2' } }]))
        return hanging(url, init)
      }),
    )
    const tags = await overpassRoadNear([100.5, 13.7], new AbortController().signal)
    expect(tags).toEqual({ highway: 'tertiary', lanes: '2' })
  })

  it('treats a proxy 200 with a remark as a failed racer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/overpass') {
          return Promise.resolve(new Response(JSON.stringify({ elements: [], remark: 'runtime error' }), { status: 200 }))
        }
        return Promise.resolve(new Response('no', { status: 406 }))
      }),
    )
    await expect(overpassRoadNear([100.5, 13.7], new AbortController().signal)).rejects.toThrow()
  })

  it('rejects when every mirror fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('no', { status: 406 }))))
    await expect(overpassRoadNear([100.5, 13.7], new AbortController().signal)).rejects.toThrow(/406/)
  })

  it('rejects promptly when the caller aborts', async () => {
    vi.stubGlobal('fetch', vi.fn(hanging))
    const ctrl = new AbortController()
    const p = overpassRoadNear([100.5, 13.7], ctrl.signal)
    const started = Date.now()
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - started).toBeLessThan(500)
  })
})
