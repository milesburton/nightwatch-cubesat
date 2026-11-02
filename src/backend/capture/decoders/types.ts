import type { SatelliteInfo, SignalType } from '@backend/types'

export interface DecoderResult {
  outputPaths: string[]
  metadata?: Record<string, unknown>
}

/** Extra context for decoders that need to know what was recorded. */
export interface DecodeOptions {
  satellite?: Pick<SatelliteInfo, 'name' | 'noradId' | 'signalConfig'>
  /** Overrides the NORAD id when naming the satellite to gr-satellites (name, id or YAML path). */
  satelliteRef?: string | number
  /** gr-satellites transmitter name, when a satellite has several downlinks. */
  transmitter?: string
  /** True (default) when the WAV is two-channel IQ, false for demodulated audio. */
  iq?: boolean
}

export interface Decoder {
  name: string
  signalType: SignalType
  decode(wavPath: string, outputDir: string, options?: DecodeOptions): Promise<DecoderResult | null>
  checkInstalled(): Promise<boolean>
}
