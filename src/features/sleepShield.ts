/**
 * SleepShield — Personalized sleep protection system combining
 * noise and light pollution data with individual health profiles
 * to generate actionable sleep quality interventions.
 */

import { z } from 'zod';

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const SleepProfileSchema = z.object({
  userId: z.string().uuid(),
  age: z.number().int().min(0).max(150),
  chronotype: z.enum(['early_bird', 'intermediate', 'night_owl']),
  sleepDisorders: z.array(z.enum([
    'insomnia', 'sleep_apnea', 'restless_leg', 'narcolepsy',
    'circadian_rhythm_disorder', 'none',
  ])),
  sensitivityToNoise: z.enum(['low', 'moderate', 'high', 'extreme']),
  sensitivityToLight: z.enum(['low', 'moderate', 'high', 'extreme']),
  medications: z.array(z.string()).optional(),
  targetSleepHours: z.number().min(4).max(12).default(8),
  bedtimeWindow: z.object({
    earliest: z.string().regex(/^\d{2}:\d{2}$/),
    latest: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  wakeWindow: z.object({
    earliest: z.string().regex(/^\d{2}:\d{2}$/),
    latest: z.string().regex(/^\d{2}:\d{2}$/),
  }),
});

export const EnvironmentalSnapshotSchema = z.object({
  timestamp: z.string().datetime(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    floor: z.number().int().optional(),
    facingDirection: z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).optional(),
  }),
  outdoorNoiseDbA: z.number().min(0).max(150),
  indoorNoiseDbA: z.number().min(0).max(120).optional(),
  outdoorLightLux: z.number().nonnegative(),
  indoorLightLux: z.number().nonnegative().optional(),
  temperature: z.number().min(-50).max(60).optional(),
  humidity: z.number().min(0).max(100).optional(),
});

export const SleepRiskReportSchema = z.object({
  userId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  overallRisk: z.enum(['minimal', 'low', 'moderate', 'high', 'severe']),
  overallScore: z.number().min(0).max(100),
  noiseRisk: z.object({
    score: z.number().min(0).max(100),
    peakEvents: z.number().int(),
    avgNightDbA: z.number(),
    worstHour: z.string().optional(),
    primarySources: z.array(z.string()),
  }),
  lightRisk: z.object({
    score: z.number().min(0).max(100),
    avgNightLux: z.number(),
    blueExposure: z.enum(['low', 'moderate', 'high']),
    lightIntrusion: z.boolean(),
  }),
  interventions: z.array(z.object({
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    category: z.enum(['noise_barrier', 'light_blocking', 'timing', 'environment', 'behavioral', 'community_action']),
    title: z.string(),
    description: z.string(),
    estimatedImprovement: z.number().min(0).max(100).describe('Estimated % improvement in sleep quality'),
    cost: z.enum(['free', 'low', 'moderate', 'high']),
    timeframe: z.enum(['immediate', 'days', 'weeks', 'months']),
  })),
  weeklyTrend: z.array(z.object({
    date: z.string(),
    score: z.number().min(0).max(100),
  })).optional(),
});

export const CommunityAlertSchema = z.object({
  id: z.string().uuid(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  area: z.object({
    center: z.object({ latitude: z.number(), longitude: z.number() }),
    radiusKm: z.number().positive(),
  }),
  alertType: z.enum([
    'noise_spike', 'light_event', 'construction_notice',
    'festival_warning', 'weather_noise', 'air_quality_sleep',
  ]),
  severity: z.enum(['advisory', 'warning', 'alert']),
  title: z.string(),
  description: z.string(),
  expectedDuration: z.string(),
  mitigationTips: z.array(z.string()),
  affectedPopulation: z.number().int().nonnegative(),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SleepProfile = z.infer<typeof SleepProfileSchema>;
export type EnvironmentalSnapshot = z.infer<typeof EnvironmentalSnapshotSchema>;
export type SleepRiskReport = z.infer<typeof SleepRiskReportSchema>;
export type CommunityAlert = z.infer<typeof CommunityAlertSchema>;

// ─── Implementation ────────────────────────────────────────────────────────────

const SENSITIVITY_MULTIPLIER = {
  low: 0.5,
  moderate: 1.0,
  high: 1.5,
  extreme: 2.0,
};

/**
 * Calculate noise risk score considering personal sensitivity
 */
export function calculateNoiseRiskScore(
  snapshots: EnvironmentalSnapshot[],
  profile: SleepProfile
): { score: number; peakEvents: number; avgDbA: number; worstHour?: string } {
  const nightSnapshots = snapshots.filter(s => {
    const hour = new Date(s.timestamp).getUTCHours();
    return hour >= 22 || hour < 7;
  });

  if (nightSnapshots.length === 0) {
    return { score: 0, peakEvents: 0, avgDbA: 0 };
  }

  const dbLevels = nightSnapshots.map(s => s.indoorNoiseDbA ?? s.outdoorNoiseDbA * 0.6);
  const avgDbA = dbLevels.reduce((a, b) => a + b, 0) / dbLevels.length;

  // WHO recommends <30 dB(A) for sleep
  const baseScore = Math.min(100, Math.max(0, (avgDbA - 25) * 3));
  const sensitivityFactor = SENSITIVITY_MULTIPLIER[profile.sensitivityToNoise];
  const score = Math.min(100, baseScore * sensitivityFactor);

  const peakThreshold = 45; // dB(A) peak events
  const peakEvents = dbLevels.filter(db => db > peakThreshold).length;

  // Find worst hour
  const hourBuckets = new Map<number, number[]>();
  for (const s of nightSnapshots) {
    const hour = new Date(s.timestamp).getUTCHours();
    const existing = hourBuckets.get(hour) ?? [];
    existing.push(s.indoorNoiseDbA ?? s.outdoorNoiseDbA * 0.6);
    hourBuckets.set(hour, existing);
  }

  let worstHour: string | undefined;
  let worstAvg = 0;
  for (const [hour, levels] of hourBuckets) {
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    if (avg > worstAvg) {
      worstAvg = avg;
      worstHour = `${hour.toString().padStart(2, '0')}:00`;
    }
  }

  return { score: Math.round(score), peakEvents, avgDbA: Math.round(avgDbA * 10) / 10, worstHour };
}

/**
 * Calculate light risk score considering personal sensitivity
 */
export function calculateLightRiskScore(
  snapshots: EnvironmentalSnapshot[],
  profile: SleepProfile
): { score: number; avgNightLux: number; blueExposure: 'low' | 'moderate' | 'high'; lightIntrusion: boolean } {
  const nightSnapshots = snapshots.filter(s => {
    const hour = new Date(s.timestamp).getUTCHours();
    return hour >= 22 || hour < 7;
  });

  if (nightSnapshots.length === 0) {
    return { score: 0, avgNightLux: 0, blueExposure: 'low', lightIntrusion: false };
  }

  const luxLevels = nightSnapshots.map(s => s.indoorLightLux ?? s.outdoorLightLux * 0.05);
  const avgNightLux = luxLevels.reduce((a, b) => a + b, 0) / luxLevels.length;

  // Ideal sleep: <1 lux
  const baseScore = Math.min(100, avgNightLux * 10);
  const sensitivityFactor = SENSITIVITY_MULTIPLIER[profile.sensitivityToLight];
  const score = Math.min(100, baseScore * sensitivityFactor);

  const blueExposure = avgNightLux > 10 ? 'high' : avgNightLux > 3 ? 'moderate' : 'low';
  const lightIntrusion = luxLevels.some(l => l > 5);

  return {
    score: Math.round(score),
    avgNightLux: Math.round(avgNightLux * 100) / 100,
    blueExposure,
    lightIntrusion,
  };
}

/**
 * Generate a comprehensive sleep risk report with personalized interventions
 */
export function generateSleepRiskReport(
  profile: SleepProfile,
  snapshots: EnvironmentalSnapshot[]
): SleepRiskReport {
  const noiseResult = calculateNoiseRiskScore(snapshots, profile);
  const lightResult = calculateLightRiskScore(snapshots, profile);

  const overallScore = Math.round(noiseResult.score * 0.55 + lightResult.score * 0.45);
  const overallRisk = overallScore < 15 ? 'minimal' as const
    : overallScore < 35 ? 'low' as const
    : overallScore < 55 ? 'moderate' as const
    : overallScore < 75 ? 'high' as const
    : 'severe' as const;

  const interventions: SleepRiskReport['interventions'] = [];

  // Noise interventions
  if (noiseResult.score > 30) {
    interventions.push({
      priority: noiseResult.score > 70 ? 'critical' : 'high',
      category: 'noise_barrier',
      title: 'White noise machine or app',
      description: 'Use continuous white/pink/brown noise at 45-50 dB to mask environmental noise spikes. Studies show 38% improvement in sleep onset latency.',
      estimatedImprovement: 25,
      cost: 'low',
      timeframe: 'immediate',
    });
  }

  if (noiseResult.score > 50) {
    interventions.push({
      priority: 'high',
      category: 'noise_barrier',
      title: 'Acoustic window inserts',
      description: 'Secondary glazing or acoustic window inserts can reduce noise by 15-20 dB(A). Priority for bedroom windows facing primary noise source.',
      estimatedImprovement: 35,
      cost: 'moderate',
      timeframe: 'weeks',
    });
  }

  if (noiseResult.peakEvents > 5) {
    interventions.push({
      priority: 'medium',
      category: 'community_action',
      title: 'File noise complaint with evidence',
      description: `${noiseResult.peakEvents} noise spike events detected. Use the complaint generator with sensor data as evidence for municipal action.`,
      estimatedImprovement: 20,
      cost: 'free',
      timeframe: 'months',
    });
  }

  // Light interventions
  if (lightResult.lightIntrusion) {
    interventions.push({
      priority: lightResult.score > 60 ? 'critical' : 'high',
      category: 'light_blocking',
      title: 'Blackout curtains or blinds',
      description: 'Install blackout curtains to eliminate light trespass. Target <1 lux at eye level for optimal melatonin production.',
      estimatedImprovement: 30,
      cost: 'low',
      timeframe: 'days',
    });
  }

  if (lightResult.blueExposure !== 'low') {
    interventions.push({
      priority: 'medium',
      category: 'behavioral',
      title: 'Blue light filter protocol',
      description: 'Enable night mode on all screens 2 hours before bed. Use amber-tinted lighting (2200K or below) in bedroom after sunset.',
      estimatedImprovement: 15,
      cost: 'free',
      timeframe: 'immediate',
    });
  }

  // Temperature
  const nightTemps = snapshots
    .filter(s => s.temperature !== undefined)
    .map(s => s.temperature!);
  if (nightTemps.length > 0) {
    const avgTemp = nightTemps.reduce((a, b) => a + b, 0) / nightTemps.length;
    if (avgTemp > 22 || avgTemp < 16) {
      interventions.push({
        priority: 'medium',
        category: 'environment',
        title: 'Optimize bedroom temperature',
        description: `Current avg: ${avgTemp.toFixed(1)}C. Ideal sleep temperature is 16-19C (60-67F). ${avgTemp > 22 ? 'Consider cooling fan or AC.' : 'Add blankets or adjust heating.'}`,
        estimatedImprovement: 12,
        cost: avgTemp > 22 ? 'moderate' : 'free',
        timeframe: 'immediate',
      });
    }
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  interventions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    userId: profile.userId,
    generatedAt: new Date().toISOString(),
    overallRisk,
    overallScore,
    noiseRisk: {
      score: noiseResult.score,
      peakEvents: noiseResult.peakEvents,
      avgNightDbA: noiseResult.avgDbA,
      worstHour: noiseResult.worstHour,
      primarySources: [],
    },
    lightRisk: {
      score: lightResult.score,
      avgNightLux: lightResult.avgNightLux,
      blueExposure: lightResult.blueExposure,
      lightIntrusion: lightResult.lightIntrusion,
    },
    interventions,
  };
}

/**
 * Create a community alert for predicted sleep disruption events
 */
export function createCommunityAlert(
  alertType: CommunityAlert['alertType'],
  center: { latitude: number; longitude: number },
  radiusKm: number,
  title: string,
  description: string,
  durationHours: number,
  affectedPopulation: number
): CommunityAlert {
  const mitigationTips: Record<CommunityAlert['alertType'], string[]> = {
    noise_spike: [
      'Close windows and use weather stripping to reduce noise infiltration',
      'Use white noise or earplugs rated NRR 33',
      'Move sleeping area to quietest room in dwelling',
    ],
    light_event: [
      'Use blackout curtains or sleep masks',
      'Avoid looking at bright light sources to preserve dark adaptation',
    ],
    construction_notice: [
      'Consider schedule adjustment if possible during construction hours',
      'Request quiet hours compliance from contractor (usually 7 PM - 7 AM)',
      'Document violations for municipal complaint',
    ],
    festival_warning: [
      'Plan alternative sleeping arrangements if possible',
      'Combine earplugs with white noise for maximum attenuation',
      'Contact event organizers about sound level compliance',
    ],
    weather_noise: [
      'Secure loose outdoor items that may create noise in wind',
      'Heavy rain on skylights: use white noise to mask irregular patterns',
    ],
    air_quality_sleep: [
      'Keep windows closed; use HEPA air purifier',
      'Reduced air quality can impair sleep — consider mask if sensitive',
    ],
  };

  const severity: CommunityAlert['severity'] = durationHours > 8 ? 'alert'
    : durationHours > 3 ? 'warning'
    : 'advisory';

  return {
    id: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + durationHours * 3600000).toISOString(),
    area: { center, radiusKm },
    alertType,
    severity,
    title,
    description,
    expectedDuration: `${durationHours} hours`,
    mitigationTips: mitigationTips[alertType],
    affectedPopulation,
  };
}
