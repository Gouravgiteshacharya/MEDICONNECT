import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

import type { Prisma } from '../../../generated/prisma/client.js'
import { prisma } from '../../lib/prisma.js'
import { DEFAULT_OUTPUT_DIR } from './generateDemoData.js'
import type { DemoInventory, DemoMedicine, DemoPharmacy } from './types.js'

const BATCH_SIZE = 1_000

async function* readJsonl<T>(filePath: string): AsyncGenerator<T> {
  const lines = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) if (line.trim()) yield JSON.parse(line) as T
}

async function forEachBatch<T>(source: AsyncGenerator<T>, callback: (batch: T[]) => Promise<unknown>) {
  let batch: T[] = []
  for await (const value of source) {
    batch.push(value)
    if (batch.length === BATCH_SIZE) { await callback(batch); batch = [] }
  }
  if (batch.length) await callback(batch)
}

function enforceSafetyGuard() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is forbidden when NODE_ENV=production')
  if (process.env.ALLOW_DEMO_SEED !== 'true' || process.env.DEMO_SEED_CONFIRM !== 'MEDICONNECT_DEMO_DATA') {
    throw new Error('Refusing demo seed. Set ALLOW_DEMO_SEED=true and DEMO_SEED_CONFIRM=MEDICONNECT_DEMO_DATA explicitly.')
  }
}

async function main() {
  enforceSafetyGuard()
  const outputDir = path.resolve(process.env.DEMO_DATA_DIR ?? DEFAULT_OUTPUT_DIR)
  console.log(`Seeding deterministic demo data from ${outputDir} in ${BATCH_SIZE}-row batches...`)
  await forEachBatch(readJsonl<DemoMedicine>(path.join(outputDir, 'medicines.jsonl')), (batch) => prisma.medicine.createMany({ skipDuplicates: true, data: batch.map(({ tier: _tier, basePricePaise: _price, ingredientId: _ingredient, strength: _strength, strengthUnit: _unit, ...medicine }) => medicine) as Prisma.MedicineCreateManyInput[] }))
  const ingredientIds = new Map<string, string>()
  for await (const ingredient of readJsonl<Prisma.ActiveIngredientCreateManyInput>(path.join(outputDir, 'active-ingredients.jsonl'))) {
    const stored = await prisma.activeIngredient.upsert({
      where: { name: ingredient.name },
      update: {},
      create: ingredient,
      select: { id: true },
    })
    ingredientIds.set(String(ingredient.id), stored.id)
  }
  await forEachBatch(readJsonl<Prisma.MedicineCompositionCreateManyInput>(path.join(outputDir, 'medicine-compositions.jsonl')), (batch) => prisma.medicineComposition.createMany({
    skipDuplicates: true,
    data: batch.map((composition) => ({ ...composition, activeIngredientId: ingredientIds.get(composition.activeIngredientId) ?? composition.activeIngredientId })),
  }))
  await forEachBatch(readJsonl<DemoPharmacy>(path.join(outputDir, 'pharmacies.jsonl')), (batch) => prisma.pharmacy.createMany({ skipDuplicates: true, data: batch.map(({ district: _district, inventoryTarget: _target, isKeonjharTown: _keonjhar, ...pharmacy }) => pharmacy) as Prisma.PharmacyCreateManyInput[] }))
  const manifest = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(path.join(outputDir, 'manifest.json'), 'utf8'))) as { files: Record<string, unknown> }
  for (const filename of Object.keys(manifest.files).filter((name) => /^inventory-\d+\.jsonl$/.test(name)).sort()) {
    await forEachBatch(readJsonl<DemoInventory>(path.join(outputDir, filename)), (batch) => prisma.pharmacyInventory.createMany({ skipDuplicates: true, data: batch as Prisma.PharmacyInventoryCreateManyInput[] }))
  }
  console.log('Demo seed complete. Deterministic IDs and unique constraints prevented duplicate rows.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => prisma.$disconnect())
