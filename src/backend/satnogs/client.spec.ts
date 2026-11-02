import { describe, expect, it, vi } from 'vitest'
import { type FetchFn, fetchGoodObservations, fetchSatellites, fetchTransmitters } from './client'
import { makeObservation, makeSatellite, makeTransmitter } from './fixtures'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('satnogs client', () => {
  it('fetches and validates transmitters, dropping malformed items', async () => {
    const fetch: FetchFn = vi.fn(async () => jsonResponse([makeTransmitter(), { uuid: 'broken' }]))
    const result = await fetchTransmitters({ fetch })
    expect(result).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith(
      'https://db.satnogs.org/api/transmitters/?format=json',
      expect.any(Object)
    )
  })

  it('defaults telemetries to an empty list for satellites', async () => {
    const { telemetries: _omit, ...sat } = makeSatellite()
    const result = await fetchSatellites({ fetch: async () => jsonResponse([sat]) })
    expect(result[0]?.telemetries).toEqual([])
  })

  it('requests good observations for a NORAD id from the network API', async () => {
    const fetch: FetchFn = vi.fn(async () => jsonResponse([makeObservation()]))
    const result = await fetchGoodObservations({ fetch }, 39444)
    expect(result).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'https://network.satnogs.org/api/observations/?norad_cat_id=39444&status=good&format=json'
    )
  })

  it('sends the token only when configured', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse([]))
    await fetchTransmitters({ fetch, token: 'secret' })
    await fetchTransmitters({ fetch })
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Token secret' })
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({})
  })

  it('throws on a non-OK response', async () => {
    await expect(
      fetchTransmitters({ fetch: async () => jsonResponse({ detail: 'nope' }, 401) })
    ).rejects.toThrow('401')
  })

  it('treats a non-array body as empty', async () => {
    expect(await fetchTransmitters({ fetch: async () => jsonResponse({}) })).toEqual([])
  })
})
