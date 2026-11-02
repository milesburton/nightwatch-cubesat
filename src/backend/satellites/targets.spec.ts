import { TEST_ISS } from '@/test-fixtures'
import {
  buildTargets,
  candidateToSatellite,
  candidateWeight,
  parseSupportedNorads,
  uniqueByNorad,
} from '@backend/satellites/targets'
import type { StoredCandidate } from '@backend/satnogs/repository'
import { describe, expect, it } from 'vitest'

const candidate = (over: Partial<StoredCandidate> = {}): StoredCandidate => ({
  transmitterId: 'TX-1',
  noradId: 39444,
  name: 'FUNcube-1',
  downlinkHz: 145_935_000,
  mode: 'BPSK',
  baud: 1200,
  description: null,
  decoders: ['funcube'],
  launched: null,
  lastGoodAt: null,
  recentGoodCount: 5,
  enabled: true,
  syncedAt: '2026-11-02T00:00:00.000Z',
  ...over,
})

describe('satellite targets', () => {
  it('weights activity up to a ceiling of 1', () => {
    expect([
      candidateWeight(0),
      candidateWeight(5),
      candidateWeight(10),
      candidateWeight(99),
    ]).toEqual([0, 0.5, 1, 1])
  })

  it('turns a candidate into a telemetry target at its downlink', () => {
    expect(candidateToSatellite(candidate())).toMatchObject({
      name: 'FUNcube-1',
      noradId: 39444,
      frequency: 145_935_000,
      signalType: 'telemetry',
      signalConfig: { sampleRate: 250_000 },
      enabled: true,
      transmitterId: 'TX-1',
      weight: 0.5,
    })
  })

  it('parses NORAD ids from the gr_satellites listing', () => {
    const listing = `Satellites supported by gr_satellites v5.5.0:
* 1KUNS-PF (NORAD 43466)
    1k2 FSK downlink 437.300 MHz FSK AX100 ASM+Golay
* FUNcube-1 (NORAD 39444)`
    expect(parseSupportedNorads(listing)).toEqual(new Set([43466, 39444]))
  })

  describe('buildTargets', () => {
    const iss = [TEST_ISS]

    it('keeps built-in targets and appends enabled, decodable candidates', () => {
      const targets = buildTargets(
        [
          candidate(),
          candidate({ transmitterId: 'TX-2', noradId: 1, name: 'Unsupported' }),
          candidate({ transmitterId: 'TX-3', noradId: 39444, enabled: false }),
        ],
        new Set([39444]),
        iss
      )
      expect(targets.map((t) => t.transmitterId ?? t.name)).toEqual(['ISS', 'TX-1'])
    })

    it('does not filter by decoder support when the listing is unavailable', () => {
      const targets = buildTargets([candidate({ noradId: 1 })], null, iss)
      expect(targets).toHaveLength(2)
    })
  })

  it('dedupes by NORAD id for TLE fetching', () => {
    const a = candidateToSatellite(candidate())
    const b = candidateToSatellite(candidate({ transmitterId: 'TX-2', downlinkHz: 145_960_000 }))
    expect(uniqueByNorad([a, b])).toHaveLength(1)
  })
})
