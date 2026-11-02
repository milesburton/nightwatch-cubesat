import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SatelliteInfo, TwoLineElement } from '@backend/types'
import { ensureDir, readTextFile, writeTextFile } from '../utils/fs'
import { logger } from '../utils/logger'
import { CELESTRAK_GP_API } from './constants'

const TLE_CACHE_DIR = join(homedir(), '.night-watch', 'tle')
const TLE_CACHE_FILE = join(TLE_CACHE_DIR, 'weather.txt')

interface TleCache {
  fetchedAt: number
  satellites: TwoLineElement[]
}

/** NORAD catalogue number from line 1 of a TLE, or null if it is malformed. */
export const tleNoradId = (tle: TwoLineElement): number | null => {
  const match = tle.line1.match(/^1\s+(\d+)/)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

/** The TLE for a satellite: NORAD id first, then name, so similar names cannot cross over. */
export const findTle = (
  tles: readonly TwoLineElement[],
  sat: Pick<SatelliteInfo, 'name' | 'noradId'>
): TwoLineElement | undefined => {
  const squash = (name: string) => name.toLowerCase().replace(/\s+/g, '')
  const satName = squash(sat.name)

  return (
    tles.find((t) => tleNoradId(t) === sat.noradId) ??
    tles.find((t) => squash(t.name) === satName) ??
    // Catalogue name variations such as FUNCUBE-1 vs FUNcube-1 (AO-73)
    tles.find((t) => {
      const tleName = squash(t.name)
      return tleName.includes(satName.slice(0, 8)) || satName.includes(tleName.slice(0, 8))
    })
  )
}

const parseTleText = (text: string, expectedName: string): TwoLineElement | null => {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())

  const [line0, line1, line2] = lines

  const isTwoLineFormat = lines.length === 2 && line0?.startsWith('1 ') && line1?.startsWith('2 ')
  const isThreeLineFormat = lines.length >= 3 && line1?.startsWith('1 ') && line2?.startsWith('2 ')

  return isTwoLineFormat && line0 && line1
    ? { name: expectedName, line1: line0, line2: line1 }
    : isThreeLineFormat && line1 && line2
      ? { name: line0 ?? expectedName, line1, line2 }
      : null
}

export async function fetchTle(satellite: SatelliteInfo): Promise<TwoLineElement | null> {
  const url = `${CELESTRAK_GP_API}?CATNR=${satellite.noradId}&FORMAT=TLE`

  try {
    const response = await fetch(url)
    const responseOk = response.ok

    !responseOk && logger.error(`Failed to fetch TLE for ${satellite.name}: ${response.statusText}`)

    const text = responseOk ? await response.text() : ''

    return responseOk ? parseTleText(text, satellite.name) : null
  } catch (error) {
    logger.error(`Error fetching TLE for ${satellite.name}:`, error)
    return null
  }
}

export async function fetchAllTles(satellites: SatelliteInfo[]): Promise<TwoLineElement[]> {
  const results = await Promise.all(satellites.map(fetchTle))
  return results.filter((tle): tle is TwoLineElement => tle !== null)
}

export async function loadCachedTles(maxAgeHours: number): Promise<TwoLineElement[] | null> {
  try {
    const cacheJson = await readTextFile(join(TLE_CACHE_DIR, 'cache.json'))
    const cache: TleCache = JSON.parse(cacheJson)
    const ageHours = (Date.now() - cache.fetchedAt) / (1000 * 60 * 60)
    const isExpired = ageHours > maxAgeHours

    isExpired
      ? logger.debug(`TLE cache expired (${ageHours.toFixed(1)} hours old)`)
      : logger.debug(`Using cached TLEs (${ageHours.toFixed(1)} hours old)`)

    return isExpired ? null : cache.satellites
  } catch {
    return null
  }
}

export async function saveTlesToCache(tles: TwoLineElement[]): Promise<void> {
  await ensureDir(TLE_CACHE_DIR)

  const cache: TleCache = {
    fetchedAt: Date.now(),
    satellites: tles,
  }

  await writeTextFile(join(TLE_CACHE_DIR, 'cache.json'), JSON.stringify(cache, null, 2))

  const tleText = tles.map((t) => `${t.name}\n${t.line1}\n${t.line2}`).join('\n\n')
  await writeTextFile(TLE_CACHE_FILE, tleText)

  logger.info(`Saved ${tles.length} TLEs to cache`)
}

export async function getTles(
  satellites: SatelliteInfo[],
  maxAgeHours: number
): Promise<TwoLineElement[]> {
  const wanted = [...new Map(satellites.map((s) => [s.noradId, s])).values()]
  const cached = await loadCachedTles(maxAgeHours)
  const cachedIds = new Set((cached ?? []).map(tleNoradId))
  const cacheIsValid = cached !== null && wanted.every((s) => cachedIds.has(s.noradId))

  const fresh = cacheIsValid
    ? []
    : await (async () => {
        logger.info('Fetching fresh TLE data from CelesTrak...')
        return fetchAllTles(wanted)
      })()

  const hasFresh = fresh.length > 0
  hasFresh && (await saveTlesToCache(fresh))

  const result = cacheIsValid ? cached : hasFresh ? fresh : cached

  if (result === null) {
    throw new Error('Failed to obtain TLE data')
  }

  !cacheIsValid && !hasFresh && cached && logger.warn('Using stale cached TLEs as fallback')

  return result
}
