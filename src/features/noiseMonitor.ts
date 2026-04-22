/**
 * NoiseMonitor — Community noise pollution monitoring and health impact analysis
 *
 * Real-time decibel measurement from community sensor networks,
 * health impact estimation using WHO noise exposure guidelines,
 * and automated complaint generation for municipalities.
 */

import { z } from 'zod';

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const GeoCoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
});

export const NoiseSensorReadingSchema = z.object({
  sensorId: z.string().uuid(),
  timestamp: z.string().datetime(),
  location: GeoCoordinateSchema,
  decibelLevel: z.number().min(0).max(194),
  decibelWeighting: z.enum(['A', 'C', 'Z']),
  frequencySpectrum: z.array(z.object({
    frequencyHz: z.number(),
    amplitudeDb: z.number(),
  })).optional(),
  sourceClassification: z.enum([
    'traffic', 'construction', 'industrial', 'aircraft',
    'nightlife', 'neighbor', 'nature', 'unknown',
  ]).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  duration: z.number().positive().describe('Duration in seconds'),
});

export const HealthImpactAssessmentSchema = z.object({
  location: GeoCoordinateSchema,
  period: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  averageDbA: z.number(),
  peakDbA: z.number(),
  ldenScore: z.number().describe('Day-evening-night noise level indicator'),
  lnightScore: z.number().describe('Night noise level indicator'),
  healthRisks: z.array(z.object({
    condition: z.enum([
      'cardiovascular', 'sleep_disruption', 'hearing_loss',
      'cognitive_impairment', 'stress_response', 'tinnitus',
      'hypertension', 'annoyance',
    ]),
    riskLevel: z.enum(['low', 'moderate', 'high', 'severe']),
    relativeRisk: z.number(),
    exposureThresholdDbA: z.number(),
    whoGuideline: z.string(),
  })),
  populationAtRisk: z.number().int().nonnegative(),
  estimatedDALYsPerYear: z.number().describe('Disability-adjusted life years'),
});

export const NoiseComplaintSchema = z.object({
  id: z.string().uuid(),
  generatedAt: z.string().datetime(),
  complainantId: z.string().optional(),
  location: GeoCoordinateSchema,
  address: z.string(),
  municipality: z.string(),
  violationType: z.enum([
    'residential_nighttime', 'residential_daytime',
    'commercial', 'industrial', 'construction',
    'entertainment', 'traffic', 'aircraft',
  ]),
  evidenceSummary: z.object({
    readingCount: z.number().int(),
    averageDbA: z.number(),
    peakDbA: z.number(),
    exceedanceMinutes: z.number(),
    applicableOrdinance: z.string(),
    ordinanceLimit: z.number(),
  }),
  narrativeText: z.string(),
  attachments: z.array(z.string().url()).optional(),
  status: z.enum(['draft', 'submitted', 'acknowledged', 'investigating', 'resolved', 'dismissed']),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GeoCoordinate = z.infer<typeof GeoCoordinateSchema>;
export type NoiseSensorReading = z.infer<typeof NoiseSensorReadingSchema>;
export type HealthImpactAssessment = z.infer<typeof HealthImpactAssessmentSchema>;
export type NoiseComplaint = z.infer<typeof NoiseComplaintSchema>;

// ─── WHO Noise Guidelines ──────────────────────────────────────────────────────

const WHO_GUIDELINES = {
  road_traffic: { ldenDbA: 53, lnightDbA: 45 },
  railway: { ldenDbA: 54, lnightDbA: 44 },
  aircraft: { ldenDbA: 45, lnightDbA: 40 },
  wind_turbine: { ldenDbA: 45, lnightDbA: null },
  leisure: { instantMaxDbA: 110 },
} as const;

const HEALTH_RISK_THRESHOLDS = [
  { condition: 'annoyance' as const, thresholdDbA: 42, riskPerDb: 0.02 },
  { condition: 'sleep_disruption' as const, thresholdDbA: 40, riskPerDb: 0.025 },
  { condition: 'cardiovascular' as const, thresholdDbA: 53, riskPerDb: 0.015 },
  { condition: 'hypertension' as const, thresholdDbA: 50, riskPerDb: 0.018 },
  { condition: 'hearing_loss' as const, thresholdDbA: 80, riskPerDb: 0.03 },
  { condition: 'cognitive_impairment' as const, thresholdDbA: 55, riskPerDb: 0.012 },
  { condition: 'stress_response' as const, thresholdDbA: 45, riskPerDb: 0.02 },
  { condition: 'tinnitus' as const, thresholdDbA: 75, riskPerDb: 0.025 },
];

// ─── Implementation ────────────────────────────────────────────────────────────

/**
 * Classify a noise source from frequency spectrum analysis
 */
export function classifyNoiseSource(
  frequencySpectrum: { frequencyHz: number; amplitudeDb: number }[]
): { source: NoiseSensorReading['sourceClassification']; confidence: number } {
  if (frequencySpectrum.length === 0) {
    return { source: 'unknown', confidence: 0 };
  }

  const lowFreqEnergy = frequencySpectrum
    .filter(f => f.frequencyHz < 250)
    .reduce((sum, f) => sum + Math.pow(10, f.amplitudeDb / 10), 0);

  const midFreqEnergy = frequencySpectrum
    .filter(f => f.frequencyHz >= 250 && f.frequencyHz < 2000)
    .reduce((sum, f) => sum + Math.pow(10, f.amplitudeDb / 10), 0);

  const highFreqEnergy = frequencySpectrum
    .filter(f => f.frequencyHz >= 2000)
    .reduce((sum, f) => sum + Math.pow(10, f.amplitudeDb / 10), 0);

  const totalEnergy = lowFreqEnergy + midFreqEnergy + highFreqEnergy;
  if (totalEnergy === 0) return { source: 'unknown', confidence: 0 };

  const lowRatio = lowFreqEnergy / totalEnergy;
  const midRatio = midFreqEnergy / totalEnergy;
  const highRatio = highFreqEnergy / totalEnergy;

  if (lowRatio > 0.6) return { source: 'traffic', confidence: 0.75 };
  if (lowRatio > 0.5 && midRatio > 0.3) return { source: 'construction', confidence: 0.65 };
  if (midRatio > 0.5 && highRatio > 0.3) return { source: 'nightlife', confidence: 0.6 };
  if (highRatio > 0.5) return { source: 'industrial', confidence: 0.55 };

  return { source: 'unknown', confidence: 0.3 };
}

/**
 * Calculate Lden (day-evening-night noise level) from 24h readings
 */
export function calculateLden(readings: NoiseSensorReading[]): number {
  const dayReadings = readings.filter(r => {
    const hour = new Date(r.timestamp).getUTCHours();
    return hour >= 7 && hour < 19;
  });
  const eveningReadings = readings.filter(r => {
    const hour = new Date(r.timestamp).getUTCHours();
    return hour >= 19 && hour < 23;
  });
  const nightReadings = readings.filter(r => {
    const hour = new Date(r.timestamp).getUTCHours();
    return hour >= 23 || hour < 7;
  });

  const avgEnergy = (readings: NoiseSensorReading[]) => {
    if (readings.length === 0) return 0;
    const sum = readings.reduce((acc, r) => acc + Math.pow(10, r.decibelLevel / 10), 0);
    return sum / readings.length;
  };

  const lDay = 10 * Math.log10(avgEnergy(dayReadings) || 1);
  const lEvening = 10 * Math.log10(avgEnergy(eveningReadings) || 1);
  const lNight = 10 * Math.log10(avgEnergy(nightReadings) || 1);

  const lden = 10 * Math.log10(
    (12 * Math.pow(10, lDay / 10) +
     4 * Math.pow(10, (lEvening + 5) / 10) +
     8 * Math.pow(10, (lNight + 10) / 10)) / 24
  );

  return Math.round(lden * 10) / 10;
}

/**
 * Assess health impacts for a location based on cumulative noise exposure
 */
export function assessHealthImpact(
  readings: NoiseSensorReading[],
  populationCount: number
): HealthImpactAssessment {
  const location = readings[0]?.location ?? { latitude: 0, longitude: 0 };
  const timestamps = readings.map(r => new Date(r.timestamp).getTime());
  const dbLevels = readings.map(r => r.decibelLevel);

  const avgDbA = dbLevels.reduce((a, b) => a + b, 0) / dbLevels.length;
  const peakDbA = Math.max(...dbLevels);
  const ldenScore = calculateLden(readings);

  const nightReadings = readings.filter(r => {
    const hour = new Date(r.timestamp).getUTCHours();
    return hour >= 23 || hour < 7;
  });
  const lnightScore = nightReadings.length > 0
    ? 10 * Math.log10(
        nightReadings.reduce((sum, r) => sum + Math.pow(10, r.decibelLevel / 10), 0) /
        nightReadings.length
      )
    : 0;

  const healthRisks = HEALTH_RISK_THRESHOLDS
    .filter(t => avgDbA > t.thresholdDbA)
    .map(t => {
      const excessDb = avgDbA - t.thresholdDbA;
      const relativeRisk = 1 + (excessDb * t.riskPerDb);
      const riskLevel = relativeRisk < 1.1 ? 'low' as const
        : relativeRisk < 1.3 ? 'moderate' as const
        : relativeRisk < 1.5 ? 'high' as const
        : 'severe' as const;

      return {
        condition: t.condition,
        riskLevel,
        relativeRisk: Math.round(relativeRisk * 100) / 100,
        exposureThresholdDbA: t.thresholdDbA,
        whoGuideline: `WHO recommends <${t.thresholdDbA} dB(A) to prevent ${t.condition.replace('_', ' ')}`,
      };
    });

  const estimatedDALYsPerYear = healthRisks.reduce((total, risk) => {
    const weight = risk.riskLevel === 'severe' ? 0.05
      : risk.riskLevel === 'high' ? 0.03
      : risk.riskLevel === 'moderate' ? 0.015
      : 0.005;
    return total + (populationCount * weight);
  }, 0);

  return {
    location,
    period: {
      start: new Date(Math.min(...timestamps)).toISOString(),
      end: new Date(Math.max(...timestamps)).toISOString(),
    },
    averageDbA: Math.round(avgDbA * 10) / 10,
    peakDbA,
    ldenScore,
    lnightScore: Math.round(lnightScore * 10) / 10,
    healthRisks,
    populationAtRisk: populationCount,
    estimatedDALYsPerYear: Math.round(estimatedDALYsPerYear),
  };
}

/**
 * Generate an evidence-based noise complaint for municipal submission
 */
export function generateNoiseComplaint(
  readings: NoiseSensorReading[],
  address: string,
  municipality: string,
  ordinanceLimit: number,
  applicableOrdinance: string
): NoiseComplaint {
  const exceedingReadings = readings.filter(r => r.decibelLevel > ordinanceLimit);
  const avgDbA = readings.reduce((sum, r) => sum + r.decibelLevel, 0) / readings.length;
  const peakDbA = Math.max(...readings.map(r => r.decibelLevel));

  const exceedanceMinutes = exceedingReadings.reduce((sum, r) => sum + r.duration, 0) / 60;

  const nightHours = readings.some(r => {
    const hour = new Date(r.timestamp).getUTCHours();
    return hour >= 22 || hour < 7;
  });

  const dominantSource = readings
    .filter(r => r.sourceClassification)
    .reduce((acc, r) => {
      const src = r.sourceClassification!;
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const topSource = Object.entries(dominantSource).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'unknown';

  const violationType = nightHours
    ? topSource === 'traffic' ? 'traffic' as const
      : topSource === 'construction' ? 'construction' as const
      : topSource === 'nightlife' ? 'entertainment' as const
      : 'residential_nighttime' as const
    : topSource === 'industrial' ? 'industrial' as const
      : topSource === 'construction' ? 'construction' as const
      : 'residential_daytime' as const;

  const narrative = [
    `Noise complaint for ${address}, ${municipality}.`,
    `Over the monitoring period, ${readings.length} sensor readings were collected.`,
    `The average noise level was ${avgDbA.toFixed(1)} dB(A), with a peak of ${peakDbA.toFixed(1)} dB(A).`,
    `The applicable ordinance (${applicableOrdinance}) sets a limit of ${ordinanceLimit} dB(A).`,
    `This limit was exceeded for approximately ${exceedanceMinutes.toFixed(0)} minutes across ${exceedingReadings.length} readings.`,
    `The dominant noise source was classified as "${topSource}".`,
    nightHours ? 'Violations occurred during protected nighttime hours (10 PM - 7 AM).' : '',
    `This sustained noise exposure poses health risks including sleep disruption and cardiovascular stress per WHO Environmental Noise Guidelines (2018).`,
  ].filter(Boolean).join(' ');

  return {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    location: readings[0]?.location ?? { latitude: 0, longitude: 0 },
    address,
    municipality,
    violationType,
    evidenceSummary: {
      readingCount: readings.length,
      averageDbA: Math.round(avgDbA * 10) / 10,
      peakDbA,
      exceedanceMinutes: Math.round(exceedanceMinutes),
      applicableOrdinance,
      ordinanceLimit,
    },
    narrativeText: narrative,
    status: 'draft',
  };
}
