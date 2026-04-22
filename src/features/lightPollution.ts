/**
 * LightPollution — Light pollution measurement, sky quality analysis,
 * and health impact assessment for circadian rhythm disruption.
 *
 * Integrates satellite radiance data, ground sensor readings,
 * and WHO/AMA guidelines on artificial light at night (ALAN).
 */

import { z } from 'zod';

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const SkyQualityReadingSchema = z.object({
  sensorId: z.string().uuid(),
  timestamp: z.string().datetime(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  sqm: z.number().min(5).max(25).describe('Sky Quality Meter magnitude per arcsec^2'),
  bortleClass: z.number().int().min(1).max(9),
  cloudCover: z.number().min(0).max(1).optional(),
  moonPhase: z.number().min(0).max(1).optional(),
  artificialBrightness: z.number().nonnegative().describe('mcd/m^2 above natural'),
  zenithLuminance: z.number().nonnegative().describe('cd/m^2'),
  colorTemperature: z.number().positive().optional().describe('Kelvin'),
});

export const SatelliteRadianceSchema = z.object({
  tileId: z.string(),
  captureDate: z.string().datetime(),
  bounds: z.object({
    north: z.number(), south: z.number(),
    east: z.number(), west: z.number(),
  }),
  radiance: z.number().nonnegative().describe('nW/cm^2/sr from VIIRS DNB'),
  pixelResolution: z.number().positive().describe('meters per pixel'),
  source: z.enum(['VIIRS_DNB', 'DMSP_OLS', 'ISS_PHOTO', 'GROUND_CALIBRATED']),
});

export const CircadianImpactSchema = z.object({
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  assessmentDate: z.string().datetime(),
  blueLight470nm: z.number().nonnegative().describe('Relative blue light exposure (melanopic lux)'),
  melatoninSuppressionPercent: z.number().min(0).max(100),
  circadianDisruptionScore: z.number().min(0).max(10),
  riskFactors: z.array(z.object({
    factor: z.enum([
      'high_cct_streetlights', 'unshielded_fixtures', 'commercial_signage',
      'sky_glow', 'light_trespass', 'glare', 'clutter',
    ]),
    severity: z.enum(['low', 'moderate', 'high', 'extreme']),
    description: z.string(),
  })),
  recommendations: z.array(z.string()),
});

export const LightOrdinanceComplianceSchema = z.object({
  locationId: z.string(),
  assessedAt: z.string().datetime(),
  jurisdiction: z.string(),
  ordinanceName: z.string(),
  fixtures: z.array(z.object({
    fixtureId: z.string(),
    type: z.enum(['streetlight', 'commercial', 'residential', 'billboard', 'parking', 'sports']),
    cctKelvin: z.number(),
    lumens: z.number(),
    shielding: z.enum(['full_cutoff', 'semi_cutoff', 'non_cutoff', 'unshielded']),
    tiltAngle: z.number(),
    compliant: z.boolean(),
    violations: z.array(z.string()),
  })),
  overallCompliance: z.boolean(),
  complianceScore: z.number().min(0).max(100),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SkyQualityReading = z.infer<typeof SkyQualityReadingSchema>;
export type SatelliteRadiance = z.infer<typeof SatelliteRadianceSchema>;
export type CircadianImpact = z.infer<typeof CircadianImpactSchema>;
export type LightOrdinanceCompliance = z.infer<typeof LightOrdinanceComplianceSchema>;

// ─── Constants ─────────────────────────────────────────────────────────────────

const BORTLE_DESCRIPTIONS: Record<number, string> = {
  1: 'Excellent dark-sky site',
  2: 'Typical truly dark site',
  3: 'Rural sky',
  4: 'Rural/suburban transition',
  5: 'Suburban sky',
  6: 'Bright suburban sky',
  7: 'Suburban/urban transition',
  8: 'City sky',
  9: 'Inner-city sky',
};

const MELATONIN_SUPPRESSION_CURVE = [
  { melanopicLux: 1, suppressionPct: 5 },
  { melanopicLux: 5, suppressionPct: 15 },
  { melanopicLux: 10, suppressionPct: 30 },
  { melanopicLux: 30, suppressionPct: 50 },
  { melanopicLux: 100, suppressionPct: 70 },
  { melanopicLux: 300, suppressionPct: 85 },
  { melanopicLux: 1000, suppressionPct: 95 },
];

// ─── Implementation ────────────────────────────────────────────────────────────

/**
 * Convert SQM magnitude to Bortle class
 */
export function sqmToBortle(sqm: number): number {
  if (sqm >= 21.99) return 1;
  if (sqm >= 21.89) return 2;
  if (sqm >= 21.69) return 3;
  if (sqm >= 20.49) return 4;
  if (sqm >= 19.50) return 5;
  if (sqm >= 18.94) return 6;
  if (sqm >= 18.38) return 7;
  if (sqm >= 17.00) return 8;
  return 9;
}

/**
 * Estimate melatonin suppression from melanopic lux exposure at night
 */
export function estimateMelatoninSuppression(melanopicLux: number): number {
  if (melanopicLux <= 0) return 0;

  for (let i = 0; i < MELATONIN_SUPPRESSION_CURVE.length - 1; i++) {
    const curr = MELATONIN_SUPPRESSION_CURVE[i];
    const next = MELATONIN_SUPPRESSION_CURVE[i + 1];
    if (melanopicLux <= next.melanopicLux) {
      const ratio = (Math.log10(melanopicLux) - Math.log10(curr.melanopicLux)) /
                    (Math.log10(next.melanopicLux) - Math.log10(curr.melanopicLux));
      return curr.suppressionPct + ratio * (next.suppressionPct - curr.suppressionPct);
    }
  }

  return 98; // Very high exposure
}

/**
 * Calculate melanopic lux from spectral data and color temperature
 */
export function estimateMelanopicLux(
  photopicLux: number,
  cctKelvin: number
): number {
  // Melanopic/photopic ratio approximation based on CCT
  // Higher CCT (bluer light) = higher melanopic content
  const ratio = cctKelvin <= 2700 ? 0.45
    : cctKelvin <= 3000 ? 0.55
    : cctKelvin <= 4000 ? 0.75
    : cctKelvin <= 5000 ? 0.90
    : cctKelvin <= 6500 ? 1.10
    : 1.25;

  return photopicLux * ratio;
}

/**
 * Assess circadian rhythm disruption risk for a location
 */
export function assessCircadianImpact(
  readings: SkyQualityReading[],
  avgCctKelvin: number = 4000
): CircadianImpact {
  const location = readings[0]?.location ?? { latitude: 0, longitude: 0 };

  const avgArtificialBrightness = readings.reduce(
    (sum, r) => sum + r.artificialBrightness, 0
  ) / readings.length;

  // Convert artificial sky brightness (mcd/m^2) to approximate ground-level lux
  const approxGroundLux = avgArtificialBrightness * 0.01;
  const melanopicLux = estimateMelanopicLux(approxGroundLux, avgCctKelvin);
  const suppressionPct = estimateMelatoninSuppression(melanopicLux);

  const circadianScore = Math.min(10, suppressionPct / 10);

  const riskFactors: CircadianImpact['riskFactors'] = [];
  if (avgCctKelvin > 4000) {
    riskFactors.push({
      factor: 'high_cct_streetlights',
      severity: avgCctKelvin > 6000 ? 'extreme' : avgCctKelvin > 5000 ? 'high' : 'moderate',
      description: `Average CCT of ${avgCctKelvin}K exceeds IDA recommendation of 3000K maximum`,
    });
  }

  const avgBortle = readings.reduce((sum, r) => sum + r.bortleClass, 0) / readings.length;
  if (avgBortle >= 7) {
    riskFactors.push({
      factor: 'sky_glow',
      severity: avgBortle >= 9 ? 'extreme' : 'high',
      description: `Bortle class ${Math.round(avgBortle)}: ${BORTLE_DESCRIPTIONS[Math.round(avgBortle)]}`,
    });
  }

  const recommendations: string[] = [];
  if (avgCctKelvin > 3000) {
    recommendations.push(`Replace streetlights with warm-white LEDs (2700K or below) to reduce melanopic content by ${Math.round((1 - 0.45 / (avgCctKelvin <= 4000 ? 0.75 : 1.1)) * 100)}%`);
  }
  if (avgBortle >= 6) {
    recommendations.push('Install full-cutoff shielding on all outdoor fixtures to reduce sky glow');
  }
  if (suppressionPct > 30) {
    recommendations.push('Implement curfew dimming (11 PM - 6 AM) to reduce nighttime light levels by 50%+');
  }
  recommendations.push('Adopt IDA/IES Model Lighting Ordinance for new developments');

  return {
    location,
    assessmentDate: new Date().toISOString(),
    blueLight470nm: Math.round(melanopicLux * 100) / 100,
    melatoninSuppressionPercent: Math.round(suppressionPct * 10) / 10,
    circadianDisruptionScore: Math.round(circadianScore * 10) / 10,
    riskFactors,
    recommendations,
  };
}

/**
 * Aggregate satellite radiance data to produce a light pollution heatmap grid
 */
export function aggregateRadianceGrid(
  tiles: SatelliteRadiance[],
  gridResolution: number = 0.01 // degrees
): Map<string, { avgRadiance: number; tileCount: number }> {
  const grid = new Map<string, { totalRadiance: number; count: number }>();

  for (const tile of tiles) {
    const centerLat = (tile.bounds.north + tile.bounds.south) / 2;
    const centerLon = (tile.bounds.east + tile.bounds.west) / 2;

    const gridLat = Math.round(centerLat / gridResolution) * gridResolution;
    const gridLon = Math.round(centerLon / gridResolution) * gridResolution;
    const key = `${gridLat.toFixed(4)},${gridLon.toFixed(4)}`;

    const existing = grid.get(key) ?? { totalRadiance: 0, count: 0 };
    existing.totalRadiance += tile.radiance;
    existing.count += 1;
    grid.set(key, existing);
  }

  const result = new Map<string, { avgRadiance: number; tileCount: number }>();
  for (const [key, value] of grid) {
    result.set(key, {
      avgRadiance: Math.round((value.totalRadiance / value.count) * 100) / 100,
      tileCount: value.count,
    });
  }

  return result;
}

/**
 * Check fixture compliance against a light pollution ordinance
 */
export function checkFixtureCompliance(
  fixture: LightOrdinanceCompliance['fixtures'][0],
  maxCct: number = 3000,
  maxLumens: Record<string, number> = {
    streetlight: 15000, commercial: 20000, residential: 5000,
    billboard: 10000, parking: 15000, sports: 200000,
  }
): { compliant: boolean; violations: string[] } {
  const violations: string[] = [];

  if (fixture.cctKelvin > maxCct) {
    violations.push(`CCT ${fixture.cctKelvin}K exceeds maximum ${maxCct}K`);
  }
  if (fixture.shielding === 'unshielded' || fixture.shielding === 'non_cutoff') {
    violations.push(`${fixture.shielding} fixture type not permitted; full-cutoff required`);
  }
  if (fixture.tiltAngle > 0) {
    violations.push(`Upward tilt of ${fixture.tiltAngle} degrees; must be 0 or negative`);
  }
  const maxLumen = maxLumens[fixture.type] ?? 10000;
  if (fixture.lumens > maxLumen) {
    violations.push(`${fixture.lumens} lumens exceeds ${maxLumen} maximum for ${fixture.type}`);
  }

  return { compliant: violations.length === 0, violations };
}
