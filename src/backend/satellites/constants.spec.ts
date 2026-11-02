import {
  CELESTRAK_GP_API,
  PASS_CONSTRAINTS,
  SATELLITES,
  SIGNAL_CONFIGS,
} from '@backend/satellites/constants'
import type { SatelliteInfo } from '@backend/types'
import { describe, expect, it } from 'vitest'

describe('satellite constants', () => {
  it('should define only the ISS as a built-in satellite', () => {
    expect(SATELLITES.map((s: SatelliteInfo) => s.name)).toEqual(['ISS'])
  })

  it('should have the correct ISS frequency and NORAD ID', () => {
    const iss = SATELLITES.find((s: SatelliteInfo) => s.name === 'ISS')

    expect(iss?.frequency).toBe(145.8e6)
    expect(iss?.noradId).toBe(25544)
  })

  it('should configure telemetry as 250 kS/s baseband IQ', () => {
    expect(SIGNAL_CONFIGS.telemetry).toMatchObject({
      type: 'telemetry',
      sampleRate: 250000,
      demodulation: 'baseband',
    })
  })

  it('should have valid CelesTrak API URL', () => {
    expect(CELESTRAK_GP_API).toMatch(/^https:\/\/celestrak\.org/)
  })

  it('should have sensible pass constraints', () => {
    expect(PASS_CONSTRAINTS.minDurationSeconds).toBeLessThan(PASS_CONSTRAINTS.maxDurationSeconds)
    expect(PASS_CONSTRAINTS.predictionHorizonHours).toBeGreaterThan(0)
  })
})
