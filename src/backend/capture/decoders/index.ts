import type { SignalType } from '@backend/types'
import { logger } from '../../utils/logger'
import { getAllDecoders, getDecoder, hasDecoder, registerDecoder } from './registry'
import { sstvDecoder } from './sstv-decoder'
import { telemetryDecoder } from './telemetry-decoder'
import type { DecodeOptions, DecoderResult } from './types'

registerDecoder(sstvDecoder)
registerDecoder(telemetryDecoder)

export const decodeRecording = async (
  wavPath: string,
  outputDir: string,
  signalType: SignalType = 'sstv',
  options?: DecodeOptions
): Promise<DecoderResult | null> => {
  const decoder = getDecoder(signalType)

  const decoderNotFound = !decoder
  const decoderInstalled = decoder ? await decoder.checkInstalled() : false

  decoderNotFound && logger.error(`No decoder registered for signal type: ${signalType}`)
  decoder && !decoderInstalled && logger.error(`Decoder "${decoder.name}" is not installed`)

  return decoder && decoderInstalled ? decoder.decode(wavPath, outputDir, options) : null
}

export const checkDecoderInstalled = async (signalType: SignalType): Promise<boolean> => {
  const decoder = getDecoder(signalType)
  return decoder ? decoder.checkInstalled() : Promise.resolve(false)
}

export { getAllDecoders, getDecoder, hasDecoder }
export type { Decoder, DecoderResult } from './types'
