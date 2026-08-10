export type Provider = 'upload' | 'youtube' | 'spotify' | 'soundcloud' | 'unknown';

// Time of day
// Season & outdoors
// Genre & sound
// Mood & energy
export type Vibe =
  | 'Warm Up'
  | 'Sunrise'
  | 'Morning Coffee'
  | 'Midday Drive'
  | 'Golden Hour'
  | 'Sunset Cruise'
  | 'Blue Hour'
  | 'Peak Time'
  | 'Late Night'
  | 'After Hours'
  | 'Deep Night'
  | 'Spring Bloom'
  | 'Summer Heat'
  | 'Festival'
  | 'Beach Party'
  | 'Poolside'
  | 'Autumn Rain'
  | 'Winter Chill'
  | 'Cozy Cabin'
  | 'House'
  | 'Techno'
  | 'Ambient'
  | 'Hip-Hop'
  | 'R&B'
  | 'Afrobeats'
  | 'Latin'
  | 'Reggae'
  | 'Jazz'
  | 'Soul'
  | 'Funk'
  | 'Drum & Bass'
  | 'Trance'
  | 'Chill'
  | 'Hype'
  | 'Melancholy'
  | 'Euphoric'
  | 'Romantic'
  | 'Introspective'
  | 'Dark'
  | 'Uplifting';

export interface EnergySlice {
  second: number;
  energy: number;
  brightness: number;
  transitionScore: number;
}

export interface TrackAnalysis {
  durationSeconds: number;
  usableDurationSeconds: number;
  bpm: number;
  key: string;
  averageEnergy: number;
  averageBrightness: number;
  introSecond: number;
  outroSecond: number;
  transitionMoments: number[];
  slices: EnergySlice[];
  isEstimated: boolean;
}

export type TrackSource =
  | {
      kind: 'upload';
      file: File;
    }
  | {
      kind: 'link';
      url: string;
      provider: Provider;
    };

export type AnalysisStatus = 'pending' | 'analyzing' | 'ready' | 'fallback' | 'error';

export interface TrackInput {
  id: string;
  title: string;
  artist?: string;
  source: TrackSource;
  durationHintSeconds?: number;
  analysisStatus: AnalysisStatus;
  analysis?: TrackAnalysis;
  notes?: string[];
}

export interface MixTransition {
  fromSecond: number;
  toSecond: number;
  lengthSeconds: number;
  style: string;
  reason: string;
}

export interface MixPlanTrack {
  trackId: string;
  title: string;
  provider: Provider;
  bpm: number;
  key: string;
  playDurationSeconds: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  eqProfile: string;
  transitionIn?: MixTransition;
  transitionOut?: MixTransition;
  notes: string[];
}

export interface MixPlan {
  title: string;
  vibe: Vibe;
  targetMinutes?: number;
  totalDurationSeconds: number;
  tracks: MixPlanTrack[];
  summary: string;
  warnings: string[];
}