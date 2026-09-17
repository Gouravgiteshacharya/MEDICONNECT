export type DemoLocation = {
  city: string
  district: string
  state: string
  postalCode: string
  latitude: number
  longitude: number
  radiusKm: number
  weight: number
  odisha: boolean
  keonjharTown?: boolean
}

export type MedicineTemplate = {
  genericName: string
  ingredient: string
  strength: number
  strengthUnit: string
  form: string
  category: string
  requiresPrescription: boolean
  basePricePaise: number
}

export type DemoMedicine = {
  id: string
  name: string
  brandName: string
  genericName: string
  manufacturer: string
  description: string
  requiresPrescription: boolean
  isActive: boolean
  tier: 'A' | 'B' | 'C' | 'D'
  basePricePaise: number
  ingredientId: string
  strength: string
  strengthUnit: string
}

export type DemoPharmacy = {
  id: string
  name: string
  description: string
  phone: string
  email: string
  licenseNumber: string
  addressLine1: string
  addressLine2: string | null
  city: string
  district: string
  state: string
  postalCode: string
  latitude: number
  longitude: number
  isVerified: boolean
  isActive: boolean
  partnerStatus: 'ACTIVE'
  inventoryManagementMode: 'MEDICONNECT_MANAGED'
  inventoryTarget: number
  isKeonjharTown: boolean
}

export type DemoInventory = {
  id: string
  pharmacyId: string
  medicineId: string
  quantity: number
  sellingPrice: string
  availability: 'AVAILABLE' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  lastUpdated: string
}

export type DemoManifest = {
  formatVersion: 1
  seed: number
  generatedAt: string
  counts: {
    medicines: number
    pharmacies: number
    inventory: number
    coreTotal: number
    activeIngredients: number
    compositions: number
  }
  geography: {
    odishaPharmacies: number
    odishaDistricts: number
    odishaTowns: number
    kendujharDistrictPharmacies: number
    keonjharTownPharmacies: number
    nationalTowns: number
  }
  inventory: { min: number; median: number; max: number }
  files: Record<string, { records: number; bytes: number; sha256: string }>
}
