import { TEST_SATELLITE } from '@/test-fixtures'
import { rankPasses, scorePass, selectPasses } from '@backend/prediction/ranking'
import type { SatelliteInfo, SatellitePass } from '@backend/types'
import { describe, expect, it } from 'vitest'

const T0 = Date.parse('2026-11-03T10:00:00Z')

const pass = (
  startMin: number,
  durationMin: number,
  maxElevation: number,
  satellite: SatelliteInfo = TEST_SATELLITE
): SatellitePass => ({
  satellite,
  aos: new Date(T0 + startMin * 60_000),
  los: new Date(T0 + (startMin + durationMin) * 60_000),
  maxElevation,
  maxElevationTime: new Date(T0 + (startMin + durationMin / 2) * 60_000),
  duration: durationMin * 60,
})

const named = (name: string, weight?: number): SatelliteInfo => ({
  ...TEST_SATELLITE,
  name,
  weight,
})

describe('pass ranking', () => {
  it('scores higher, longer passes above low, short ones', () => {
    expect(scorePass(pass(0, 12, 80))).toBeGreaterThan(scorePass(pass(0, 6, 25)))
  })

  it('prefers satellites that were recently heard, all else equal', () => {
    const lively = pass(0, 10, 50, named('A', 1))
    const quiet = pass(0, 10, 50, named('B', 0))
    expect(scorePass(lively)).toBeGreaterThan(scorePass(quiet))
  })

  it('treats a target with no activity data as mid-weight', () => {
    const unknown = scorePass(pass(0, 10, 50))
    expect(unknown).toBeGreaterThan(scorePass(pass(0, 10, 50, named('B', 0))))
    expect(unknown).toBeLessThan(scorePass(pass(0, 10, 50, named('A', 1))))
  })

  it('ranks best first', () => {
    const ranked = rankPasses([pass(0, 6, 25), pass(30, 12, 80)])
    expect(ranked[0]?.pass.maxElevation).toBe(80)
  })

  describe('selectPasses', () => {
    it('drops the weaker of two overlapping passes', () => {
      const weak = pass(0, 10, 30, named('Weak', 0.2))
      const strong = pass(5, 10, 70, named('Strong', 0.9))
      expect(selectPasses([weak, strong]).map((p) => p.satellite.name)).toEqual(['Strong'])
    })

    it('treats the capture buffer as part of the window', () => {
      const first = pass(0, 10, 70)
      const touching = pass(10.5, 10, 40) // 30 s gap, buffer is 60 s each side
      expect(selectPasses([first, touching])).toHaveLength(1)
      expect(selectPasses([first, touching], 0)).toHaveLength(2)
    })

    it('keeps non-overlapping passes in time order', () => {
      const late = pass(60, 10, 80)
      const early = pass(0, 10, 30)
      expect(selectPasses([late, early]).map((p) => p.aos.getTime())).toEqual([
        early.aos.getTime(),
        late.aos.getTime(),
      ])
    })

    it('returns nothing for no passes', () => {
      expect(selectPasses([])).toEqual([])
    })
  })
})
