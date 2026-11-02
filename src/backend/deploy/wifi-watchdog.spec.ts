import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../../../deploy/pi/wifi-watchdog.sh')

interface Harness {
  readonly run: (times?: number, env?: Record<string, string>) => void
  readonly actions: () => readonly string[]
  readonly setNetwork: (up: boolean) => void
  readonly state: (name: string) => string
  readonly seedState: (name: string, value: string) => void
}

const stub = (path: string, body: string): void => {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(path, 0o755)
}

const makeHarness = (dir: string): Harness => {
  const log = join(dir, 'actions.log')
  const stateDir = join(dir, 'state')
  const up = join(dir, 'network-up')
  const record = (name: string) => `echo ${name} >> ${log}`

  stub(join(dir, 'ping'), `[ -f ${up} ]`)
  const base = {
    WD_STATE_DIR: stateDir,
    WD_CMD_GATEWAY: 'echo 192.0.2.1',
    WD_CMD_PING: join(dir, 'ping'),
    WD_CMD_RECONNECT: record('reconnect'),
    WD_CMD_RESTART_NM: record('restart-nm'),
    WD_CMD_RELOAD_DRIVER: record('reload-driver'),
    WD_CMD_REBOOT: record('reboot'),
    WD_CMD_DPKG_BUSY: 'false',
    WD_NOW: '100000',
  }

  return {
    run: (times = 1, env = {}) => {
      for (let i = 0; i < times; i++) {
        const result = spawnSync('bash', [SCRIPT], {
          env: { PATH: process.env.PATH ?? '', ...base, ...env },
          encoding: 'utf8',
        })
        expect(result.status, result.stderr).toBe(0)
      }
    },
    actions: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
    setNetwork: (isUp) => (isUp ? writeFileSync(up, '') : rmSync(up, { force: true })),
    state: (name) => readFileSync(join(stateDir, name), 'utf8').trim(),
    seedState: (name, value) => {
      spawnSync('mkdir', ['-p', stateDir])
      writeFileSync(join(stateDir, name), `${value}\n`)
    },
  }
}

describe('wifi-watchdog.sh', () => {
  let dir: string
  let h: Harness

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wd-'))
    h = makeHarness(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('does nothing while the gateway answers', () => {
    h.setNetwork(true)
    h.run(5)
    expect(h.actions()).toEqual([])
    expect(h.state('failures')).toBe('0')
  })

  it('does not act on brief outages', () => {
    h.run(2)
    expect(h.actions()).toEqual([])
    expect(h.state('failures')).toBe('2')
  })

  it('escalates once at each threshold', () => {
    h.run(3)
    expect(h.actions()).toEqual(['reconnect'])
    h.run(3)
    expect(h.actions()).toEqual(['reconnect', 'restart-nm'])
    h.run(6)
    expect(h.actions()).toEqual(['reconnect', 'restart-nm', 'reload-driver'])
    h.run(17)
    expect(h.actions()).not.toContain('reboot')
    h.run(1)
    expect(h.actions()).toEqual(['reconnect', 'restart-nm', 'reload-driver', 'reboot'])
  })

  it('resets the outage counter when the network returns', () => {
    h.run(4)
    h.setNetwork(true)
    h.run(1)
    expect(h.state('failures')).toBe('0')
    h.setNetwork(false)
    h.run(2)
    expect(h.actions()).toEqual(['reconnect'])
  })

  it('treats a missing default route as an outage', () => {
    h.run(3, { WD_CMD_GATEWAY: 'true' })
    expect(h.actions()).toEqual(['reconnect'])
  })

  it('defers the reboot while the package manager is running', () => {
    h.run(40, { WD_CMD_DPKG_BUSY: 'true' })
    expect(h.actions()).not.toContain('reboot')
    h.run(1, { WD_CMD_DPKG_BUSY: 'false' })
    expect(h.actions()).toContain('reboot')
  })

  it('does not reboot again within the minimum interval', () => {
    h.seedState('failures', '29')
    h.seedState('last_reboot', '99000')
    h.run(1, { WD_NOW: '100000' })
    expect(h.actions()).not.toContain('reboot')
    h.run(1, { WD_NOW: '104000' })
    expect(h.actions()).toContain('reboot')
  })

  it('stops rebooting after repeated reboots without recovery', () => {
    h.seedState('failures', '29')
    h.seedState('reboot_streak', '3')
    h.run(1)
    expect(h.actions()).not.toContain('reboot')
  })

  it('records the reboot and clears the streak after recovery', () => {
    h.seedState('failures', '29')
    h.run(1)
    expect(h.state('reboot_streak')).toBe('1')
    expect(h.state('last_reboot')).toBe('100000')
    h.setNetwork(true)
    h.run(1)
    expect(h.state('reboot_streak')).toBe('0')
  })
})
