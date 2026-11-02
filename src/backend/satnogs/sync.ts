import {
  type Activity,
  type RankedCandidate,
  rankCandidates,
  selectCandidates,
  summariseActivity,
  withActivity,
} from './candidates'
import {
  type SatnogsClientConfig,
  SatnogsHttpError,
  fetchGoodObservations,
  fetchSatellites,
  fetchTransmitters,
} from './client'

export interface SyncOptions {
  readonly client: SatnogsClientConfig
  readonly now: () => Date
  readonly sleep: (ms: number) => Promise<void>
  /** Pause between per-satellite requests, to stay polite to SatNOGS. */
  readonly delayMs?: number
  /** Attempts per satellite when rate limited or the server errors. */
  readonly maxAttempts?: number
  readonly onRetry?: (noradId: number, attempt: number, waitMs: number) => void
}

export interface SyncResult {
  readonly candidates: readonly RankedCandidate[]
  /** NORAD ids whose activity could not be determined. Never treated as "no activity". */
  readonly failures: readonly number[]
}

interface Collected {
  readonly activity: ReadonlyMap<number, Activity>
  readonly failures: readonly number[]
}

const isRetryable = (error: unknown): boolean =>
  !(error instanceof SatnogsHttpError) || error.status === 429 || error.status >= 500

const backoffMs = (error: unknown, attempt: number): number =>
  error instanceof SatnogsHttpError && error.retryAfterSeconds !== null
    ? error.retryAfterSeconds * 1000
    : 2000 * 2 ** (attempt - 1)

const activityFor = async (
  options: SyncOptions,
  noradId: number,
  attempt = 1
): Promise<Activity | null> => {
  try {
    const observations = await fetchGoodObservations(options.client, noradId)
    return summariseActivity(observations, options.now())
  } catch (error) {
    if (!isRetryable(error) || attempt >= (options.maxAttempts ?? 4)) return null
    const waitMs = backoffMs(error, attempt)
    options.onRetry?.(noradId, attempt, waitMs)
    await options.sleep(waitMs)
    return activityFor(options, noradId, attempt + 1)
  }
}

/** Fetch activity one satellite at a time, as an immutable chain of promises. */
const collectActivity = (options: SyncOptions, noradIds: readonly number[]): Promise<Collected> =>
  noradIds.reduce<Promise<Collected>>(
    async (accPromise, noradId) => {
      const acc = await accPromise
      const activity = await activityFor(options, noradId)
      await options.sleep(options.delayMs ?? 1000)
      return activity === null
        ? { ...acc, failures: [...acc.failures, noradId] }
        : { ...acc, activity: new Map([...acc.activity, [noradId, activity]]) }
    },
    Promise.resolve({ activity: new Map(), failures: [] })
  )

export const syncCandidates = async (options: SyncOptions): Promise<SyncResult> => {
  const [transmitters, satellites] = await Promise.all([
    fetchTransmitters(options.client),
    fetchSatellites(options.client),
  ])
  const candidates = selectCandidates(transmitters, satellites)
  const noradIds = [...new Set(candidates.map((c) => c.noradId))]
  const { activity, failures } = await collectActivity(options, noradIds)
  return { candidates: rankCandidates(withActivity(candidates, activity)), failures }
}
