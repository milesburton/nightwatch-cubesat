import type { Observation, Satellite, Transmitter } from './schemas'

export const makeSatellite = (over: Partial<Satellite> = {}): Satellite => ({
  sat_id: 'SAT-1',
  norad_cat_id: 39444,
  name: 'FUNcube-1',
  status: 'in orbit',
  decayed: null,
  launched: '2013-11-21T00:00:00Z',
  telemetries: [{ decoder: 'funcube' }],
  ...over,
})

export const makeTransmitter = (over: Partial<Transmitter> = {}): Transmitter => ({
  uuid: 'TX-1',
  description: 'BPSK telemetry',
  alive: true,
  type: 'Transmitter',
  status: 'active',
  sat_id: 'SAT-1',
  norad_cat_id: 39444,
  downlink_low: 145_935_000,
  mode: 'BPSK',
  baud: 1200,
  ...over,
})

export const makeObservation = (over: Partial<Observation> = {}): Observation => ({
  id: 1,
  start: '2026-11-01T12:00:00Z',
  status: 'good',
  norad_cat_id: 39444,
  ...over,
})
