export type Provider = 'upload' | 'youtube' | 'spotify' | 'soundcloud' | 'unknown';

export type Vibe =
  | 'Warm Up'
  | 'Sunset Cruise'
  | 'Peak Time'
  | 'Late Night'
  | 'After Hours';

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