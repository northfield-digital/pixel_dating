/**
 * Country reference data: name in supported languages and area in km².
 * Used to compute country-level occupancy on the map.
 *
 * area_km2 numbers are rounded; precision is irrelevant compared to the
 * density assumption (DENSITY_CEILING_PER_KM2) used in occupancy.
 */
export interface Country {
  code: string;
  area_km2: number;
  name: { en: string; es: string; pt: string };
}

export const COUNTRIES: Record<string, Country> = {
  ES: { code: 'ES', area_km2: 505_990, name: { en: 'Spain', es: 'España', pt: 'Espanha' } },
  CH: { code: 'CH', area_km2: 41_285,  name: { en: 'Switzerland', es: 'Suiza', pt: 'Suíça' } },
  AR: { code: 'AR', area_km2: 2_780_400, name: { en: 'Argentina', es: 'Argentina', pt: 'Argentina' } },
  MX: { code: 'MX', area_km2: 1_964_375, name: { en: 'Mexico', es: 'México', pt: 'México' } },
};

// With a 20 m minimum distance, each pixel "owns" a disc of ~1257 m².
// Real-world pixels cluster in habitable areas, so the practical ceiling
// is much lower. 800 pixels/km² is a generous habitable-density cap.
export const DENSITY_CEILING_PER_KM2 = 800;

export function countryName(code: string, lang: 'en' | 'es' | 'pt' = 'en'): string {
  const c = COUNTRIES[code];
  if (!c) return code;
  return c.name[lang] ?? c.name.en;
}

export function isSupportedCountry(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(COUNTRIES, code);
}
