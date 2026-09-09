import {
  InventoryManagementMode,
  InventoryStatus,
  PharmacyPartnerStatus,
} from '../../generated/prisma/client.js'

import { prisma } from '../lib/prisma.js'

const medicines = [
  {
    name: 'Dolo 650',
    brandName: 'Dolo',
    genericName: 'Paracetamol',
    manufacturer: 'Micro Labs',
    description: 'Paracetamol 650 mg tablet',
    requiresPrescription: false,
    ingredient: 'Paracetamol',
    strength: '650',
    strengthUnit: 'mg',
  },
  {
    name: 'Crocin 650',
    brandName: 'Crocin',
    genericName: 'Paracetamol',
    manufacturer: 'GSK',
    description: 'Paracetamol 650 mg tablet',
    requiresPrescription: false,
    ingredient: 'Paracetamol',
    strength: '650',
    strengthUnit: 'mg',
  },
  {
    name: 'Azithral 500',
    brandName: 'Azithral',
    genericName: 'Azithromycin',
    manufacturer: 'Alembic Pharmaceuticals',
    description: 'Azithromycin 500 mg tablet',
    requiresPrescription: true,
    ingredient: 'Azithromycin',
    strength: '500',
    strengthUnit: 'mg',
  },
]

const pharmacies = [
  {
    licenseNumber: 'DEV-MC-001',
    name: 'Sharma Medical Store',
    description: 'Development pharmacy seed',
    phone: '9000000001',
    email: 'sharma.dev@mediconnect.local',
    addressLine1: 'Gandhi Nagar',
    addressLine2: null,
    city: 'Brahmapur',
    state: 'Odisha',
    postalCode: '760001',
    latitude: 19.3147,
    longitude: 84.7941,
  },
  {
    licenseNumber: 'DEV-MC-002',
    name: 'City Care Pharmacy',
    description: 'Development pharmacy seed',
    phone: '9000000002',
    email: 'citycare.dev@mediconnect.local',
    addressLine1: 'Courtpeta Square',
    addressLine2: null,
    city: 'Brahmapur',
    state: 'Odisha',
    postalCode: '760004',
    latitude: 19.3182,
    longitude: 84.7898,
  },
  {
    licenseNumber: 'DEV-MC-003',
    name: 'Health Point Pharmacy',
    description: 'Development pharmacy seed',
    phone: '9000000003',
    email: 'healthpoint.dev@mediconnect.local',
    addressLine1: 'Gate Bazar',
    addressLine2: null,
    city: 'Brahmapur',
    state: 'Odisha',
    postalCode: '760001',
    latitude: 19.3115,
    longitude: 84.7973,
  },
]

async function upsertMedicine(seed: (typeof medicines)[number]) {
  let medicine = await prisma.medicine.findFirst({
    where: {
      name: seed.name,
      manufacturer: seed.manufacturer,
    },
  })

  if (!medicine) {
    medicine = await prisma.medicine.create({
      data: {
        name: seed.name,
        brandName: seed.brandName,
        genericName: seed.genericName,
        manufacturer: seed.manufacturer,
        description: seed.description,
        requiresPrescription: seed.requiresPrescription,
        isActive: true,
      },
    })
  } else {
    medicine = await prisma.medicine.update({
      where: { id: medicine.id },
      data: {
        brandName: seed.brandName,
        genericName: seed.genericName,
        description: seed.description,
        requiresPrescription: seed.requiresPrescription,
        isActive: true,
      },
    })
  }

  const ingredient = await prisma.activeIngredient.upsert({
    where: { name: seed.ingredient },
    update: {},
    create: {
      name: seed.ingredient,
    },
  })

  const existingComposition =
    await prisma.medicineComposition.findFirst({
      where: {
        medicineId: medicine.id,
        activeIngredientId: ingredient.id,
        strength: seed.strength,
        strengthUnit: seed.strengthUnit,
      },
    })

  if (!existingComposition) {
    await prisma.medicineComposition.create({
      data: {
        medicineId: medicine.id,
        activeIngredientId: ingredient.id,
        strength: seed.strength,
        strengthUnit: seed.strengthUnit,
      },
    })
  }

  return medicine
}

async function upsertPharmacy(seed: (typeof pharmacies)[number]) {
  return prisma.pharmacy.upsert({
    where: {
      licenseNumber: seed.licenseNumber,
    },
    update: {
      name: seed.name,
      description: seed.description,
      phone: seed.phone,
      email: seed.email,
      addressLine1: seed.addressLine1,
      addressLine2: seed.addressLine2,
      city: seed.city,
      state: seed.state,
      postalCode: seed.postalCode,
      latitude: seed.latitude,
      longitude: seed.longitude,
      isVerified: true,
      isActive: true,
      partnerStatus: PharmacyPartnerStatus.ACTIVE,
      inventoryManagementMode:
        InventoryManagementMode.MEDICONNECT_MANAGED,
    },
    create: {
      ...seed,
      isVerified: true,
      isActive: true,
      partnerStatus: PharmacyPartnerStatus.ACTIVE,
      inventoryManagementMode:
        InventoryManagementMode.MEDICONNECT_MANAGED,
    },
  })
}

async function main() {
  console.log('Seeding MediConnect discovery data...')

  const seededMedicines = new Map()

  for (const seed of medicines) {
    const medicine = await upsertMedicine(seed)
    seededMedicines.set(seed.name, medicine)

    console.log(`Medicine ready: ${medicine.name}`)
  }

  const seededPharmacies = []

  for (const seed of pharmacies) {
    const pharmacy = await upsertPharmacy(seed)
    seededPharmacies.push(pharmacy)

    console.log(`Pharmacy ready: ${pharmacy.name}`)
  }

  const inventorySeeds = [
    {
      pharmacy: 0,
      medicine: 'Dolo 650',
      quantity: 38,
      sellingPrice: '32.00',
      availability: InventoryStatus.AVAILABLE,
    },
    {
      pharmacy: 1,
      medicine: 'Dolo 650',
      quantity: 21,
      sellingPrice: '30.00',
      availability: InventoryStatus.AVAILABLE,
    },
    {
      pharmacy: 2,
      medicine: 'Dolo 650',
      quantity: 6,
      sellingPrice: '31.00',
      availability: InventoryStatus.LOW_STOCK,
    },
    {
      pharmacy: 0,
      medicine: 'Crocin 650',
      quantity: 17,
      sellingPrice: '34.00',
      availability: InventoryStatus.AVAILABLE,
    },
    {
      pharmacy: 1,
      medicine: 'Crocin 650',
      quantity: 8,
      sellingPrice: '33.00',
      availability: InventoryStatus.LOW_STOCK,
    },
    {
      pharmacy: 1,
      medicine: 'Azithral 500',
      quantity: 12,
      sellingPrice: '118.00',
      availability: InventoryStatus.AVAILABLE,
    },
  ]

  for (const seed of inventorySeeds) {
    const pharmacy = seededPharmacies[seed.pharmacy]
    const medicine = seededMedicines.get(seed.medicine)

    if (!medicine) {
      throw new Error(`Missing seeded medicine: ${seed.medicine}`)
    }

    await prisma.pharmacyInventory.upsert({
      where: {
        pharmacyId_medicineId: {
          pharmacyId: pharmacy.id,
          medicineId: medicine.id,
        },
      },
      update: {
        quantity: seed.quantity,
        sellingPrice: seed.sellingPrice,
        availability: seed.availability,
        lastUpdated: new Date(),
      },
      create: {
        pharmacyId: pharmacy.id,
        medicineId: medicine.id,
        quantity: seed.quantity,
        sellingPrice: seed.sellingPrice,
        availability: seed.availability,
        lastUpdated: new Date(),
      },
    })

    console.log(
      `Inventory ready: ${pharmacy.name} → ${medicine.name}`,
    )
  }

  console.log('Discovery seed complete.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
