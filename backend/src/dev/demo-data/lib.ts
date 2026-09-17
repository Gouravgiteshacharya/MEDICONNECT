import { createHash } from 'node:crypto'

export const DEFAULT_DEMO_SEED = 20260918

export function deterministicUuid(namespace: string, key: string) {
  const bytes = createHash('sha256').update(`mediconnect:${namespace}:${key}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createPrng(seed: number) {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function seedFromString(value: string) {
  return createHash('sha256').update(value).digest().readUInt32LE(0)
}

export function allocateWeighted(total: number, weights: number[], minimum = 0) {
  if (total < weights.length * minimum) throw new Error('Allocation total is below its minimum')
  const remaining = total - weights.length * minimum
  const sum = weights.reduce((a, b) => a + b, 0)
  const exact = weights.map((weight) => (remaining * weight) / sum)
  const result = exact.map((value) => minimum + Math.floor(value))
  let left = total - result.reduce((a, b) => a + b, 0)
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < left; i++) result[order[i].index]++
  return result
}

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
