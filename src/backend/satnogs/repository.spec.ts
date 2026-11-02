import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RankedCandidate } from './candidates'
import {
  initCandidateSchema,
  listCandidates,
  replaceCandidates,
  setCandidateEnabled,
} from './repository'

const candidate = (over: Partial<RankedCandidate> = {}): RankedCandidate => ({
  transmitterId: 'TX-1',
  noradId: 39444,
  name: 'FUNcube-1',
  downlinkHz: 145_935_000,
  mode: 'BPSK',
  baud: 1200,
  description: 'telemetry',
  decoders: ['funcube'],
  launched: '2013-11-21T00:00:00Z',
  lastGoodAt: '2026-11-01T00:00:00.000Z',
  recentGoodCount: 5,
  ...over,
})

const t1 = new Date('2026-11-02T00:00:00Z')
const t2 = new Date('2026-11-03T00:00:00Z')

describe('candidate repository', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initCandidateSchema(db)
  })

  it('stores and lists candidates with decoded fields', () => {
    replaceCandidates(db, [candidate()], t1)
    const [row] = listCandidates(db)
    expect(row).toMatchObject({
      transmitterId: 'TX-1',
      decoders: ['funcube'],
      enabled: true,
      syncedAt: t1.toISOString(),
    })
  })

  it('starts quiet satellites disabled and active ones enabled', () => {
    replaceCandidates(
      db,
      [candidate(), candidate({ transmitterId: 'TX-2', recentGoodCount: 0, lastGoodAt: null })],
      t1
    )
    const byId = new Map(listCandidates(db).map((c) => [c.transmitterId, c.enabled]))
    expect(byId.get('TX-1')).toBe(true)
    expect(byId.get('TX-2')).toBe(false)
  })

  it('keeps the user enabled flag across syncs but refreshes the data', () => {
    replaceCandidates(db, [candidate()], t1)
    expect(setCandidateEnabled(db, 'TX-1', false)).toBe(true)
    replaceCandidates(db, [candidate({ recentGoodCount: 9 })], t2)
    expect(listCandidates(db)[0]).toMatchObject({ enabled: false, recentGoodCount: 9 })
  })

  it('removes candidates that disappeared from the latest sync', () => {
    replaceCandidates(db, [candidate(), candidate({ transmitterId: 'TX-2' })], t1)
    replaceCandidates(db, [candidate()], t2)
    expect(listCandidates(db).map((c) => c.transmitterId)).toEqual(['TX-1'])
  })

  it('filters to enabled candidates and orders by activity', () => {
    replaceCandidates(
      db,
      [
        candidate({ transmitterId: 'LOW', name: 'Low', recentGoodCount: 1 }),
        candidate({ transmitterId: 'HIGH', name: 'High', recentGoodCount: 9 }),
      ],
      t1
    )
    setCandidateEnabled(db, 'LOW', false)
    expect(listCandidates(db).map((c) => c.transmitterId)).toEqual(['HIGH', 'LOW'])
    expect(listCandidates(db, { enabledOnly: true }).map((c) => c.transmitterId)).toEqual(['HIGH'])
  })

  it('reports false when enabling an unknown candidate', () => {
    expect(setCandidateEnabled(db, 'missing', true)).toBe(false)
  })
})
