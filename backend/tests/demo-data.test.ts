import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildInventoryRecord, buildMedicines, buildPharmacies, CORE_COUNTS, keonjharLocalityLabels, pharmacyName, selectMedicineIndexes } from '../src/dev/demo-data/generateDemoData.js'
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
    expect(pharmacies.every((pharmacy) => pharmacy.isVerified && pharmacy.isActive && pharmacy.partnerStatus === 'ACTIVE')).toBe(true)
    expect(pharmacies.filter((pharmacy) => pharmacy.isKeonjharTown)).toHaveLength(10)
    expect(pharmacies.filter((pharmacy) => pharmacy.city === 'Keonjhar')).toHaveLength(10)
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
    expect(keonjhar.map((pharmacy) => pharmacy.addressLine1)).toEqual(keonjharLocalityLabels)
    expect(keonjhar.some((pharmacy) => /^Ward \d+/.test(pharmacy.addressLine1))).toBe(false)
  })

  it('keeps only 100 canonical formulations active and customer-facing', () => {
    const medicines = buildMedicines(DEFAULT_DEMO_SEED)
    const active = medicines.filter((medicine) => medicine.isActive)
    expect(active).toHaveLength(100)
    expect(active.every((medicine) => !/\[(DEMO|SYNTHETIC)\s+\d+\]/i.test(medicine.name))).toBe(true)
    expect(active.every((medicine) => !medicine.manufacturer.startsWith('Internal Synthetic'))).toBe(true)
  })

  it('stocks 95 unique canonical formulations per pharmacy', () => {
    for (let pharmacyIndex = 0; pharmacyIndex < 500; pharmacyIndex++) {
      const indexes = selectMedicineIndexes(95, pharmacyIndex)
      expect(new Set(indexes).size).toBe(95)
      expect(indexes.every((index) => index >= 0 && index < 100)).toBe(true)
    }
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
