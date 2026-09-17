import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildInventoryRecord, buildMedicines, buildPharmacies, CORE_COUNTS, pharmacyName, selectMedicineIndexes } from '../src/dev/demo-data/generateDemoData.js'
import { DEFAULT_DEMO_SEED } from '../src/dev/demo-data/lib.js'
import type { DemoLocation } from '../src/dev/demo-data/types.js'

const locations = JSON.parse(readFileSync(path.resolve('src/dev/demo-data/data/indiaLocations.json'), 'utf8')) as DemoLocation[]
const majorChainPattern = /\b(apollo|medplus|netmeds|pharmeasy|tata\s*1mg|wellness\s*forever|guardian)\b/i

describe('MediConnect demo data', () => {
  it('generates an exact, deterministic 20,000-item medicine catalogue', () => {
    const first = buildMedicines(DEFAULT_DEMO_SEED)
    const second = buildMedicines(DEFAULT_DEMO_SEED)
    expect(first).toHaveLength(CORE_COUNTS.medicines)
    expect(second).toEqual(first)
    expect(new Set(first.map((medicine) => medicine.id)).size).toBe(CORE_COUNTS.medicines)
  })

  it('generates diverse fictional names without major-chain branding', () => {
    const names = Array.from({ length: 5_000 }, (_, index) => pharmacyName(index, 'Keonjhar'))
    expect(new Set(names).size).toBe(5_000)
    expect(names.some((name) => majorChainPattern.test(name))).toBe(false)
  })

  it('allocates 5,000 pharmacies, 1,200 to Odisha, all districts, and exactly 10 to Keonjhar town', () => {
    const pharmacies = buildPharmacies(locations)
    const odisha = pharmacies.filter((pharmacy) => pharmacy.state === 'Odisha')
    expect(pharmacies).toHaveLength(CORE_COUNTS.pharmacies)
    expect(odisha).toHaveLength(1_200)
    expect(new Set(odisha.map((pharmacy) => pharmacy.district)).size).toBe(30)
    expect(pharmacies.filter((pharmacy) => pharmacy.isKeonjharTown)).toHaveLength(10)
    expect(pharmacies.reduce((sum, pharmacy) => sum + pharmacy.inventoryTarget, 0)).toBe(CORE_COUNTS.inventory)
  })

  it('keeps coordinates in India bounds and gives the Keonjhar cluster distinct points', () => {
    const pharmacies = buildPharmacies(locations)
    for (const pharmacy of pharmacies) {
      expect(pharmacy.latitude).toBeGreaterThanOrEqual(6)
      expect(pharmacy.latitude).toBeLessThanOrEqual(38)
      expect(pharmacy.longitude).toBeGreaterThanOrEqual(68)
      expect(pharmacy.longitude).toBeLessThanOrEqual(98)
    }
    const keonjhar = pharmacies.filter((pharmacy) => pharmacy.isKeonjharTown)
    expect(new Set(keonjhar.map((pharmacy) => `${pharmacy.latitude},${pharmacy.longitude}`)).size).toBe(10)
  })

  it('selects unique inventory with strongly decreasing tier density', () => {
    const tierTotals = [0, 0, 0, 0]
    for (let pharmacyIndex = 0; pharmacyIndex < 500; pharmacyIndex++) {
      const indexes = selectMedicineIndexes(95, pharmacyIndex)
      expect(new Set(indexes).size).toBe(95)
      for (const index of indexes) tierTotals[index < 500 ? 0 : index < 3_500 ? 1 : index < 12_000 ? 2 : 3]++
    }
    const density = [tierTotals[0] / 500, tierTotals[1] / 3_000, tierTotals[2] / 8_500, tierTotals[3] / 8_000]
    expect(density[0]).toBeGreaterThan(density[1])
    expect(density[1]).toBeGreaterThan(density[2])
    expect(density[2]).toBeGreaterThan(density[3])
  })

  it('curates repeated 6/3/1/0 common-product coverage across Keonjhar', () => {
    const selections = Array.from({ length: 10 }, (_, pharmacyIndex) => new Set(selectMedicineIndexes(95, pharmacyIndex)))
    const coverage = Array.from({ length: 100 }, (_, medicineIndex) => selections.filter((selection) => selection.has(medicineIndex)).length)
    expect(coverage[0]).toBe(6)
    expect(coverage[1]).toBe(3)
    expect(coverage[2]).toBe(1)
    expect(coverage[3]).toBe(0)
    expect(coverage.slice(0, 100).filter((count) => count === 6)).toHaveLength(25)
  })

  it('produces non-negative, status-consistent stock and bounded prices', () => {
    const medicines = buildMedicines()
    const pharmacies = buildPharmacies(locations)
    for (let index = 0; index < 1_000; index++) {
      const medicineIndex = (index * 19) % medicines.length
      const record = buildInventoryRecord(pharmacies[index % pharmacies.length], medicines[medicineIndex], index % pharmacies.length, medicineIndex)
      expect(record.quantity).toBeGreaterThanOrEqual(0)
      expect(Number(record.sellingPrice)).toBeGreaterThanOrEqual(1)
      expect(Number(record.sellingPrice)).toBeLessThanOrEqual(1_000)
      if (record.quantity === 0) expect(record.availability).toBe('OUT_OF_STOCK')
      if (record.quantity > 0 && record.quantity <= 5) expect(record.availability).toBe('LOW_STOCK')
    }
  })
})
