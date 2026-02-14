import { z } from 'zod/v4'

/**
 * Serialized embeddings file schema for git-managed vector embeddings.
 *
 * Vectors are stored as base64-encoded Float16Arrays to balance
 * file size (~2.7KB per 1024-dim vector) with precision (>99.9% cosine similarity vs float32).
 */

export const EmbeddingConfigSchema = z.object({
  /** Embedding provider (e.g., "voyage-ai", "openai") */
  provider: z.string(),
  /** Model name (e.g., "voyage-code-3") */
  model: z.string(),
  /** Vector dimension (e.g., 1024) */
  dimension: z.number().int().positive(),
  /** Embedding space identifier for compatibility verification */
  space: z.string().optional(),
  /** Text template used to generate embedding input (for reproducibility) */
  textTemplate: z.string(),
})

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>

export const EmbeddingEntrySchema = z.object({
  /** Node ID */
  id: z.string(),
  /** Base64-encoded Float16Array */
  vector: z.string(),
})

export type EmbeddingEntry = z.infer<typeof EmbeddingEntrySchema>

export const SerializedEmbeddingsSchema = z.object({
  version: z.literal('1.0.0'),
  config: EmbeddingConfigSchema,
  /** HEAD SHA at generation time */
  commit: z.string(),
  embeddings: z.array(EmbeddingEntrySchema),
})

export type SerializedEmbeddings = z.infer<typeof SerializedEmbeddingsSchema>

// ==================== Float16 Codec ====================

/**
 * Encode a float32 value to a float16 (IEEE 754 half-precision) uint16.
 *
 * Handles special cases: NaN, Infinity, subnormals, and rounding.
 */
function float32ToFloat16Bits(value: number): number {
  // Use DataView to get IEEE 754 float32 bits
  const buf = new ArrayBuffer(4)
  const view = new DataView(buf)
  view.setFloat32(0, value, false) // big-endian
  const f32 = view.getUint32(0, false)

  const sign = (f32 >>> 31) & 0x1
  const exp = (f32 >>> 23) & 0xFF
  const frac = f32 & 0x7FFFFF

  // Special cases
  if (exp === 0xFF) {
    // Infinity or NaN
    if (frac === 0) {
      return (sign << 15) | 0x7C00 // Infinity
    }
    return (sign << 15) | 0x7C00 | (frac >>> 13) | 1 // NaN (ensure non-zero mantissa)
  }

  // Rebias exponent: float32 bias=127, float16 bias=15
  let newExp = exp - 127 + 15
  let newFrac = frac

  if (newExp >= 0x1F) {
    // Overflow → Infinity
    return (sign << 15) | 0x7C00
  }

  if (newExp <= 0) {
    // Subnormal or underflow
    if (newExp < -10) {
      // Too small → zero
      return sign << 15
    }
    // Subnormal: shift mantissa with implicit leading 1
    newFrac = (frac | 0x800000) >>> (1 - newExp)
    // Round to nearest even
    if ((newFrac & 0x1FFF) > 0x1000 || ((newFrac & 0x1FFF) === 0x1000 && (newFrac & 0x2000))) {
      newFrac += 0x2000
    }
    return (sign << 15) | ((newFrac >>> 13) & 0x3FF)
  }

  // Round to nearest even
  if ((newFrac & 0x1FFF) > 0x1000 || ((newFrac & 0x1FFF) === 0x1000 && (newFrac & 0x2000))) {
    newFrac += 0x2000
    if (newFrac & 0x800000) {
      newFrac = 0
      newExp++
      if (newExp >= 0x1F) {
        return (sign << 15) | 0x7C00
      }
    }
  }

  return (sign << 15) | (newExp << 10) | (newFrac >>> 13)
}

/**
 * Decode a float16 uint16 to a float32 value.
 */
function float16BitsToFloat32(h: number): number {
  const sign = (h >>> 15) & 0x1
  const exp = (h >>> 10) & 0x1F
  const frac = h & 0x3FF

  if (exp === 0x1F) {
    // Infinity or NaN
    if (frac === 0) {
      return sign ? -Infinity : Infinity
    }
    return Number.NaN
  }

  if (exp === 0) {
    if (frac === 0) {
      return sign ? -0 : 0
    }
    // Subnormal
    const val = (sign ? -1 : 1) * (frac / 1024) * (2 ** -14)
    return val
  }

  // Normal
  const val = (sign ? -1 : 1) * (1 + frac / 1024) * (2 ** (exp - 15))
  return val
}

/**
 * Convert a float32 array to a base64-encoded Float16 binary string.
 *
 * Each float32 is converted to float16 (2 bytes), then the entire
 * Uint8Array is base64-encoded.
 *
 * @param vector - Array of float32 values
 * @returns Base64-encoded string of Float16 values
 */
export function float32ToBase64Float16(vector: number[]): string {
  const uint16Array = new Uint16Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    uint16Array[i] = float32ToFloat16Bits(vector[i]!)
  }

  // Convert Uint16Array to Uint8Array (little-endian)
  const bytes = new Uint8Array(uint16Array.length * 2)
  for (let i = 0; i < uint16Array.length; i++) {
    bytes[i * 2] = uint16Array[i]! & 0xFF
    bytes[i * 2 + 1] = (uint16Array[i]! >>> 8) & 0xFF
  }

  // Base64 encode
  return Buffer.from(bytes).toString('base64')
}

/**
 * Convert a base64-encoded Float16 binary string back to a float32 array.
 *
 * @param encoded - Base64-encoded string of Float16 values
 * @param dimension - Expected vector dimension (for validation)
 * @returns Array of float32 values
 */
export function base64Float16ToFloat32(encoded: string, dimension: number): number[] {
  const bytes = Buffer.from(encoded, 'base64')

  if (bytes.length !== dimension * 2) {
    throw new Error(
      `Invalid embedding size: expected ${dimension * 2} bytes (${dimension} dimensions), got ${bytes.length} bytes`,
    )
  }

  const result: number[] = Array.from({ length: dimension })
  for (let i = 0; i < dimension; i++) {
    const lo = bytes[i * 2]!
    const hi = bytes[i * 2 + 1]!
    const uint16 = lo | (hi << 8)
    result[i] = float16BitsToFloat32(uint16)
  }

  return result
}

// ==================== Serialization Helpers ====================

/**
 * Parse a JSON string into a validated SerializedEmbeddings object.
 */
export function parseEmbeddings(json: string): SerializedEmbeddings {
  return SerializedEmbeddingsSchema.parse(JSON.parse(json))
}

/**
 * Serialize a SerializedEmbeddings object to a JSON string.
 */
export function serializeEmbeddings(data: SerializedEmbeddings): string {
  return JSON.stringify(data, null, 2)
}

/**
 * Decode all embeddings from serialized format to float32 vectors.
 *
 * @returns Map of node ID → float32 vector
 */
export function decodeAllEmbeddings(data: SerializedEmbeddings): Map<string, number[]> {
  const result = new Map<string, number[]>()
  const dim = data.config.dimension
  for (const entry of data.embeddings) {
    result.set(entry.id, base64Float16ToFloat32(entry.vector, dim))
  }
  return result
}
