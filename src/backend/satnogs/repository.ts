import type Database from 'better-sqlite3'
import type { RankedCandidate } from './candidates'

export interface StoredCandidate extends RankedCandidate {
  readonly enabled: boolean
  readonly syncedAt: string
}

interface Row {
  transmitter_id: string
  norad_id: number
  name: string
  downlink_hz: number
  mode: string | null
  baud: number | null
  description: string | null
  decoders: string
  launched: string | null
  last_good_at: string | null
  recent_good_count: number
  enabled: number
  synced_at: string
}

export const initCandidateSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      transmitter_id TEXT PRIMARY KEY,
      norad_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      downlink_hz INTEGER NOT NULL,
      mode TEXT,
      baud INTEGER,
      description TEXT,
      decoders TEXT NOT NULL DEFAULT '[]',
      launched TEXT,
      last_good_at TEXT,
      recent_good_count INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_candidates_norad ON candidates(norad_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_enabled ON candidates(enabled);
  `)
}

const toStored = (row: Row): StoredCandidate => ({
  transmitterId: row.transmitter_id,
  noradId: row.norad_id,
  name: row.name,
  downlinkHz: row.downlink_hz,
  mode: row.mode,
  baud: row.baud,
  description: row.description,
  decoders: JSON.parse(row.decoders) as string[],
  launched: row.launched,
  lastGoodAt: row.last_good_at,
  recentGoodCount: row.recent_good_count,
  enabled: row.enabled === 1,
  syncedAt: row.synced_at,
})

/**
 * Replace the candidate set with the result of a sync. A candidate's `enabled`
 * flag is chosen by the user and is kept across syncs; new candidates start
 * enabled only if a signal has been seen recently. Candidates that vanished
 * from SatNOGS are removed.
 */
export const replaceCandidates = (
  db: Database.Database,
  candidates: readonly RankedCandidate[],
  syncedAt: Date
): void => {
  const stamp = syncedAt.toISOString()
  const upsert = db.prepare(`
    INSERT INTO candidates (
      transmitter_id, norad_id, name, downlink_hz, mode, baud, description, decoders,
      launched, last_good_at, recent_good_count, enabled, synced_at
    ) VALUES (
      @transmitterId, @noradId, @name, @downlinkHz, @mode, @baud, @description, @decoders,
      @launched, @lastGoodAt, @recentGoodCount, @enabled, @syncedAt
    )
    ON CONFLICT(transmitter_id) DO UPDATE SET
      norad_id = excluded.norad_id, name = excluded.name, downlink_hz = excluded.downlink_hz,
      mode = excluded.mode, baud = excluded.baud, description = excluded.description,
      decoders = excluded.decoders, launched = excluded.launched,
      last_good_at = excluded.last_good_at, recent_good_count = excluded.recent_good_count,
      synced_at = excluded.synced_at
  `)
  const removeStale = db.prepare('DELETE FROM candidates WHERE synced_at <> ?')

  db.transaction(() => {
    for (const c of candidates) {
      upsert.run({
        ...c,
        decoders: JSON.stringify(c.decoders),
        enabled: c.recentGoodCount > 0 ? 1 : 0,
        syncedAt: stamp,
      })
    }
    removeStale.run(stamp)
  })()
}

export interface ListFilter {
  readonly enabledOnly?: boolean
}

export const listCandidates = (
  db: Database.Database,
  filter: ListFilter = {}
): readonly StoredCandidate[] =>
  (
    db
      .prepare(
        `SELECT * FROM candidates ${filter.enabledOnly ? 'WHERE enabled = 1' : ''}
         ORDER BY recent_good_count DESC, last_good_at DESC, name, downlink_hz`
      )
      .all() as Row[]
  ).map(toStored)

export const setCandidateEnabled = (
  db: Database.Database,
  transmitterId: string,
  enabled: boolean
): boolean =>
  db
    .prepare('UPDATE candidates SET enabled = ? WHERE transmitter_id = ?')
    .run(enabled ? 1 : 0, transmitterId).changes > 0
