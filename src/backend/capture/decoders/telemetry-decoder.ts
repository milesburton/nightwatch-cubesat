import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ensureDir, fileExists } from '../../utils/fs'
import { logger } from '../../utils/logger'
import { runCommand } from '../../utils/shell'
import { dataFrames, parseKiss, toHex } from './kiss'
import type { DecodeOptions, Decoder, DecoderResult } from './types'

const DEFAULT_SAMPLE_RATE = 250_000
const DECODE_TIMEOUT_MS = 600_000

export interface GrSatellitesArgs {
  readonly satellite: string
  readonly wavPath: string
  readonly kissPath: string
  readonly sampleRate: number
  readonly iq: boolean
  readonly transmitter?: string
}

export const buildGrSatellitesArgs = (args: GrSatellitesArgs): readonly string[] => [
  args.satellite,
  '--wavfile',
  args.wavPath,
  '--samp_rate',
  String(args.sampleRate),
  ...(args.iq ? ['--iq'] : []),
  ...(args.transmitter ? ['--transmitter', args.transmitter] : []),
  '--kiss_out',
  args.kissPath,
]

const decodeFile = async (
  wavPath: string,
  outputDir: string,
  options: DecodeOptions
): Promise<DecoderResult | null> => {
  const satellite = options.satelliteRef ?? options.satellite?.noradId
  if (satellite === undefined || satellite === 0) {
    logger.error('Telemetry decode needs a satellite (NORAD id or gr-satellites reference)')
    return null
  }

  const baseName = basename(wavPath, '.wav')
  const kissPath = join(outputDir, `${baseName}.kiss`)
  const textPath = join(outputDir, `${baseName}-telemetry.txt`)
  const framesPath = join(outputDir, `${baseName}-frames.json`)
  const sampleRate = options.satellite?.signalConfig?.sampleRate ?? DEFAULT_SAMPLE_RATE

  logger.image(`Decoding telemetry for ${satellite} from ${wavPath}...`)

  const result = await runCommand(
    'gr_satellites',
    [
      ...buildGrSatellitesArgs({
        satellite: String(satellite),
        wavPath,
        kissPath,
        sampleRate,
        iq: options.iq ?? true,
        transmitter: options.transmitter,
      }),
    ],
    { timeout: DECODE_TIMEOUT_MS }
  )

  if (result.exitCode !== 0) {
    logger.error(`gr_satellites failed (${result.exitCode}): ${result.stderr.slice(-500)}`)
    return null
  }

  const frames = dataFrames(parseKiss(await readFile(kissPath)))
  if (frames.length === 0) {
    logger.warn('Telemetry decode finished but no frames were found')
    return { outputPaths: [], metadata: { satellite, frameCount: 0, sampleRate } }
  }

  await writeFile(textPath, result.stdout)
  await writeFile(
    framesPath,
    JSON.stringify(
      {
        satellite,
        sampleRate,
        frames: frames.map((frame, index) => ({
          index,
          length: frame.data.length,
          hex: toHex(frame.data),
        })),
      },
      null,
      2
    )
  )

  logger.image(`Telemetry decode successful: ${frames.length} frames`)
  return {
    outputPaths: [framesPath, kissPath, textPath],
    metadata: { satellite, frameCount: frames.length, sampleRate },
  }
}

export const telemetryDecoder: Decoder = {
  name: 'Telemetry Decoder (gr-satellites)',
  signalType: 'telemetry',

  async decode(
    wavPath: string,
    outputDir: string,
    options: DecodeOptions = {}
  ): Promise<DecoderResult | null> {
    if (!(await fileExists(wavPath))) {
      logger.error(`Recording file not found: ${wavPath}`)
      return null
    }

    await ensureDir(outputDir)

    try {
      return await decodeFile(wavPath, outputDir, options)
    } catch (err) {
      logger.error(`Telemetry decode failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  },

  async checkInstalled(): Promise<boolean> {
    try {
      return (await runCommand('gr_satellites', ['--version'])).exitCode === 0
    } catch {
      return false
    }
  },
}
