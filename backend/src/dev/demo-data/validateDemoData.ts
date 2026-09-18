import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

import { CORE_COUNTS, DEFAULT_OUTPUT_DIR } from './generateDemoData.js'
import type { DemoInventory, DemoManifest, DemoMedicine, DemoPharmacy } from './types.js'

const majorChainPattern = /\b(apollo|medplus|netmeds|pharmeasy|tata\s*1mg|wellness\s*forever|guardian)\b/i

async function* readJsonl<T>(filePath: string): AsyncGenerator<T> {
  const lines = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) if (line.trim()) yield JSON.parse(line) as T
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function validateDemoData(outputDir = DEFAULT_OUTPUT_DIR) {
  const root = path.resolve(outputDir)
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as DemoManifest
  const medicineIds = new Set<string>()
  const medicineTiers = new Map<string, DemoMedicine['tier']>()
  const canonicalMedicines = new Set<string>()
  let medicineCount = 0
  for await (const medicine of readJsonl<DemoMedicine>(path.join(root, 'medicines.jsonl'))) {
    medicineCount++
    assert(!medicineIds.has(medicine.id), `Duplicate medicine ID: ${medicine.id}`)
    assert(medicine.name && medicine.genericName && medicine.manufacturer && medicine.description, `Medicine ${medicine.id} has empty required fields`)
    assert(/\[DEMO \d{5}\]/.test(medicine.name) && medicine.description.startsWith('DEMO CATALOGUE'), `Medicine ${medicine.id} is not explicitly demo-labelled`)
    assert(medicine.basePricePaise >= 100 && medicine.basePricePaise <= 100_000, `Medicine ${medicine.id} has unreasonable base price`)
    const canonical = `${medicine.name}|${medicine.manufacturer}`.toLowerCase()
    assert(!canonicalMedicines.has(canonical), `Duplicate canonical medicine: ${canonical}`)
    canonicalMedicines.add(canonical); medicineIds.add(medicine.id); medicineTiers.set(medicine.id, medicine.tier)
  }
  assert(medicineCount === CORE_COUNTS.medicines, `Expected ${CORE_COUNTS.medicines} medicines, found ${medicineCount}`)

  const pharmacyIds = new Set<string>()
  const pharmacyKeys = new Set<string>()
  const pharmacyTargets = new Map<string, number>()
  const odishaDistricts = new Set<string>()
  const odishaTowns = new Set<string>()
  const nationalTowns = new Set<string>()
  const keonjharIds = new Set<string>()
  let pharmacyCount = 0; let odishaCount = 0; let kendujharCount = 0
  for await (const pharmacy of readJsonl<DemoPharmacy>(path.join(root, 'pharmacies.jsonl'))) {
    pharmacyCount++
    assert(!pharmacyIds.has(pharmacy.id), `Duplicate pharmacy ID: ${pharmacy.id}`)
    assert(pharmacy.licenseNumber.startsWith(`DEMO-MC-${manifest.seed}-`), `Pharmacy ${pharmacy.id} lacks a stable demo identifier`)
    assert(pharmacy.description.startsWith('Fictional independent local pharmacy'), `Pharmacy ${pharmacy.id} is not identified as fictional/local`)
    assert(pharmacy.isVerified && pharmacy.isActive && pharmacy.partnerStatus === 'ACTIVE', `Demo marketplace pharmacy ${pharmacy.id} is not discoverable`)
    assert(!majorChainPattern.test(pharmacy.name), `Prohibited major-chain name: ${pharmacy.name}`)
    assert(pharmacy.city && pharmacy.district && pharmacy.state && /^\d{6}$/.test(pharmacy.postalCode), `Invalid city/state/postal association for ${pharmacy.id}`)
    assert(pharmacy.latitude >= 6 && pharmacy.latitude <= 38 && pharmacy.longitude >= 68 && pharmacy.longitude <= 98, `Coordinates outside India bounds for ${pharmacy.id}`)
    assert(pharmacy.latitude !== 0 && pharmacy.longitude !== 0, `Zero/default coordinates for ${pharmacy.id}`)
    const duplicateKey = `${pharmacy.name}|${pharmacy.addressLine1}|${pharmacy.city}|${pharmacy.latitude}|${pharmacy.longitude}`.toLowerCase()
    assert(!pharmacyKeys.has(duplicateKey), `Exact duplicate pharmacy: ${pharmacy.name}`)
    pharmacyKeys.add(duplicateKey); pharmacyIds.add(pharmacy.id); pharmacyTargets.set(pharmacy.id, pharmacy.inventoryTarget)
    nationalTowns.add(`${pharmacy.city}|${pharmacy.state}`)
    if (pharmacy.state === 'Odisha') { odishaCount++; odishaDistricts.add(pharmacy.district); odishaTowns.add(pharmacy.city) }
    if (pharmacy.district === 'Kendujhar') kendujharCount++
    if (pharmacy.isKeonjharTown) {
      assert(pharmacy.city === 'Keonjhar' && pharmacy.district === 'Kendujhar', `Bad Keonjhar town association for ${pharmacy.name}`)
      keonjharIds.add(pharmacy.id)
    } else {
      assert(pharmacy.city !== 'Keonjhar', `Non-curated pharmacy incorrectly assigned to Keonjhar town: ${pharmacy.name}`)
    }
  }
  assert(pharmacyCount === CORE_COUNTS.pharmacies, `Expected ${CORE_COUNTS.pharmacies} pharmacies, found ${pharmacyCount}`)
  assert(odishaCount === 1_200, `Expected 1,200 Odisha pharmacies, found ${odishaCount}`)
  assert(odishaDistricts.size === 30, `Expected all 30 Odisha districts, found ${odishaDistricts.size}`)
  assert(keonjharIds.size === 10, `Expected exactly 10 Keonjhar town pharmacies, found ${keonjharIds.size}`)
  assert(nationalTowns.size >= 300 && nationalTowns.size <= 350, `Expected 300–350 national towns, found ${nationalTowns.size}`)

  const inventoryByPharmacy = new Map<string, number>()
  const medicineFrequency = new Map<string, number>()
  const keonjharSignatures = new Map<string, string[]>()
  let inventoryCount = 0
  let currentPharmacy = ''; let currentMedicines = new Set<string>()
  for (const filename of Object.keys(manifest.files).filter((name) => /^inventory-\d+\.jsonl$/.test(name)).sort()) {
    for await (const inventory of readJsonl<DemoInventory>(path.join(root, filename))) {
      inventoryCount++
      assert(pharmacyIds.has(inventory.pharmacyId), `Inventory references missing pharmacy ${inventory.pharmacyId}`)
      assert(medicineIds.has(inventory.medicineId), `Inventory references missing medicine ${inventory.medicineId}`)
      if (inventory.pharmacyId !== currentPharmacy) { currentPharmacy = inventory.pharmacyId; currentMedicines = new Set() }
      assert(!currentMedicines.has(inventory.medicineId), `Duplicate pharmacy+medicine inventory row: ${inventory.pharmacyId}/${inventory.medicineId}`)
      currentMedicines.add(inventory.medicineId)
      assert(Number.isInteger(inventory.quantity) && inventory.quantity >= 0, `Negative/invalid stock for ${inventory.id}`)
      const price = Number(inventory.sellingPrice)
      assert(Number.isFinite(price) && price >= 1 && price <= 1_000, `Invalid price for ${inventory.id}: ${inventory.sellingPrice}`)
      assert(inventory.quantity !== 0 || inventory.availability === 'OUT_OF_STOCK', `Zero stock marked available for ${inventory.id}`)
      assert(inventory.quantity > 5 || inventory.availability !== 'AVAILABLE', `Low stock marked available for ${inventory.id}`)
      inventoryByPharmacy.set(inventory.pharmacyId, (inventoryByPharmacy.get(inventory.pharmacyId) ?? 0) + 1)
      medicineFrequency.set(inventory.medicineId, (medicineFrequency.get(inventory.medicineId) ?? 0) + 1)
      if (keonjharIds.has(inventory.pharmacyId)) {
        const signature = keonjharSignatures.get(inventory.pharmacyId) ?? []
        signature.push(inventory.medicineId); keonjharSignatures.set(inventory.pharmacyId, signature)
      }
    }
  }
  assert(inventoryCount === CORE_COUNTS.inventory, `Expected ${CORE_COUNTS.inventory} inventory rows, found ${inventoryCount}`)
  for (const [pharmacyId, target] of pharmacyTargets) assert(inventoryByPharmacy.get(pharmacyId) === target, `Inventory count mismatch for ${pharmacyId}`)
  assert(new Set([...keonjharSignatures.values()].map((ids) => ids.join(','))).size === 10, 'Keonjhar pharmacies have identical inventory distributions')
  const tierTotals = new Map<DemoMedicine['tier'], { records: number; medicines: number }>([['A', { records: 0, medicines: 0 }], ['B', { records: 0, medicines: 0 }], ['C', { records: 0, medicines: 0 }], ['D', { records: 0, medicines: 0 }]])
  for (const [medicineId, tier] of medicineTiers) { const value = tierTotals.get(tier)!; value.medicines++; value.records += medicineFrequency.get(medicineId) ?? 0 }
  const average = (tier: DemoMedicine['tier']) => { const value = tierTotals.get(tier)!; return value.records / value.medicines }
  assert(average('A') > average('B') && average('B') > average('C') && average('C') > average('D'), `Inventory weighting invalid: A=${average('A')}, B=${average('B')}, C=${average('C')}, D=${average('D')}`)

  assert(medicineCount + pharmacyCount + inventoryCount === 500_000, 'Core total is not exactly 500,000')
  for (const [filename, metadata] of Object.entries(manifest.files)) {
    const filePath = path.join(root, filename)
    assert((await stat(filePath)).size === metadata.bytes, `Byte-size mismatch for ${filename}`)
    assert(await sha256File(filePath) === metadata.sha256, `Checksum mismatch for ${filename}`)
  }
  return { manifest, medicineCount, pharmacyCount, inventoryCount, odishaCount, odishaDistricts: odishaDistricts.size, odishaTowns: odishaTowns.size, kendujharCount, keonjharCount: keonjharIds.size, nationalTowns: nationalTowns.size, tierAverages: Object.fromEntries(['A', 'B', 'C', 'D'].map((tier) => [tier, Number(average(tier as DemoMedicine['tier']).toFixed(2))])) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output')
  const result = await validateDemoData(outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined)
  console.log([
    'Demo-data validation: PASS',
    `Medicines: ${result.medicineCount.toLocaleString()}`,
    `Pharmacies: ${result.pharmacyCount.toLocaleString()}`,
    `Inventory: ${result.inventoryCount.toLocaleString()}`,
    `Total: ${(result.medicineCount + result.pharmacyCount + result.inventoryCount).toLocaleString()}`,
    `Odisha pharmacies/districts/towns: ${result.odishaCount}/${result.odishaDistricts}/${result.odishaTowns}`,
    `Kendujhar district / Keonjhar town: ${result.kendujharCount}/${result.keonjharCount}`,
    `National towns: ${result.nationalTowns}`,
    `Mean medicine availability by tier: ${JSON.stringify(result.tierAverages)}`,
  ].join('\n'))
}
