import type { Observation, Satellite, Transmitter } from './schemas'

export interface Band {
  readonly lowHz: number
  readonly highHz: number
}

export const TWO_METRE_BAND: Band = { lowHz: 144e6, highHz: 146e6 }

export interface Candidate {
  readonly transmitterId: string
  readonly noradId: number
  readonly name: string
  readonly downlinkHz: number
  readonly mode: string | null
  readonly baud: number | null
  readonly description: string | null
  readonly decoders: readonly string[]
  readonly launched: string | null
}

export interface Activity {
  readonly lastGoodAt: string | null
  /** Good observations inside the window, counted from the sampled page only. */
  readonly recentGoodCount: number
}

export type RankedCandidate = Candidate & Activity

export const NO_ACTIVITY: Activity = { lastGoodAt: null, recentGoodCount: 0 }

const DAY_MS = 86_400_000

const inBand = (band: Band) => (hz: number | null | undefined) =>
  hz != null && hz >= band.lowHz && hz <= band.highHz

/**
 * Active transmitters in the band, on satellites that are still in orbit.
 * SatNOGS "alive" flags are optimistic, so this is only the first filter;
 * `summariseActivity` supplies the evidence that a satellite is really on air.
 */
export const selectCandidates = (
  transmitters: readonly Transmitter[],
  satellites: readonly Satellite[],
  band: Band = TWO_METRE_BAND
): readonly Candidate[] => {
  const bySatId = new Map(satellites.map((s) => [s.sat_id, s]))
  const isInBand = inBand(band)

  return transmitters.flatMap((t) => {
    const sat = bySatId.get(t.sat_id)
    const eligible =
      sat !== undefined &&
      sat.status === 'in orbit' &&
      !sat.decayed &&
      t.alive &&
      t.status === 'active' &&
      t.type === 'Transmitter' &&
      isInBand(t.downlink_low)

    return eligible && t.downlink_low != null
      ? [
          {
            transmitterId: t.uuid,
            noradId: sat.norad_cat_id,
            name: sat.name,
            downlinkHz: t.downlink_low,
            mode: t.mode ?? null,
            baud: t.baud || null,
            description: t.description ?? null,
            decoders: sat.telemetries.map((d) => d.decoder),
            launched: sat.launched ?? null,
          },
        ]
      : []
  })
}

/** Summarise newest-first "good" observations for one satellite. */
export const summariseActivity = (
  observations: readonly Observation[],
  now: Date,
  windowDays = 30
): Activity => {
  const cutoff = now.getTime() - windowDays * DAY_MS
  const times = observations
    .filter((o) => o.status === 'good')
    .map((o) => Date.parse(o.start))
    .filter((t) => Number.isFinite(t))

  const latest = times.reduce<number | null>((max, t) => (max === null || t > max ? t : max), null)

  return {
    lastGoodAt: latest === null ? null : new Date(latest).toISOString(),
    recentGoodCount: times.filter((t) => t > cutoff && t <= now.getTime()).length,
  }
}

export const withActivity = (
  candidates: readonly Candidate[],
  activityByNorad: ReadonlyMap<number, Activity>
): readonly RankedCandidate[] =>
  candidates.map((c) => ({ ...c, ...(activityByNorad.get(c.noradId) ?? NO_ACTIVITY) }))

/** Most recently active first, then highest count, then name for stable output. */
export const rankCandidates = (
  candidates: readonly RankedCandidate[]
): readonly RankedCandidate[] =>
  [...candidates].sort(
    (a, b) =>
      b.recentGoodCount - a.recentGoodCount ||
      (b.lastGoodAt ?? '').localeCompare(a.lastGoodAt ?? '') ||
      a.name.localeCompare(b.name) ||
      a.downlinkHz - b.downlinkHz
  )
