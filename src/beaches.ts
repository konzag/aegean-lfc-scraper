// src/beaches.ts
// Editorial allowlist of European (non-Greek) summer/beach destinations.
//
// There is NO "beach" attribute in the API (region is only gr|eu|rs), so this
// is necessarily curated. The EFFECTIVE set per origin is always the
// intersection:  this allowlist  ∩  {region === 'eu'}  ∩  {live enumeration}
// (and optionally ∩ {direct === true}). So codes that Aegean does not serve
// nonstop from a given origin simply never produce calls — unknown codes are
// harmless. Extend freely.

export const BEACH_IATA = new Set<string>([
  // --- Spain (mainland coast + islands) ---
  'BCN', // Barcelona
  'AGP', // Málaga (Costa del Sol)
  'VLC', // Valencia
  'ALC', // Alicante (Costa Blanca)
  'PMI', // Palma de Mallorca
  'IBZ', // Ibiza
  'MAH', // Menorca
  'TFS', 'TFN', // Tenerife (Canaries)
  'LPA', // Gran Canaria
  'ACE', // Lanzarote

  // --- Italy (coast + islands) ---
  'NAP', // Naples (Amalfi / Capri)
  'CTA', // Catania (Sicily)
  'PMO', // Palermo (Sicily)
  'CAG', // Cagliari (Sardinia)
  'OLB', // Olbia (Costa Smeralda)
  'BRI', // Bari (Puglia)
  'BDS', // Brindisi (Salento)

  // --- France (Riviera + Corsica) ---
  'NCE', // Nice (Côte d'Azur)
  'MRS', // Marseille (Provence coast)
  'AJA', 'BIA', 'FSC', // Corsica

  // --- Croatia (Adriatic) ---
  'DBV', // Dubrovnik
  'SPU', // Split
  'ZAD', // Zadar
  'PUY', // Pula

  // --- Portugal ---
  'FAO', // Faro (Algarve)
  'LIS', // Lisbon (Cascais/Costa beaches nearby)
  'OPO', // Porto

  // --- Cyprus ---
  'LCA', // Larnaca
  'PFO', // Paphos

  // --- Malta ---
  'MLA',
]);

export function isBeach(iata: string): boolean {
  return BEACH_IATA.has(String(iata).toUpperCase());
}
