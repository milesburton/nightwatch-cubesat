import type { SatellitePass } from '@backend/types'
import { PASS_CONSTRAINTS } from '../satellites/constants'

/** Weights sum to 1; elevation dominates because it sets signal strength and Doppler dwell. */
const WEIGHTS = { elevation: 0.5, duration: 0.2, activity: 0.3 } as const

/** Satellites with no activity data (built-in targets) are scored as a coin toss. */
const UNKNOWN_ACTIVITY = 0.5
const FULL_DURATION_SECONDS = 900

export interface ScoredPass {
  readonly pass: SatellitePass
  readonly score: number
}

/** 0..1: higher, longer passes of satellites that were recently heard score best. */
export const scorePass = (pass: SatellitePass): number => {
  const elevation = Math.min(Math.max(pass.maxElevation, 0), 90) / 90
  const duration =
    Math.min(Math.max(pass.duration, 0), FULL_DURATION_SECONDS) / FULL_DURATION_SECONDS
  const activity = pass.satellite.weight ?? UNKNOWN_ACTIVITY

  return WEIGHTS.elevation * elevation + WEIGHTS.duration * duration + WEIGHTS.activity * activity
}

export const rankPasses = (passes: readonly SatellitePass[]): readonly ScoredPass[] =>
  passes
    .map((pass) => ({ pass, score: scorePass(pass) }))
    .sort((a, b) => b.score - a.score || a.pass.aos.getTime() - b.pass.aos.getTime())

const windowOf = (pass: SatellitePass, marginMs: number) => ({
  start: pass.aos.getTime() - marginMs,
  end: pass.los.getTime() + marginMs,
})

/**
 * One SDR can record one pass at a time. Take passes best-first and skip any whose
 * capture window (pass plus the pre/post buffer) overlaps one already taken.
 * The result is in time order, ready for the scheduler.
 */
export const selectPasses = (
  passes: readonly SatellitePass[],
  bufferSeconds = PASS_CONSTRAINTS.captureBufferSeconds
): SatellitePass[] => {
  const marginMs = bufferSeconds * 1000
  const taken: SatellitePass[] = []

  for (const { pass } of rankPasses(passes)) {
    const w = windowOf(pass, marginMs)
    const clashes = taken.some((t) => {
      const o = windowOf(t, marginMs)
      return w.start < o.end && o.start < w.end
    })
    !clashes && taken.push(pass)
  }

  return taken.sort((a, b) => a.aos.getTime() - b.aos.getTime())
}
