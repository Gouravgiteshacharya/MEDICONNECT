import type { MedicineTemplate } from '../types.js'

type Family = Omit<MedicineTemplate, 'strength'> & { strengths: number[] }

// Curated single-ingredient formulations only. Expanding brand/manufacturer
// variants never creates new combinations of active ingredients.
const families: Family[] = [
  { genericName: 'Paracetamol', ingredient: 'Paracetamol', strengths: [500, 650], strengthUnit: 'mg', form: 'tablet', category: 'fever/pain relief', requiresPrescription: false, basePricePaise: 2800 },
  { genericName: 'Ibuprofen', ingredient: 'Ibuprofen', strengths: [200, 400], strengthUnit: 'mg', form: 'tablet', category: 'fever/pain relief', requiresPrescription: false, basePricePaise: 4200 },
  { genericName: 'Diclofenac', ingredient: 'Diclofenac', strengths: [50, 75], strengthUnit: 'mg', form: 'tablet', category: 'fever/pain relief', requiresPrescription: true, basePricePaise: 6800 },
  { genericName: 'Aceclofenac', ingredient: 'Aceclofenac', strengths: [100, 200], strengthUnit: 'mg', form: 'tablet', category: 'fever/pain relief', requiresPrescription: true, basePricePaise: 9200 },
  { genericName: 'Pantoprazole', ingredient: 'Pantoprazole', strengths: [20, 40], strengthUnit: 'mg', form: 'tablet', category: 'gastrointestinal', requiresPrescription: true, basePricePaise: 7600 },
  { genericName: 'Omeprazole', ingredient: 'Omeprazole', strengths: [20, 40], strengthUnit: 'mg', form: 'capsule', category: 'gastrointestinal', requiresPrescription: true, basePricePaise: 6400 },
  { genericName: 'Famotidine', ingredient: 'Famotidine', strengths: [20, 40], strengthUnit: 'mg', form: 'tablet', category: 'gastrointestinal', requiresPrescription: false, basePricePaise: 4800 },
  { genericName: 'Ondansetron', ingredient: 'Ondansetron', strengths: [4, 8], strengthUnit: 'mg', form: 'tablet', category: 'gastrointestinal', requiresPrescription: true, basePricePaise: 7800 },
  { genericName: 'Cetirizine', ingredient: 'Cetirizine', strengths: [5, 10], strengthUnit: 'mg', form: 'tablet', category: 'allergy', requiresPrescription: false, basePricePaise: 3600 },
  { genericName: 'Levocetirizine', ingredient: 'Levocetirizine', strengths: [2.5, 5], strengthUnit: 'mg', form: 'tablet', category: 'allergy', requiresPrescription: false, basePricePaise: 5200 },
  { genericName: 'Fexofenadine', ingredient: 'Fexofenadine', strengths: [120, 180], strengthUnit: 'mg', form: 'tablet', category: 'allergy', requiresPrescription: true, basePricePaise: 13200 },
  { genericName: 'Montelukast', ingredient: 'Montelukast', strengths: [4, 10], strengthUnit: 'mg', form: 'tablet', category: 'respiratory', requiresPrescription: true, basePricePaise: 14800 },
  { genericName: 'Salbutamol', ingredient: 'Salbutamol', strengths: [2, 4], strengthUnit: 'mg', form: 'tablet', category: 'respiratory', requiresPrescription: true, basePricePaise: 4600 },
  { genericName: 'Budesonide', ingredient: 'Budesonide', strengths: [100, 200], strengthUnit: 'mcg/dose', form: 'inhaler', category: 'respiratory', requiresPrescription: true, basePricePaise: 28500 },
  { genericName: 'Azithromycin', ingredient: 'Azithromycin', strengths: [250, 500], strengthUnit: 'mg', form: 'tablet', category: 'antibiotics', requiresPrescription: true, basePricePaise: 13800 },
  { genericName: 'Amoxicillin', ingredient: 'Amoxicillin', strengths: [250, 500], strengthUnit: 'mg', form: 'capsule', category: 'antibiotics', requiresPrescription: true, basePricePaise: 11200 },
  { genericName: 'Cefixime', ingredient: 'Cefixime', strengths: [100, 200], strengthUnit: 'mg', form: 'tablet', category: 'antibiotics', requiresPrescription: true, basePricePaise: 17600 },
  { genericName: 'Doxycycline', ingredient: 'Doxycycline', strengths: [50, 100], strengthUnit: 'mg', form: 'capsule', category: 'antibiotics', requiresPrescription: true, basePricePaise: 9600 },
  { genericName: 'Metformin', ingredient: 'Metformin', strengths: [500, 1000], strengthUnit: 'mg', form: 'tablet', category: 'diabetes', requiresPrescription: true, basePricePaise: 7200 },
  { genericName: 'Glimepiride', ingredient: 'Glimepiride', strengths: [1, 2], strengthUnit: 'mg', form: 'tablet', category: 'diabetes', requiresPrescription: true, basePricePaise: 9800 },
  { genericName: 'Sitagliptin', ingredient: 'Sitagliptin', strengths: [50, 100], strengthUnit: 'mg', form: 'tablet', category: 'diabetes', requiresPrescription: true, basePricePaise: 32800 },
  { genericName: 'Amlodipine', ingredient: 'Amlodipine', strengths: [5, 10], strengthUnit: 'mg', form: 'tablet', category: 'hypertension', requiresPrescription: true, basePricePaise: 5400 },
  { genericName: 'Telmisartan', ingredient: 'Telmisartan', strengths: [20, 40], strengthUnit: 'mg', form: 'tablet', category: 'hypertension', requiresPrescription: true, basePricePaise: 12600 },
  { genericName: 'Losartan', ingredient: 'Losartan', strengths: [25, 50], strengthUnit: 'mg', form: 'tablet', category: 'hypertension', requiresPrescription: true, basePricePaise: 9800 },
  { genericName: 'Metoprolol', ingredient: 'Metoprolol', strengths: [25, 50], strengthUnit: 'mg', form: 'tablet', category: 'cardiac', requiresPrescription: true, basePricePaise: 11800 },
  { genericName: 'Atorvastatin', ingredient: 'Atorvastatin', strengths: [10, 20], strengthUnit: 'mg', form: 'tablet', category: 'cardiac', requiresPrescription: true, basePricePaise: 14200 },
  { genericName: 'Rosuvastatin', ingredient: 'Rosuvastatin', strengths: [5, 10], strengthUnit: 'mg', form: 'tablet', category: 'cardiac', requiresPrescription: true, basePricePaise: 17600 },
  { genericName: 'Clopidogrel', ingredient: 'Clopidogrel', strengths: [75, 150], strengthUnit: 'mg', form: 'tablet', category: 'cardiac', requiresPrescription: true, basePricePaise: 18400 },
  { genericName: 'Levothyroxine', ingredient: 'Levothyroxine', strengths: [25, 50], strengthUnit: 'mcg', form: 'tablet', category: 'thyroid', requiresPrescription: true, basePricePaise: 11800 },
  { genericName: 'Carbimazole', ingredient: 'Carbimazole', strengths: [5, 10], strengthUnit: 'mg', form: 'tablet', category: 'thyroid', requiresPrescription: true, basePricePaise: 8400 },
  { genericName: 'Clotrimazole', ingredient: 'Clotrimazole', strengths: [1, 2], strengthUnit: '% w/w', form: 'cream', category: 'dermatology', requiresPrescription: false, basePricePaise: 8600 },
  { genericName: 'Mupirocin', ingredient: 'Mupirocin', strengths: [1, 2], strengthUnit: '% w/w', form: 'ointment', category: 'dermatology', requiresPrescription: true, basePricePaise: 16800 },
  { genericName: 'Calamine', ingredient: 'Calamine', strengths: [8, 15], strengthUnit: '% w/v', form: 'lotion', category: 'dermatology', requiresPrescription: false, basePricePaise: 9200 },
  { genericName: 'Cholecalciferol', ingredient: 'Cholecalciferol', strengths: [1000, 60000], strengthUnit: 'IU', form: 'capsule', category: 'vitamins/minerals', requiresPrescription: false, basePricePaise: 14800 },
  { genericName: 'Calcium Carbonate', ingredient: 'Calcium Carbonate', strengths: [500, 1250], strengthUnit: 'mg', form: 'tablet', category: 'vitamins/minerals', requiresPrescription: false, basePricePaise: 12400 },
  { genericName: 'Ferrous Ascorbate', ingredient: 'Ferrous Ascorbate', strengths: [50, 100], strengthUnit: 'mg', form: 'tablet', category: "women's health", requiresPrescription: true, basePricePaise: 13200 },
  { genericName: 'Folic Acid', ingredient: 'Folic Acid', strengths: [1, 5], strengthUnit: 'mg', form: 'tablet', category: "women's health", requiresPrescription: false, basePricePaise: 4200 },
  { genericName: 'Progesterone', ingredient: 'Progesterone', strengths: [100, 200], strengthUnit: 'mg', form: 'capsule', category: "women's health", requiresPrescription: true, basePricePaise: 28600 },
  { genericName: 'Moxifloxacin', ingredient: 'Moxifloxacin', strengths: [0.3, 0.5], strengthUnit: '% w/v', form: 'eye drops', category: 'eye/ear preparations', requiresPrescription: true, basePricePaise: 14600 },
  { genericName: 'Carboxymethylcellulose', ingredient: 'Carboxymethylcellulose', strengths: [0.5, 1], strengthUnit: '% w/v', form: 'eye drops', category: 'eye/ear preparations', requiresPrescription: false, basePricePaise: 12800 },
  { genericName: 'Ciprofloxacin', ingredient: 'Ciprofloxacin', strengths: [0.2, 0.3], strengthUnit: '% w/v', form: 'ear drops', category: 'eye/ear preparations', requiresPrescription: true, basePricePaise: 11800 },
  { genericName: 'Paracetamol Paediatric', ingredient: 'Paracetamol', strengths: [120, 250], strengthUnit: 'mg/5mL', form: 'suspension', category: 'pediatric formulations', requiresPrescription: false, basePricePaise: 6800 },
  { genericName: 'Zinc Sulphate', ingredient: 'Zinc Sulphate', strengths: [10, 20], strengthUnit: 'mg/5mL', form: 'syrup', category: 'pediatric formulations', requiresPrescription: false, basePricePaise: 7400 },
  { genericName: 'Lactulose', ingredient: 'Lactulose', strengths: [3.3, 10], strengthUnit: 'g/15mL', form: 'solution', category: 'gastrointestinal', requiresPrescription: false, basePricePaise: 13800 },
  { genericName: 'Ambroxol', ingredient: 'Ambroxol', strengths: [15, 30], strengthUnit: 'mg/5mL', form: 'syrup', category: 'respiratory', requiresPrescription: false, basePricePaise: 9200 },
  { genericName: 'Dextromethorphan', ingredient: 'Dextromethorphan', strengths: [10, 15], strengthUnit: 'mg/5mL', form: 'syrup', category: 'respiratory', requiresPrescription: false, basePricePaise: 9800 },
  { genericName: 'Povidone Iodine', ingredient: 'Povidone Iodine', strengths: [5, 10], strengthUnit: '% w/v', form: 'solution', category: 'first aid/wellness', requiresPrescription: false, basePricePaise: 8800 },
  { genericName: 'Oral Rehydration Salts', ingredient: 'Oral Rehydration Salts', strengths: [21, 27.9], strengthUnit: 'g/sachet', form: 'powder', category: 'gastrointestinal', requiresPrescription: false, basePricePaise: 2400 },
  { genericName: 'Ascorbic Acid', ingredient: 'Ascorbic Acid', strengths: [250, 500], strengthUnit: 'mg', form: 'tablet', category: 'vitamins/minerals', requiresPrescription: false, basePricePaise: 6200 },
  { genericName: 'Cyanocobalamin', ingredient: 'Cyanocobalamin', strengths: [500, 1500], strengthUnit: 'mcg', form: 'tablet', category: 'vitamins/minerals', requiresPrescription: false, basePricePaise: 9800 },
]

export const medicineTemplates: MedicineTemplate[] = families.flatMap((family) =>
  family.strengths.map((strength) => ({ ...family, strength, strengths: undefined })),
).map(({ strengths: _strengths, ...template }) => template as MedicineTemplate)

if (medicineTemplates.length !== 100) {
  throw new Error(`Medicine catalogue must contain 100 formulations; found ${medicineTemplates.length}`)
}
