import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), image: vi.fn() },
}))
vi.mock('../../utils/shell', () => ({ runCommand: vi.fn() }))

import { runCommand } from '../../utils/shell'
import { buildGrSatellitesArgs, telemetryDecoder } from './telemetry-decoder'

const satellite = {
  name: 'FUNCUBE-1',
  noradId: 39444,
  signalConfig: {
    type: 'telemetry' as const,
    bandwidth: 30000,
    sampleRate: 250000,
    demodulation: 'baseband' as const,
  },
}

const ok = { stdout: 'telemetry text', stderr: '', exitCode: 0 }

/** Make the mocked gr_satellites write a KISS file, as the real tool would. */
const respondWithKiss = (kiss: number[], result = ok) =>
  vi.mocked(runCommand).mockImplementation(async (_cmd, args) => {
    writeFileSync(args[args.indexOf('--kiss_out') + 1] as string, Uint8Array.from(kiss))
    return result
  })

describe('buildGrSatellitesArgs', () => {
  const base = {
    satellite: '39444',
    wavPath: '/r/a.wav',
    kissPath: '/o/a.kiss',
    sampleRate: 250000,
    iq: true,
  }

  it('builds IQ arguments', () => {
    expect(buildGrSatellitesArgs(base)).toEqual([
      '39444',
      '--wavfile',
      '/r/a.wav',
      '--samp_rate',
      '250000',
      '--iq',
      '--kiss_out',
      '/o/a.kiss',
    ])
  })

  it('omits --iq for audio and adds a transmitter when given', () => {
    const args = buildGrSatellitesArgs({ ...base, iq: false, transmitter: '1k2 BPSK downlink' })
    expect(args).not.toContain('--iq')
    expect(args).toContain('--transmitter')
    expect(args[args.indexOf('--transmitter') + 1]).toBe('1k2 BPSK downlink')
  })
})

describe('telemetryDecoder', () => {
  let dir: string
  let wav: string

  beforeEach(() => {
    vi.mocked(runCommand).mockReset()
    dir = mkdtempSync(join(tmpdir(), 'tlm-'))
    wav = join(dir, 'pass.wav')
    writeFileSync(wav, 'RIFF')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is registered for the telemetry signal type', () => {
    expect(telemetryDecoder.signalType).toBe('telemetry')
  })

  it('writes frames, KISS and text output for a successful decode', async () => {
    respondWithKiss([0xc0, 0x09, 0xaa, 0xc0, 0xc0, 0x00, 0x01, 0x02, 0xc0, 0xc0, 0x00, 0x03, 0xc0])

    const result = await telemetryDecoder.decode(wav, dir, { satellite })

    expect(result?.metadata).toMatchObject({ satellite: 39444, frameCount: 2, sampleRate: 250000 })
    expect(result?.outputPaths).toHaveLength(3)
    const json = JSON.parse(readFileSync(join(dir, 'pass-frames.json'), 'utf8'))
    expect(json.frames).toEqual([
      { index: 0, length: 2, hex: '0102' },
      { index: 1, length: 1, hex: '03' },
    ])
    expect(readFileSync(join(dir, 'pass-telemetry.txt'), 'utf8')).toBe('telemetry text')
    expect(vi.mocked(runCommand).mock.calls[0]?.[0]).toBe('gr_satellites')
  })

  it('reports success with no output when no frames were decoded', async () => {
    respondWithKiss([])
    const result = await telemetryDecoder.decode(wav, dir, { satellite })
    expect(result).toEqual({
      outputPaths: [],
      metadata: { satellite: 39444, frameCount: 0, sampleRate: 250000 },
    })
  })

  it('prefers an explicit satellite reference and non-IQ input', async () => {
    respondWithKiss([])
    await telemetryDecoder.decode(wav, dir, { satelliteRef: '/x/test.yml', iq: false })
    const args = vi.mocked(runCommand).mock.calls[0]?.[1] ?? []
    expect(args[0]).toBe('/x/test.yml')
    expect(args).not.toContain('--iq')
    expect(args[args.indexOf('--samp_rate') + 1]).toBe('250000')
  })

  it('fails without a satellite', async () => {
    expect(await telemetryDecoder.decode(wav, dir)).toBeNull()
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('fails when the recording does not exist', async () => {
    expect(await telemetryDecoder.decode(join(dir, 'missing.wav'), dir, { satellite })).toBeNull()
  })

  it('fails when gr_satellites exits non-zero', async () => {
    respondWithKiss([], { stdout: '', stderr: 'boom', exitCode: 1 })
    expect(await telemetryDecoder.decode(wav, dir, { satellite })).toBeNull()
  })

  it('fails gracefully when the command cannot be run', async () => {
    vi.mocked(runCommand).mockRejectedValue(new Error('spawn gr_satellites ENOENT'))
    expect(await telemetryDecoder.decode(wav, dir, { satellite })).toBeNull()
  })

  it('checks installation via the exit code', async () => {
    vi.mocked(runCommand).mockResolvedValue(ok)
    expect(await telemetryDecoder.checkInstalled()).toBe(true)
    vi.mocked(runCommand).mockResolvedValue({ ...ok, exitCode: 127 })
    expect(await telemetryDecoder.checkInstalled()).toBe(false)
    vi.mocked(runCommand).mockRejectedValue(new Error('ENOENT'))
    expect(await telemetryDecoder.checkInstalled()).toBe(false)
  })
})
