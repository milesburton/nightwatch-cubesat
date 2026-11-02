import { describe, expect, it } from 'vitest'
import {
  NO_ACTIVITY,
  type RankedCandidate,
  rankCandidates,
  selectCandidates,
  summariseActivity,
  withActivity,
} from './candidates'
import { makeObservation, makeSatellite, makeTransmitter } from './fixtures'

const now = new Date('2026-11-02T00:00:00Z')

describe('selectCandidates', () => {
  it('keeps active 2m transmitters on in-orbit satellites', () => {
    const [c] = selectCandidates([makeTransmitter()], [makeSatellite()])
    expect(c).toMatchObject({
      transmitterId: 'TX-1',
      noradId: 39444,
      name: 'FUNcube-1',
      downlinkHz: 145_935_000,
      mode: 'BPSK',
      baud: 1200,
      decoders: ['funcube'],
    })
  })

  it.each([
    ['70cm downlink', makeTransmitter({ downlink_low: 437_000_000 })],
    ['no downlink', makeTransmitter({ downlink_low: null })],
    ['dead transmitter', makeTransmitter({ alive: false })],
    ['inactive status', makeTransmitter({ status: 'invalid' })],
    ['transceiver type', makeTransmitter({ type: 'Transceiver' })],
    ['unknown satellite', makeTransmitter({ sat_id: 'OTHER' })],
  ])('drops %s', (_label, tx) => {
    expect(selectCandidates([tx], [makeSatellite()])).toEqual([])
  })

  it('drops re-entered and decayed satellites', () => {
    expect(
      selectCandidates([makeTransmitter()], [makeSatellite({ status: 're-entered' })])
    ).toEqual([])
    expect(
      selectCandidates([makeTransmitter()], [makeSatellite({ decayed: '2025-01-01T00:00:00Z' })])
    ).toEqual([])
  })

  it('treats a zero baud rate as unknown and honours a custom band', () => {
    const tx = makeTransmitter({ baud: 0, downlink_low: 435_000_000 })
    const result = selectCandidates([tx], [makeSatellite()], { lowHz: 430e6, highHz: 440e6 })
    expect(result[0]?.baud).toBeNull()
  })

  it('does not mutate its inputs', () => {
    const txs = Object.freeze([makeTransmitter()])
    const sats = Object.freeze([makeSatellite()])
    expect(() => selectCandidates(txs, sats)).not.toThrow()
  })
})

describe('summariseActivity', () => {
  it('returns no activity for no observations', () => {
    expect(summariseActivity([], now)).toEqual(NO_ACTIVITY)
  })

  it('counts good observations inside the window and finds the latest', () => {
    const result = summariseActivity(
      [
        makeObservation({ id: 1, start: '2026-11-01T00:00:00Z' }),
        makeObservation({ id: 2, start: '2026-10-20T00:00:00Z' }),
        makeObservation({ id: 3, start: '2026-08-01T00:00:00Z' }),
      ],
      now
    )
    expect(result).toEqual({ lastGoodAt: '2026-11-01T00:00:00.000Z', recentGoodCount: 2 })
  })

  it('ignores non-good observations, bad dates and future timestamps', () => {
    const result = summariseActivity(
      [
        makeObservation({ status: 'bad' }),
        makeObservation({ start: 'not-a-date' }),
        makeObservation({ start: '2027-01-01T00:00:00Z' }),
      ],
      now
    )
    expect(result.recentGoodCount).toBe(0)
  })
})

describe('withActivity and rankCandidates', () => {
  const base = selectCandidates(
    [
      makeTransmitter({ uuid: 'A', sat_id: 'S1', norad_cat_id: 1 }),
      makeTransmitter({ uuid: 'B', sat_id: 'S2', norad_cat_id: 2 }),
      makeTransmitter({ uuid: 'C', sat_id: 'S3', norad_cat_id: 3 }),
    ],
    [
      makeSatellite({ sat_id: 'S1', norad_cat_id: 1, name: 'Alpha' }),
      makeSatellite({ sat_id: 'S2', norad_cat_id: 2, name: 'Bravo' }),
      makeSatellite({ sat_id: 'S3', norad_cat_id: 3, name: 'Charlie' }),
    ]
  )

  it('attaches activity and defaults missing satellites to none', () => {
    const merged = withActivity(
      base,
      new Map([[2, { lastGoodAt: '2026-11-01T00:00:00.000Z', recentGoodCount: 5 }]])
    )
    expect(merged.find((c) => c.noradId === 2)?.recentGoodCount).toBe(5)
    expect(merged.find((c) => c.noradId === 1)).toMatchObject(NO_ACTIVITY)
  })

  it('ranks by recent count, then recency, without mutating the input', () => {
    const merged: readonly RankedCandidate[] = withActivity(
      base,
      new Map([
        [1, { lastGoodAt: '2026-10-01T00:00:00.000Z', recentGoodCount: 3 }],
        [2, { lastGoodAt: '2026-11-01T00:00:00.000Z', recentGoodCount: 3 }],
        [3, { lastGoodAt: '2026-11-02T00:00:00.000Z', recentGoodCount: 9 }],
      ])
    )
    const frozen = Object.freeze([...merged])
    expect(rankCandidates(frozen).map((c) => c.name)).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect(frozen.map((c) => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})
