import {
  type Observation,
  type Satellite,
  type Transmitter,
  observationSchema,
  parseItems,
  satelliteSchema,
  transmitterSchema,
} from './schemas'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface SatnogsClientConfig {
  readonly fetch: FetchFn
  /** Optional SatNOGS DB token; only needed for endpoints such as telemetry. */
  readonly token?: string
  readonly dbUrl?: string
  readonly networkUrl?: string
  readonly timeoutMs?: number
}

const DB_URL = 'https://db.satnogs.org'
const NETWORK_URL = 'https://network.satnogs.org'

export class SatnogsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    /** Seconds the server asked us to wait, when it sent Retry-After. */
    readonly retryAfterSeconds: number | null
  ) {
    super(`SatNOGS request failed: ${status} ${url}`)
  }
}

const getJson = async (config: SatnogsClientConfig, url: string): Promise<unknown> => {
  const response = await config.fetch(url, {
    headers: config.token ? { Authorization: `Token ${config.token}` } : {},
    signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
  })
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new SatnogsHttpError(
      response.status,
      url,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null
    )
  }
  return response.json()
}

export const fetchTransmitters = async (
  config: SatnogsClientConfig
): Promise<readonly Transmitter[]> =>
  parseItems(
    transmitterSchema,
    await getJson(config, `${config.dbUrl ?? DB_URL}/api/transmitters/?format=json`)
  )

export const fetchSatellites = async (config: SatnogsClientConfig): Promise<readonly Satellite[]> =>
  parseItems(
    satelliteSchema,
    await getJson(config, `${config.dbUrl ?? DB_URL}/api/satellites/?format=json`)
  )

/** Newest-first page of "good" observations for one satellite. */
export const fetchGoodObservations = async (
  config: SatnogsClientConfig,
  noradId: number
): Promise<readonly Observation[]> =>
  parseItems(
    observationSchema,
    await getJson(
      config,
      `${config.networkUrl ?? NETWORK_URL}/api/observations/?norad_cat_id=${noradId}&status=good&format=json`
    )
  )
