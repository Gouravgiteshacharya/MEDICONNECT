import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { finished } from 'node:stream/promises'
import { once } from 'node:events'

import { medicineTemplates } from './data/medicineCatalogue.js'
import { allocateWeighted, createPrng, DEFAULT_DEMO_SEED, deterministicUuid, median, seedFromString } from './lib.js'
import type { DemoInventory, DemoLocation, DemoManifest, DemoMedicine, DemoPharmacy } from './types.js'

export const CORE_COUNTS = { medicines: 20_000, pharmacies: 5_000, inventory: 475_000 } as const
export const DEFAULT_OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.demo-data')
const FIXED_NOW = '2026-09-18T00:00:00.000Z'
const INVENTORY_CHUNK_SIZE = 50_000

const namePrefixes = ['Maa Tarini', 'Savitri', 'Sai Krupa', 'Maa Mangala', 'Jagannath', 'Shree Ganesh', 'Arogya', 'Jeevan', 'Annapurna', 'Nilachala', 'Subham', 'Swasthya', 'Janaseva', 'Suraksha', 'Niramaya', 'Ashirwad', 'Sanjeevani', 'Seva', 'Dhanvantari', 'Utkal', 'Pragati', 'Sahara', 'Suman', 'Aditya', 'Navjeevan']
const nameRoots = ['Care', 'Health', 'Wellness', 'Arogya', 'Life', 'Community', 'Family', 'Town', 'City', 'People', 'Mitra', 'Relief', 'Hope', 'Goodwill', 'Neighbourhood', 'Everyday', 'Trust', 'Healing', 'Swasth', 'Sanjeevan']
const nameSuffixes = ['Medical Store', 'Medicine House', 'Medical Hall', 'Pharmacy', 'Medicals', 'Health Point', 'Medicine Centre', 'Care Pharmacy', 'Drug House', 'Community Pharmacy']
export const keonjharLocalityLabels = [
  'Near Atopur Road',
  'Mining Road area',
  'Near College Road',
  'Medical Road area',
  'Near Gandhi Chowk',
  'Jagamohanpur area',
  'Madhapur area',
  'New Market area',
  'Station Road area',
  'Keonjhar town-centre area',
] as const
const majorChainPattern = /\b(apollo|medplus|netmeds|pharmeasy|tata\s*1mg|wellness\s*forever|guardian)\b/i

class JsonlWriter {
  readonly hash = createHash('sha256')
  readonly stream
  records = 0
  bytes = 0

  constructor(readonly filePath: string) { this.stream = createWriteStream(filePath, { encoding: 'utf8' }) }

  async write(value: unknown) {
    const line = `${JSON.stringify(value)}\n`
    this.hash.update(line); this.records++; this.bytes += Buffer.byteLength(line)
    if (!this.stream.write(line)) await once(this.stream, 'drain')
  }

  async close() {
    this.stream.end(); await finished(this.stream)
    return { records: this.records, bytes: this.bytes, sha256: this.hash.digest('hex') }
  }
}

export function buildMedicines(seed = DEFAULT_DEMO_SEED): DemoMedicine[] {
  const medicines: DemoMedicine[] = []
  for (let brandVariant = 0; brandVariant < 200; brandVariant++) {
    for (let templateIndex = 0; templateIndex < medicineTemplates.length; templateIndex++) {
      const template = medicineTemplates[templateIndex]
      const index = medicines.length
      const serial = String(index + 1).padStart(5, '0')
      const tier: DemoMedicine['tier'] = index < 500 ? 'A' : index < 3_500 ? 'B' : index < 12_000 ? 'C' : 'D'
      medicines.push({
        id: deterministicUuid('medicine', `${seed}:${index}`),
        name: `${template.genericName} ${template.strength} ${template.strengthUnit} ${template.form} [DEMO ${serial}]`,
        brandName: `MediDemo ${serial}`,
        genericName: template.genericName,
        manufacturer: `MediConnect Demo Formulations Unit ${String(brandVariant + 1).padStart(3, '0')}`,
        description: `DEMO CATALOGUE — ${template.category}; ${template.ingredient} ${template.strength} ${template.strengthUnit} ${template.form}. Not clinical advice.`,
        requiresPrescription: template.requiresPrescription,
        isActive: true,
        tier,
        basePricePaise: template.basePricePaise + brandVariant * 3 + templateIndex * 2,
        ingredientId: deterministicUuid('ingredient', template.ingredient.toLowerCase()),
        strength: String(template.strength),
        strengthUnit: template.strengthUnit,
      })
    }
  }
  return medicines
}

function allocateLocations(locations: DemoLocation[]) {
  const odisha = locations.filter((location) => location.odisha)
  const national = locations.filter((location) => !location.odisha)
  const keonjhar = odisha.find((location) => location.keonjharTown)
  if (!keonjhar) throw new Error('Location asset is missing the dedicated Keonjhar town centre')
  const otherOdisha = odisha.filter((location) => !location.keonjharTown)
  const odishaCounts = allocateWeighted(1_190, otherOdisha.map((location) => location.weight), 1)
  const nationalCounts = allocateWeighted(3_800, national.map((location) => location.weight), 1)
  return [
    { location: keonjhar, count: 10 },
    ...otherOdisha.map((location, index) => ({ location, count: odishaCounts[index] })),
    ...national.map((location, index) => ({ location, count: nationalCounts[index] })),
  ]
}

export function pharmacyName(index: number, city: string) {
  const a = index % namePrefixes.length
  const b = Math.floor(index / namePrefixes.length) % nameRoots.length
  const c = Math.floor(index / (namePrefixes.length * nameRoots.length)) % nameSuffixes.length
  const base = `${namePrefixes[a]} ${nameRoots[b]} ${nameSuffixes[c]}`
  return index < namePrefixes.length * nameRoots.length * nameSuffixes.length ? base : `${city} ${base}`
}

export function buildPharmacies(locations: DemoLocation[], seed = DEFAULT_DEMO_SEED): DemoPharmacy[] {
  const pharmacies: DemoPharmacy[] = []
  const kendujharOverflowLocation = locations.find(
    (location) => location.city === 'Banspal' && location.district === 'Kendujhar',
  )
  if (!kendujharOverflowLocation) throw new Error('Location asset is missing the Kendujhar overflow centre')
  for (const { location, count } of allocateLocations(locations)) {
    // The asset contains both the dedicated Keonjhar-town centre and a broader
    // Keonjhar postal centre. Keep `city=Keonjhar` exclusive to the curated ten
    // and place the broader allocation at the existing Banspal centre instead.
    const effectiveLocation = !location.keonjharTown && location.city === 'Keonjhar' && location.district === 'Kendujhar'
      ? kendujharOverflowLocation
      : location
    for (let localIndex = 0; localIndex < count; localIndex++) {
      const index = pharmacies.length
      const random = createPrng(seedFromString(`${seed}:pharmacy:${index}`))
      const distanceKm = effectiveLocation.radiusKm * Math.sqrt(random())
      const angle = random() * Math.PI * 2
      const latitude = effectiveLocation.latitude + (distanceKm * Math.cos(angle)) / 111.32
      const longitude = effectiveLocation.longitude + (distanceKm * Math.sin(angle)) / (111.32 * Math.cos(effectiveLocation.latitude * Math.PI / 180))
      const city = effectiveLocation.keonjharTown ? 'Keonjhar' : effectiveLocation.city
      const name = pharmacyName(index, city)
      const addressLine1 = effectiveLocation.keonjharTown
        ? keonjharLocalityLabels[localIndex]
        : `Ward ${1 + (index % 30)}, ${city} Town Centre`
      if (majorChainPattern.test(name)) throw new Error(`Generated prohibited chain-like name: ${name}`)
      pharmacies.push({
        id: deterministicUuid('pharmacy', `${seed}:${index}`),
        name,
        description: 'Fictional independent local pharmacy for MediConnect demo data. Not a verified real-world store.',
        phone: String(7_000_000_000 + index),
        email: `demo-pharmacy-${String(index + 1).padStart(5, '0')}@example.invalid`,
        licenseNumber: `DEMO-MC-${seed}-${String(index + 1).padStart(5, '0')}`,
        addressLine1,
        addressLine2: effectiveLocation.keonjharTown
          ? 'Keonjhar, Kendujhar district'
          : `Near Community Market, ${effectiveLocation.district} district`,
        city, district: effectiveLocation.district, state: effectiveLocation.state, postalCode: effectiveLocation.postalCode,
        latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)),
        isVerified: true, isActive: true, partnerStatus: 'ACTIVE',
        inventoryManagementMode: 'MEDICONNECT_MANAGED', inventoryTarget: 0,
        isKeonjharTown: Boolean(effectiveLocation.keonjharTown),
      })
    }
  }
  const weights = pharmacies.map((_, index) => 0.7 + createPrng(seedFromString(`${seed}:size:${index}`))() * 0.75)
  const targets = allocateWeighted(CORE_COUNTS.inventory, weights, 55)
  pharmacies.forEach((pharmacy, index) => { pharmacy.inventoryTarget = targets[index] })
  return pharmacies
}

function sampleUnique(start: number, size: number, count: number, random: () => number, target: Set<number>) {
  while (target.size < count) target.add(start + Math.floor(random() * size))
}

export function selectMedicineIndexes(targetCount: number, pharmacyIndex: number, seed = DEFAULT_DEMO_SEED) {
  const random = createPrng(seedFromString(`${seed}:inventory-selection:${pharmacyIndex}`))
  const shares = [0.42 + (random() - 0.5) * 0.05, 0.33 + (random() - 0.5) * 0.04, 0.20, 0.05]
  const counts = allocateWeighted(targetCount, shares)
  const indexes = new Set<number>()
  // The first ten pharmacies are the dedicated Keonjhar town cluster. Across
  // the first 100 common products, repeat 6/3/1/0 coverage patterns so review
  // scenarios include multiple, sparse, single, and no-local-stock results.
  if (pharmacyIndex < 10) {
    const coveragePattern = [6, 3, 1, 0]
    for (let medicineIndex = 0; medicineIndex < 100; medicineIndex++) {
      const coverage = coveragePattern[medicineIndex % coveragePattern.length]
      if ((pharmacyIndex + medicineIndex * 7) % 10 < coverage) indexes.add(medicineIndex)
    }
  }
  sampleUnique(pharmacyIndex < 10 ? 100 : 0, pharmacyIndex < 10 ? 400 : 500, counts[0], random, indexes)
  const afterA = indexes.size
  while (indexes.size < afterA + counts[1]) indexes.add(500 + Math.floor(random() * 3_000))
  const afterB = indexes.size
  while (indexes.size < afterB + counts[2]) indexes.add(3_500 + Math.floor(random() * 8_500))
  const afterC = indexes.size
  while (indexes.size < afterC + counts[3]) indexes.add(12_000 + Math.floor(random() * 8_000))
  return [...indexes].sort((a, b) => a - b)
}

export function buildInventoryRecord(pharmacy: DemoPharmacy, medicine: DemoMedicine, pharmacyIndex: number, medicineIndex: number, seed = DEFAULT_DEMO_SEED): DemoInventory {
  const random = createPrng(seedFromString(`${seed}:stock:${pharmacyIndex}:${medicineIndex}`))
  const stockRoll = pharmacy.isKeonjharTown && medicineIndex < 100 ? 0.2 + random() * 0.8 : random()
  const quantity = stockRoll < 0.04 ? 0 : stockRoll < 0.19 ? 1 + Math.floor(random() * 5) : 6 + Math.floor(random() * 75)
  const availability = quantity === 0 ? 'OUT_OF_STOCK' : quantity <= 5 ? 'LOW_STOCK' : 'AVAILABLE'
  const localityAdjustment = ((seedFromString(pharmacy.city) % 7) - 3) / 100
  const variation = (random() - 0.5) * 0.08 + localityAdjustment
  const paise = Math.max(100, Math.round(medicine.basePricePaise * (1 + variation)))
  const ageHours = Math.floor(random() * 168)
  return {
    id: deterministicUuid('inventory', `${seed}:${pharmacyIndex}:${medicineIndex}`),
    pharmacyId: pharmacy.id, medicineId: medicine.id, quantity,
    sellingPrice: (paise / 100).toFixed(2), availability,
    lastUpdated: new Date(Date.parse(FIXED_NOW) - ageHours * 3_600_000).toISOString(),
  }
}

async function writeJson(filePath: string, value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, text))
  return { records: 1, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }
}

export async function generateDemoData(options: { outputDir?: string; seed?: number } = {}) {
  const started = performance.now()
  const seed = options.seed ?? DEFAULT_DEMO_SEED
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR)
  await rm(outputDir, { recursive: true, force: true }); await mkdir(outputDir, { recursive: true })
  const locationsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data/indiaLocations.json')
  const locations = JSON.parse(await readFile(locationsPath, 'utf8')) as DemoLocation[]
  const medicines = buildMedicines(seed)
  const pharmacies = buildPharmacies(locations, seed)
  const files: DemoManifest['files'] = {}

  const medicineWriter = new JsonlWriter(path.join(outputDir, 'medicines.jsonl'))
  for (const medicine of medicines) await medicineWriter.write(medicine)
  files['medicines.jsonl'] = await medicineWriter.close()

  const ingredients = [...new Map(medicines.map((medicine) => [medicine.ingredientId, { id: medicine.ingredientId, name: medicine.genericName.replace(' Paediatric', ''), description: 'Ingredient used by the deterministic MediConnect demo catalogue.' }])).values()]
  const ingredientWriter = new JsonlWriter(path.join(outputDir, 'active-ingredients.jsonl'))
  for (const ingredient of ingredients) await ingredientWriter.write(ingredient)
  files['active-ingredients.jsonl'] = await ingredientWriter.close()

  const compositionWriter = new JsonlWriter(path.join(outputDir, 'medicine-compositions.jsonl'))
  for (const medicine of medicines) await compositionWriter.write({ id: deterministicUuid('composition', medicine.id), medicineId: medicine.id, activeIngredientId: medicine.ingredientId, strength: medicine.strength, strengthUnit: medicine.strengthUnit })
  files['medicine-compositions.jsonl'] = await compositionWriter.close()

  const pharmacyWriter = new JsonlWriter(path.join(outputDir, 'pharmacies.jsonl'))
  for (const pharmacy of pharmacies) await pharmacyWriter.write(pharmacy)
  files['pharmacies.jsonl'] = await pharmacyWriter.close()

  const keonjhar = pharmacies.filter((pharmacy) => pharmacy.isKeonjharTown)
  const keonjharStock = new Map<string, string[]>()
  let inventoryTotal = 0
  let chunkIndex = 0
  let inventoryWriter: JsonlWriter | undefined
  for (let pharmacyIndex = 0; pharmacyIndex < pharmacies.length; pharmacyIndex++) {
    const pharmacy = pharmacies[pharmacyIndex]
    for (const medicineIndex of selectMedicineIndexes(pharmacy.inventoryTarget, pharmacyIndex, seed)) {
      if (!inventoryWriter || inventoryWriter.records >= INVENTORY_CHUNK_SIZE) {
        if (inventoryWriter) files[path.basename(inventoryWriter.filePath)] = await inventoryWriter.close()
        chunkIndex++
        inventoryWriter = new JsonlWriter(path.join(outputDir, `inventory-${String(chunkIndex).padStart(2, '0')}.jsonl`))
      }
      const medicine = medicines[medicineIndex]
      const record = buildInventoryRecord(pharmacy, medicine, pharmacyIndex, medicineIndex, seed)
      await inventoryWriter.write(record); inventoryTotal++
      if (pharmacy.isKeonjharTown && record.quantity > 0) {
        const stockedBy = keonjharStock.get(medicine.id) ?? []
        stockedBy.push(pharmacy.name); keonjharStock.set(medicine.id, stockedBy)
      }
    }
  }
  if (inventoryWriter) files[path.basename(inventoryWriter.filePath)] = await inventoryWriter.close()

  const inventoryTargets = pharmacies.map((pharmacy) => pharmacy.inventoryTarget)
  const odisha = pharmacies.filter((pharmacy) => pharmacy.state === 'Odisha')
  const manifest: DemoManifest = {
    formatVersion: 1, seed, generatedAt: FIXED_NOW,
    counts: { medicines: medicines.length, pharmacies: pharmacies.length, inventory: inventoryTotal, coreTotal: medicines.length + pharmacies.length + inventoryTotal, activeIngredients: ingredients.length, compositions: medicines.length },
    geography: {
      odishaPharmacies: odisha.length,
      odishaDistricts: new Set(odisha.map((pharmacy) => pharmacy.district)).size,
      odishaTowns: new Set(odisha.map((pharmacy) => pharmacy.city)).size,
      kendujharDistrictPharmacies: pharmacies.filter((pharmacy) => pharmacy.district === 'Kendujhar').length,
      keonjharTownPharmacies: keonjhar.length,
      nationalTowns: new Set(pharmacies.map((pharmacy) => `${pharmacy.city}|${pharmacy.state}`)).size,
    },
    inventory: { min: Math.min(...inventoryTargets), median: median(inventoryTargets), max: Math.max(...inventoryTargets) },
    files,
  }
  files['manifest.json'] = await writeJson(path.join(outputDir, 'manifest.json'), manifest)

  const sampleCounts = [6, 3, 1, 0]
  const samples = sampleCounts.map((desired, sampleIndex) => {
    const candidates = medicines.filter((medicine) => sampleIndex === 3 ? medicine.tier === 'D' : medicine.tier === 'A')
    return candidates.reduce((best, medicine) => {
      const difference = Math.abs((keonjharStock.get(medicine.id)?.length ?? 0) - desired)
      return difference < best.difference ? { medicine, difference } : best
    }, { medicine: candidates[0], difference: Number.POSITIVE_INFINITY }).medicine
  })
  const report = [
    '# MediConnect demo-data review sample', '',
    '> All businesses, stock, and prices below are fictional deterministic demo data.', '',
    '## Keonjhar town pharmacies', '',
    '| Pharmacy | Area | Coordinates | Inventory rows |', '|---|---|---:|---:|',
    ...keonjhar.map((pharmacy) => `| ${pharmacy.name} | ${pharmacy.addressLine1} | ${pharmacy.latitude}, ${pharmacy.longitude} | ${pharmacy.inventoryTarget} |`),
    '', '## Example availability across the Keonjhar cluster', '',
    '| Demo medicine | Stocked by | Pharmacy names |', '|---|---:|---|',
    ...samples.map((medicine) => { const names = keonjharStock.get(medicine.id) ?? []; return `| ${medicine.name} | ${names.length}/10 | ${names.join(', ') || 'None'} |` }),
    '', 'Generated data is not clinical advice and does not assert real-world availability.', '',
  ].join('\n')
  const reportPath = path.join(outputDir, 'review-sample.md')
  const { writeFile } = await import('node:fs/promises'); await writeFile(reportPath, report)
  const reportStat = await stat(reportPath)

  return { manifest, outputDir, runtimeMs: Math.round(performance.now() - started), outputBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0) + reportStat.size }
}

function parseArgs() {
  const outputIndex = process.argv.indexOf('--output')
  const seed = Number(process.env.MEDICONNECT_DEMO_SEED ?? DEFAULT_DEMO_SEED)
  if (!Number.isSafeInteger(seed)) throw new Error('MEDICONNECT_DEMO_SEED must be an integer')
  return { seed, outputDir: outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateDemoData(parseArgs())
  const { counts, geography, inventory } = result.manifest
  console.log([
    `Medicines: ${counts.medicines.toLocaleString()}`,
    `Pharmacies: ${counts.pharmacies.toLocaleString()}`,
    `Inventory: ${counts.inventory.toLocaleString()}`,
    `Total: ${counts.coreTotal.toLocaleString()}`,
    '',
    `Odisha pharmacies: ${geography.odishaPharmacies.toLocaleString()}`,
    `Odisha cities/towns: ${geography.odishaTowns}`,
    `Odisha districts represented: ${geography.odishaDistricts}`,
    `Kendujhar district pharmacies: ${geography.kendujharDistrictPharmacies}`,
    `Keonjhar town pharmacies: ${geography.keonjharTownPharmacies}`,
    `National cities/towns represented: ${geography.nationalTowns}`,
    `Inventory items/pharmacy (min/median/max): ${inventory.min}/${inventory.median}/${inventory.max}`,
    `Seed: ${result.manifest.seed}`,
    `Runtime: ${(result.runtimeMs / 1000).toFixed(2)}s`,
    `Output: ${(result.outputBytes / 1024 / 1024).toFixed(2)} MiB (${result.outputDir})`,
  ].join('\n'))
}
