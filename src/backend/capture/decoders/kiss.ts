const FEND = 0xc0
const FESC = 0xdb
const TFEND = 0xdc
const TFESC = 0xdd

export interface KissFrame {
  /** Low nibble of the KISS type byte: 0 is a data frame; gr-satellites also emits 9 for metadata. */
  readonly command: number
  readonly port: number
  readonly data: Uint8Array
}

interface Unescaped {
  readonly bytes: readonly number[]
  readonly escaped: boolean
}

const unescapeKiss = (segment: Uint8Array): readonly number[] =>
  Array.from(segment).reduce<Unescaped>(
    (state, byte) => {
      if (state.escaped) {
        const restored = byte === TFEND ? FEND : byte === TFESC ? FESC : byte
        return { bytes: [...state.bytes, restored], escaped: false }
      }
      return byte === FESC
        ? { bytes: state.bytes, escaped: true }
        : { bytes: [...state.bytes, byte], escaped: false }
    },
    { bytes: [], escaped: false }
  ).bytes

/** Split a KISS byte stream into frames. Empty frames (back-to-back FENDs) are ignored. */
export const parseKiss = (stream: Uint8Array): readonly KissFrame[] => {
  const fendPositions = Array.from(stream).flatMap((byte, index) => (byte === FEND ? [index] : []))

  return fendPositions
    .slice(0, -1)
    .map((start, i) => unescapeKiss(stream.subarray(start + 1, fendPositions[i + 1])))
    .filter((bytes) => bytes.length > 0)
    .map(([type = 0, ...data]) => ({
      command: type & 0x0f,
      port: type >> 4,
      data: Uint8Array.from(data),
    }))
}

export const dataFrames = (frames: readonly KissFrame[]): readonly KissFrame[] =>
  frames.filter((frame) => frame.command === 0)

export const toHex = (data: Uint8Array): string => Buffer.from(data).toString('hex')
