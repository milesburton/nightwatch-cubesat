import { describe, expect, it } from 'vitest'
import { dataFrames, parseKiss, toHex } from './kiss'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

describe('parseKiss', () => {
  it('returns nothing for an empty or unframed stream', () => {
    expect(parseKiss(bytes())).toEqual([])
    expect(parseKiss(bytes(0x00, 0x01, 0x02))).toEqual([])
  })

  it('parses a data frame', () => {
    const [frame] = parseKiss(bytes(0xc0, 0x00, 0x01, 0x02, 0x03, 0xc0))
    expect(frame).toMatchObject({ command: 0, port: 0 })
    expect(Array.from(frame?.data ?? [])).toEqual([1, 2, 3])
  })

  it('splits the type byte into port and command', () => {
    const [frame] = parseKiss(bytes(0xc0, 0x19, 0xaa, 0xc0))
    expect(frame).toMatchObject({ command: 9, port: 1 })
  })

  it('restores escaped FEND and FESC bytes', () => {
    const [frame] = parseKiss(bytes(0xc0, 0x00, 0xdb, 0xdc, 0x55, 0xdb, 0xdd, 0xc0))
    expect(Array.from(frame?.data ?? [])).toEqual([0xc0, 0x55, 0xdb])
  })

  it('ignores empty frames between back-to-back FENDs', () => {
    const frames = parseKiss(bytes(0xc0, 0xc0, 0xc0, 0x00, 0x07, 0xc0, 0xc0))
    expect(frames).toHaveLength(1)
  })

  it('parses several frames, including a gr-satellites metadata frame', () => {
    const frames = parseKiss(
      bytes(0xc0, 0x09, 0xaa, 0xbb, 0xc0, 0xc0, 0x00, 0x01, 0xc0, 0xc0, 0x00, 0x02, 0xc0)
    )
    expect(frames.map((f) => f.command)).toEqual([9, 0, 0])
    expect(dataFrames(frames).map((f) => Array.from(f.data))).toEqual([[1], [2]])
  })

  it('does not mutate its input', () => {
    const input = bytes(0xc0, 0x00, 0xdb, 0xdc, 0xc0)
    const copy = Uint8Array.from(input)
    parseKiss(input)
    expect(input).toEqual(copy)
  })
})

describe('toHex', () => {
  it('encodes bytes as lower-case hex', () => {
    expect(toHex(bytes(0, 15, 255))).toBe('000fff')
  })
})
