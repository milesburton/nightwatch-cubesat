import type { DemodulationType, SatelliteInfo, SignalConfig, SignalType } from '@backend/types'

export const SIGNAL_CONFIGS: Record<SignalType, SignalConfig> = {
  sstv: {
    type: 'sstv' as const,
    bandwidth: 3000,
    sampleRate: 48000,
    demodulation: 'fm' as DemodulationType,
  },
  // Raw IQ for gr-satellites; 250 kS/s covers BPSK 1k2 through GMSK 19k2 with Doppler margin
  telemetry: {
    type: 'telemetry' as const,
    bandwidth: 30000,
    sampleRate: 250000,
    demodulation: 'baseband' as DemodulationType,
  },
}

export const SATELLITES: SatelliteInfo[] = [
  {
    name: 'ISS',
    noradId: 25544,
    frequency: 145.8e6,
    signalType: 'sstv',
    signalConfig: SIGNAL_CONFIGS.sstv,
    enabled: false,
    eventBased: true,
  },
]

export const CELESTRAK_GP_API = 'https://celestrak.org/NORAD/elements/gp.php'

export const PASS_CONSTRAINTS = {
  minDurationSeconds: 240,
  maxDurationSeconds: 1200,
  predictionHorizonHours: 24,
  captureBufferSeconds: 60,
}

export const SIGNAL = {
  scanBandwidthHz: 25000,
  scanDurationSeconds: 5,
}
