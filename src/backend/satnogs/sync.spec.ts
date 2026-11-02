import { describe, expect, it, vi } from 'vitest'
import type { FetchFn } from './client'
import { makeObservation, makeSatellite, makeTransmitter } from './fixtures'
import { syncCandidates } from './sync'

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

const router =
  (observations: Record<number, unknown>): FetchFn =>
  async (url) => {
    if (url.includes('/api/transmitters/')) {
      return ok([
        makeTransmitter({ uuid: 'A', sat_id: 'S1', norad_cat_id: 1 }),
        makeTransmitter({ uuid: 'B', sat_id: 'S2', norad_cat_id: 2 }),
        makeTransmitter({ uuid: 'C', sat_id: 'S2', norad_cat_id: 2, downlink_low: 145_850_000 }),
      ])
    }
    if (url.includes('/api/satellites/')) {
      return ok([
        makeSatellite({ sat_id: 'S1', norad_cat_id: 1, name: 'Quiet' }),
        makeSatellite({ sat_id: 'S2', norad_cat_id: 2, name: 'Busy' }),
      ])
    }
    const id = Number(new URL(url).searchParams.get('norad_cat_id'))
    const body = observations[id]
    if (body === 'fail') return new Response('boom', { status: 500 })
    return ok(body ?? [])
  }

const base = { now: () => new Date('2026-11-02T00:00:00Z'), sleep: async () => {} }

describe('syncCandidates', () => {
  it('ranks candidates by recent activity and queries each satellite once', async () => {
    const fetch = vi.fn(
      router({
        1: [],
        2: [makeObservation({ norad_cat_id: 2, start: '2026-11-01T00:00:00Z' })],
      })
    )
    const { candidates, failures } = await syncCandidates({ ...base, client: { fetch } })

    expect(candidates.map((c) => c.name)).toEqual(['Busy', 'Busy', 'Quiet'])
    expect(candidates[0]?.recentGoodCount).toBe(1)
    expect(failures).toEqual([])
    const observationCalls = fetch.mock.calls.filter(([u]) => u.includes('/observations/'))
    expect(observationCalls).toHaveLength(2)
  })

  it('pauses between satellite requests', async () => {
    const sleep = vi.fn(async () => {})
    await syncCandidates({ ...base, sleep, delayMs: 123, client: { fetch: router({}) } })
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(123)
  })

  it('retries a rate-limited request, honouring Retry-After', async () => {
    const hits = { count: 0 }
    const inner = router({ 2: [makeObservation({ norad_cat_id: 2 })] })
    const fetch: FetchFn = async (url, init) => {
      const isTwo = url.includes('norad_cat_id=2')
      if (isTwo && hits.count++ === 0) {
        return new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })
      }
      return inner(url, init)
    }
    const sleep = vi.fn(async () => {})
    const onRetry = vi.fn()

    const { candidates, failures } = await syncCandidates({
      ...base,
      sleep,
      onRetry,
      client: { fetch },
    })

    expect(failures).toEqual([])
    expect(onRetry).toHaveBeenCalledWith(2, 1, 7000)
    expect(sleep).toHaveBeenCalledWith(7000)
    expect(candidates.find((c) => c.noradId === 2)?.recentGoodCount).toBe(1)
  })

  it('reports a satellite that keeps failing instead of treating it as inactive', async () => {
    const { candidates, failures } = await syncCandidates({
      ...base,
      maxAttempts: 2,
      client: { fetch: router({ 2: 'fail' }) },
    })
    expect(failures).toEqual([2])
    expect(candidates).toHaveLength(3)
  })

  it('does not retry client errors', async () => {
    const onRetry = vi.fn()
    const inner = router({})
    const fetch: FetchFn = async (url, init) =>
      url.includes('norad_cat_id=1') ? new Response('nope', { status: 404 }) : inner(url, init)
    const { failures } = await syncCandidates({ ...base, onRetry, client: { fetch } })
    expect(failures).toEqual([1])
    expect(onRetry).not.toHaveBeenCalled()
  })
})
