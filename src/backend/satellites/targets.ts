import type { SatelliteInfo } from '@backend/types'
import Database from 'better-sqlite3'
import { type StoredCandidate, initCandidateSchema, listCandidates } from '../satnogs/repository'
import { runCommand } from '../utils/shell'
import { SATELLITES, SIGNAL_CONFIGS } from './constants'

/** Good observations in the SatNOGS window that count as "certainly on air". */
const FULL_WEIGHT_OBSERVATIONS = 10

export const candidateWeight = (recentGoodCount: number): number =>
  Math.min(1, Math.max(0, recentGoodCount) / FULL_WEIGHT_OBSERVATIONS)

export const candidateToSatellite = (candidate: StoredCandidate): SatelliteInfo => ({
  name: candidate.name,
  noradId: candidate.noradId,
  frequency: candidate.downlinkHz,
  signalType: 'telemetry',
  signalConfig: SIGNAL_CONFIGS.telemetry,
  enabled: true,
  transmitterId: candidate.transmitterId,
  weight: candidateWeight(candidate.recentGoodCount),
})

/** NORAD ids from `gr_satellites --list_satellites` output ("* NAME (NORAD 12345)"). */
export const parseSupportedNorads = (listing: string): ReadonlySet<number> =>
  new Set([...listing.matchAll(/\(NORAD (\d+)\)/g)].map((m) => Number(m[1])))

/** Null when gr_satellites cannot be run, in which case nothing is filtered out. */
export const loadSupportedNorads = async (): Promise<ReadonlySet<number> | null> => {
  try {
    const result = await runCommand('gr_satellites', ['--list_satellites'])
    const norads = parseSupportedNorads(result.stdout)
    return result.exitCode === 0 && norads.size > 0 ? norads : null
  } catch {
    return null
  }
}

/**
 * Built-in targets plus the enabled candidates that gr-satellites can decode.
 * Several transmitters on one satellite are all kept; pass selection picks one per pass.
 */
export const buildTargets = (
  candidates: readonly StoredCandidate[],
  supported: ReadonlySet<number> | null,
  builtin: readonly SatelliteInfo[] = SATELLITES
): SatelliteInfo[] => [
  ...builtin,
  ...candidates
    .filter((c) => c.enabled && (supported === null || supported.has(c.noradId)))
    .map(candidateToSatellite),
]

export const loadTargets = async (dbPath: string): Promise<SatelliteInfo[]> => {
  const db = new Database(dbPath)
  try {
    initCandidateSchema(db)
    return buildTargets(listCandidates(db, { enabledOnly: true }), await loadSupportedNorads())
  } finally {
    db.close()
  }
}

/** Distinct satellites, for fetching one TLE per NORAD id. */
export const uniqueByNorad = (satellites: readonly SatelliteInfo[]): SatelliteInfo[] => [
  ...new Map(satellites.map((s) => [s.noradId, s])).values(),
]
