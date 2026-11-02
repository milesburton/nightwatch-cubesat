#!/usr/bin/env -S npx tsx
/**
 * Manage the 2m cubesat candidate list (sourced from SatNOGS).
 *
 * Usage:
 *   npx tsx src/backend/cli/commands/candidates.ts sync            # refresh from SatNOGS
 *   npx tsx src/backend/cli/commands/candidates.ts list [--all]    # show enabled (or all) candidates
 *   npx tsx src/backend/cli/commands/candidates.ts enable <id>     # enable a transmitter id
 *   npx tsx src/backend/cli/commands/candidates.ts disable <id>    # disable a transmitter id
 */

import Database from 'better-sqlite3'
import {
  initCandidateSchema,
  listCandidates,
  replaceCandidates,
  setCandidateEnabled,
} from '../../satnogs/repository'
import { syncCandidates } from '../../satnogs/sync'

const dbPath = process.env.DATABASE_PATH ?? './data/captures.db'
const token = process.env.SATNOGS_API_TOKEN

const usage = (): never => {
  console.error('Usage: candidates.ts <sync | list [--all] | enable <id> | disable <id>>')
  return process.exit(1)
}

const row = (c: ReturnType<typeof listCandidates>[number]): string =>
  [
    c.enabled ? '*' : ' ',
    String(c.noradId).padEnd(6),
    c.name.slice(0, 22).padEnd(22),
    (c.downlinkHz / 1e6).toFixed(4).padStart(9),
    `${c.mode ?? '-'}${c.baud ? ` ${c.baud}` : ''}`.slice(0, 24).padEnd(24),
    String(c.recentGoodCount).padStart(3),
    (c.lastGoodAt ?? '-').slice(0, 10),
    c.transmitterId,
  ].join(' ')

const run = async (): Promise<void> => {
  const [command, arg] = process.argv.slice(2)
  const db = new Database(dbPath)
  initCandidateSchema(db)

  switch (command) {
    case 'sync': {
      const { candidates, failures } = await syncCandidates({
        client: { fetch, token },
        now: () => new Date(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onRetry: (id, attempt, waitMs) =>
          console.warn(`Retrying ${id} (attempt ${attempt}) in ${waitMs} ms`),
      })
      if (failures.length > 0) {
        throw new Error(
          `Activity lookup failed for NORAD ${failures.join(', ')}; database left unchanged`
        )
      }
      replaceCandidates(db, candidates, new Date())
      console.log(`Synced ${candidates.length} candidate transmitters`)
      return
    }
    case 'list':
      console.log(
        'E NORAD Name                    MHz       Mode                     N30 Last       Id'
      )
      listCandidates(db, { enabledOnly: arg !== '--all' }).forEach((c) => console.log(row(c)))
      return
    case 'enable':
    case 'disable':
      if (!arg) return usage()
      console.log(
        setCandidateEnabled(db, arg, command === 'enable') ? 'Updated' : `Unknown candidate: ${arg}`
      )
      return
    default:
      return usage()
  }
}

run().catch((error) => {
  console.error(`Candidates command failed: ${error}`)
  process.exit(1)
})
