export type Provider = 'local' | 'youtube' | 'spotify' | 'soundcloud' | 'unknown';

/** Which service a typed query is searched against. */
export type SearchProvider = 'youtube' | 'soundcloud';

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
  /** Pipeline version. Absent on analyses cached before versioning existed. */
  version?: number;
  durationSeconds: number;
  usableDurationSeconds: number;
  bpm: number;
  /** 0..1. Low values mean the tempo estimate is a guess, so the UI can say so. */
  bpmConfidence: number;
  /** Phase of the first beat, so play windows can snap to the grid. */
  beatOffsetSeconds: number;
  /**
   * Every tracked beat, in seconds. Blends are cut and matched against this
   * rather than an extrapolated grid, which has drifted by whole beats by the
   * time a track reaches its outro. Empty when the pulse could not be followed.
   */
  beatTimes?: number[];
  key: string;
  /** 0..1 correlation strength of the winning key profile. */
  keyConfidence: number;
  averageEnergy: number;
  averageBrightness: number;
  introSecond: number;
  outroSecond: number;
  transitionMoments: number[];
  slices: EnergySlice[];
}

export interface LoudnessMeasurement {
  integratedLufs: number;
  truePeakDb: number;
  loudnessRange: number;
}

/** What the client asks the server to ingest. */
export type TrackRequest =
  | { kind: 'query'; query: string; provider: SearchProvider }
  | { kind: 'link'; url: string }
  | { kind: 'local'; path: string };

export interface SearchResult {
  sourceId: string;
  title: string;
  artist?: string;
  durationSeconds?: number;
  thumbnail?: string;
  webpageUrl: string;
  provider: Provider;
}

/** A track that has been downloaded, transcoded, and analyzed. */
export interface IngestedTrack {
  id: string;
  title: string;
  artist?: string;
  provider: Provider;
  /** Original link, when the track came from a streaming service. */
  sourceUrl?: string;
  /** Original file, when the track came from disk. */
  sourcePath?: string;
  /** Filename of the canonical FLAC inside the media directory. */
  mediaFile: string;
  /** Size of the canonical FLAC, so the library can report disk usage. */
  sizeBytes: number;
  thumbnail?: string;
  analysis: TrackAnalysis;
  loudness: LoudnessMeasurement;
  addedAt: string;
  plays: number;
}

/** The planning engine only needs identity, analysis, and measured level. */
export interface TrackInput {
  id: string;
  title: string;
  artist?: string;
  provider: Provider;
  analysis: TrackAnalysis;
  loudness?: LoudnessMeasurement;
}

export interface MixTransition {
  /** Position inside the source track, so the UI can draw it on the waveform. */
  fromSecond: number;
  toSecond: number;
  /**
   * Length on the mix timeline, which is what the renderer crossfades over. On
   * a time-stretched track this is shorter than `toSecond - fromSecond`.
   */
  lengthSeconds: number;
  style: string;
  reason: string;
}

export interface MixPlanTrack {
  trackId: string;
  title: string;
  artist?: string;
  provider: Provider;
  bpm: number;
  key: string;
  /**
   * Length on the mix timeline. The source window is `playDurationSeconds *
   * tempoRatio` long, which differs once a track is stretched to the set tempo.
   */
  playDurationSeconds: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  /**
   * Playback rate applied so this track shares the set tempo. 1 means it plays
   * at its own tempo, either because it already matches or because matching it
   * would need more stretch than stays transparent.
   */
  tempoRatio?: number;
  eqProfile: string;
  /** Gain applied so every track sits at the same perceived loudness. */
  gainDb?: number;
  /** Where this track starts inside the finished mix. */
  mixStartSeconds?: number;
  /** Downsampled energy across the play window, for drawing the timeline. */
  energyPreview: number[];
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

export type RenderStage = 'queued' | 'resolving' | 'downloading' | 'analyzing' | 'planning' | 'rendering' | 'done' | 'error';

export interface RenderProgress {
  jobId: string;
  stage: RenderStage;
  /** 0..1 across the whole job. */
  progress: number;
  message: string;
  /** Per-track status lines, in submission order. */
  tracks: { label: string; status: 'pending' | 'working' | 'ready' | 'error'; detail?: string }[];
  plan?: MixPlan;
  mix?: MixRecord;
  error?: string;
}

/** A finished mix on disk. */
export interface MixRecord {
  id: string;
  title: string;
  vibes: Vibe[];
  plan: MixPlan;
  /** Filename inside the renders directory. */
  file: string;
  durationSeconds: number;
  sizeBytes: number;
  createdAt: string;
  plays: number;
}

export interface LibrarySnapshot {
  mixes: MixRecord[];
  tracks: IngestedTrack[];
}

export interface ToolStatus {
  ffmpeg: { ready: boolean; version?: string; error?: string };
  ytdlp: { ready: boolean; version?: string; error?: string };
}
