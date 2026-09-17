/**
 * Builds the small committed location asset from GeoNames' India postal-code
 * dump (CC BY 4.0). This is a maintainer tool, not part of normal generation.
 * Usage: npx tsx .../buildLocationAsset.ts /path/to/IN.txt
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { DemoLocation } from '../types.js'

type PostalRow = DemoLocation & { accuracy: number; admin3: string; placeName: string }

const priorityOdisha = [
  'Bhubaneswar', 'Cuttack Sadar', 'Keonjhar', 'Kendujhar Town', 'Barbil', 'Joda',
  'Champua', 'Anandapur', 'Ghatgaon', 'Patna', 'Telkoi', 'Harichandanpur',
  'Banspal', 'Rourkela', 'Sambalpur', 'Brahmapur Sadar', 'Puri', 'Balasore',
  'Baripada', 'Bhadrak', 'Jajapur', 'Kendrapara', 'Jagatsinghpur', 'Dhenkanal',
  'Angul', 'Talcher', 'Jharsuguda', 'Bargarh', 'Balangir', 'Titlagarh',
  'Sonapur', 'Nayagarh', 'Khordha', 'Jatni', 'Paradip', 'Rayagada', 'Koraput',
  'Jeypore', 'Malkangiri', 'Nabarangapur', 'Phulbani', 'Boudh', 'Paralakhemundi',
  'Gunupur', 'Sundargarh', 'Rajagangapur',
]

const odishaAliases: Record<string, string> = {
  Bolangir: 'Balangir',
  Ghatgaon: 'Ghatagaon',
  Khordha: 'Khorda',
  Rourkela: 'Raurkela',
  Titlagarh: 'Titilagarh',
}

const majorNational = new Set([
  'Delhi', 'Mumbai', 'Pune City', 'Nagpur', 'Bangalore North', 'Mysore',
  'Hyderabad', 'Chennai', 'Coimbatore', 'Kochi', 'Thiruvananthapuram',
  'Kolkata', 'Howrah', 'Patna Sadar', 'Ranchi', 'Dhalbhum', 'Raipur', 'Huzur',
  'Indore', 'Jaipur', 'Jodhpur', 'Lucknow', 'Kanpur', 'Varanasi', 'Allahabad',
  'Guwahati', 'Shillong', 'Chandigarh', 'Dehradun',
])

function cleanCity(value: string) {
  return value
    .replace(/\b(Sadar|City|North|South|East|West)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function radius(city: string, state: string) {
  if (majorNational.has(city)) return 12
  if (state === 'Odisha' && /Bhubaneswar|Cuttack|Rourkela/i.test(city)) return 8
  return 3.5
}

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('Pass the extracted GeoNames IN.txt path')
  const text = await readFile(input, 'utf8')
  const rows: PostalRow[] = []
  for (const line of text.split('\n')) {
    const f = line.split('\t')
    if (f.length < 12 || !f[7] || f[7] === 'NA') continue
    const latitude = Number(f[9])
    const longitude = Number(f[10])
    const accuracy = Number(f[11])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || accuracy < 1) continue
    rows.push({
      city: cleanCity(f[7]) || cleanCity(f[2]), district: f[5], state: f[3], postalCode: f[1],
      latitude, longitude, accuracy, admin3: f[7], placeName: f[2], radiusKm: radius(f[7], f[3]),
      weight: majorNational.has(f[7]) ? 5 : 1, odisha: f[3] === 'Odisha',
    })
  }

  const best = new Map<string, PostalRow>()
  for (const row of rows) {
    const key = `${row.state}|${row.admin3}`
    const current = best.get(key)
    if (!current || row.accuracy > current.accuracy || (row.accuracy === current.accuracy && row.postalCode < current.postalCode)) {
      best.set(key, row)
    }
  }

  const selected: PostalRow[] = []
  const used = new Set<string>()
  const add = (row: PostalRow | undefined) => {
    if (!row) return
    const key = `${row.state}|${row.admin3}`
    if (!used.has(key)) { used.add(key); selected.push(row) }
  }

  for (const target of priorityOdisha) {
    const lookup = (odishaAliases[target] ?? target).toLowerCase()
    const candidates = [...best.values()].filter((r) => r.state === 'Odisha' && r.admin3.toLowerCase() === lookup)
    const exact = candidates.find((r) => r.district.toLowerCase().includes(lookup)) ?? candidates[0]
    const partial = [...best.values()].find((r) => r.state === 'Odisha' && (r.admin3.toLowerCase().includes(lookup) || lookup.includes(r.admin3.toLowerCase())))
    const place = rows.find((r) => r.state === 'Odisha' && r.placeName.toLowerCase().includes(lookup))
    const match = exact ?? partial ?? place
    add(match && { ...match, city: cleanCity(target), admin3: !exact && !partial ? `priority:${target}` : match.admin3 })
  }
  // Guarantee every Odisha district, then retain 60 Odisha town centres.
  for (const district of [...new Set(rows.filter((r) => r.odisha).map((r) => r.district))].sort()) {
    add([...best.values()].find((r) => r.odisha && r.district === district))
  }
  for (const row of [...best.values()].filter((r) => r.odisha).sort((a, b) => `${a.district}|${a.admin3}`.localeCompare(`${b.district}|${b.admin3}`))) {
    if (selected.filter((r) => r.odisha).length >= 60) break
    add(row)
  }
  for (const target of majorNational) add([...best.values()].find((r) => !r.odisha && r.admin3 === target))
  // Round-robin states to keep the national asset tier-2/tier-3 heavy.
  const byState = new Map<string, PostalRow[]>()
  for (const row of [...best.values()].filter((r) => !r.odisha)) {
    const list = byState.get(row.state) ?? []
    list.push(row); byState.set(row.state, list)
  }
  for (const list of byState.values()) list.sort((a, b) => a.admin3.localeCompare(b.admin3))
  let cursor = 0
  const states = [...byState.keys()].sort()
  while (selected.length < 330) {
    let added = false
    for (const state of states) {
      const row = byState.get(state)?.[cursor]
      if (row) { const before = selected.length; add(row); added ||= selected.length > before }
      if (selected.length >= 330) break
    }
    if (!added && cursor > 1000) throw new Error('Not enough unique locations')
    cursor++
  }

  const asset = selected.map(({ accuracy: _a, admin3: _b, placeName: _c, ...row }) => ({
    ...row,
    keonjharTown: row.state === 'Odisha' && row.city === 'Kendujhar Town',
  }))
  const output = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../data/indiaLocations.json')
  await writeFile(output, `${JSON.stringify(asset, null, 2)}\n`)
  console.log(`Wrote ${asset.length} locations (${asset.filter((r) => r.odisha).length} Odisha) to ${output}`)
}

await main()
