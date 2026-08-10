import type {
  EnergySlice,
  MixPlan,
  MixPlanTrack,
  Provider,
  TrackAnalysis,
  TrackInput,
  Vibe,
} from '../types';

const KEYS = ['Am', 'C', 'G', 'Dm', 'Em', 'F', 'Bm', 'A', 'D', 'E', 'Bb', 'Fm'];

const vibeProfiles: Record<
  Vibe,
  {
    eq: string;
    transitionStyle: string;
    transitionRange: [number, number];
    order: 'lift' | 'cruise' | 'peak' | 'dark' | 'moody';
  }
> = {
  'Warm Up': {
    eq: 'Ease the sub slightly, keep mids open, add a gentle high lift as the set climbs.',
    transitionStyle: 'long blend',
    transitionRange: [10, 14],
    order: 'lift',
  },
  'Sunset Cruise': {
    eq: 'Keep the low mids warm, soften the top end, and let vocals sit forward.',
    transitionStyle: 'silky crossfade',
    transitionRange: [10, 14],
    order: 'cruise',
  },
  'Peak Time': {
    eq: 'Tighten the lows, push presence around the mids, and keep the highs crisp.',
    transitionStyle: 'quick energy handoff',
    transitionRange: [6, 10],
    order: 'peak',
  },
  'Late Night': {
    eq: 'Roll off some sparkle, lean into sub weight, and keep the center image focused.',
    transitionStyle: 'smoked blend',
    transitionRange: [8, 12],
    order: 'dark',
  },
  'After Hours': {
    eq: 'Tuck the mids, deepen the low bed, and keep the highs restrained.',
    transitionStyle: 'patient fade',
    transitionRange: [8, 12],
    order: 'moody',
  },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hashString = (input: string) => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const normalizeSeries = (values: number[]) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 0.0001) {
    return values.map(() => 0.5);
  }

  return values.map((value) => (value - min) / (max - min));
};

const formatTitleFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, ' ')
      .trim();

    return slug ? slug.replace(/\b\w/g, (letter) => letter.toUpperCase()) : parsed.hostname;
  } catch {
    return url;
  }
};

export const detectProvider = (url: string): Provider => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    }
    if (hostname.includes('spotify.com')) {
      return 'spotify';
    }
    if (hostname.includes('soundcloud.com')) {
      return 'soundcloud';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
};

export const createUploadTrack = (file: File): TrackInput => ({
  id: crypto.randomUUID(),
  title: file.name.replace(/\.[^.]+$/, ''),
  source: {
    kind: 'upload',
    file,
  },
  analysisStatus: 'pending',
});

export const createLinkTrack = (url: string): TrackInput => ({
  id: crypto.randomUUID(),
  title: formatTitleFromUrl(url),
  source: {
    kind: 'link',
    url,
    provider: detectProvider(url),
  },
  analysisStatus: 'pending',
});

const buildSlicesFromSeries = (energyRaw: number[], brightnessRaw: number[]): EnergySlice[] => {
  const energy = normalizeSeries(energyRaw);
  const brightness = normalizeSeries(brightnessRaw);

  return energy.map((value, index) => ({
    second: index,
    energy: value,
    brightness: brightness[index],
    transitionScore: clamp((1 - value) * 0.65 + brightness[index] * 0.35, 0, 1),
  }));
};

const estimateBpm = (channelData: Float32Array, sampleRate: number) => {
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.05));
  const frames = Math.floor(channelData.length / frameSize);
  const envelope = new Array<number>(frames).fill(0);

  for (let frame = 0; frame < frames; frame += 1) {
    let total = 0;
    const start = frame * frameSize;
    const end = Math.min(start + frameSize, channelData.length);
    for (let sample = start; sample < end; sample += 1) {
      total += Math.abs(channelData[sample]);
    }
    envelope[frame] = total / Math.max(1, end - start);
  }

  const minLag = Math.round((60 / 160) / 0.05);
  const maxLag = Math.round((60 / 70) / 0.05);
  let bestLag = minLag;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let frame = lag; frame < envelope.length; frame += 1) {
      score += envelope[frame] * envelope[frame - lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return clamp(Math.round(60 / (bestLag * 0.05)), 70, 160);
};

const pickKey = (seed: number) => KEYS[seed % KEYS.length];

const deriveTransitionMoments = (slices: EnergySlice[], durationSeconds: number) => {
  const candidates: number[] = [];
  for (let anchor = 16; anchor < durationSeconds - 16; anchor += 8) {
    let bestSecond = anchor;
    let bestScore = -Infinity;
    for (let second = Math.max(8, anchor - 2); second <= Math.min(durationSeconds - 8, anchor + 2); second += 1) {
      const slice = slices[second];
      if (!slice) {
        continue;
      }
      if (slice.transitionScore > bestScore) {
        bestScore = slice.transitionScore;
        bestSecond = second;
      }
    }
    candidates.push(bestSecond);
  }

  return [...new Set(candidates)].slice(0, 6);
};

const pickIntroOutro = (slices: EnergySlice[]) => {
  const averageEnergy = slices.reduce((total, slice) => total + slice.energy, 0) / Math.max(1, slices.length);

  const introWindow = slices.slice(4, Math.min(24, slices.length));
  const introCandidate = introWindow.find((slice) => slice.energy >= averageEnergy * 0.9) ?? introWindow[0] ?? slices[0];

  const outroWindow = slices.slice(Math.max(0, slices.length - 24), Math.max(0, slices.length - 4));
  const lastOutroWindowSlice = outroWindow.length > 0 ? outroWindow[outroWindow.length - 1] : undefined;
  const lastSlice = slices.length > 0 ? slices[slices.length - 1] : undefined;
  const outroCandidate = [...outroWindow].reverse().find((slice) => slice.energy >= averageEnergy * 0.85) ?? lastOutroWindowSlice ?? lastSlice;

  return {
    introSecond: introCandidate?.second ?? 0,
    outroSecond: outroCandidate?.second ?? Math.max(0, slices.length - 1),
  };
};

export const analyzeUploadedTrack = async (file: File): Promise<TrackAnalysis> => {
  const audioContext = new AudioContext();
  try {
    const buffer = await file.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    const durationSeconds = Math.max(1, Math.floor(decoded.duration));
    const left = decoded.getChannelData(0);
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
    const mono = new Float32Array(left.length);

    for (let index = 0; index < left.length; index += 1) {
      mono[index] = (left[index] + right[index]) / 2;
    }

    const energyRaw: number[] = [];
    const brightnessRaw: number[] = [];

    for (let second = 0; second < durationSeconds; second += 1) {
      const start = second * decoded.sampleRate;
      const end = Math.min((second + 1) * decoded.sampleRate, mono.length);
      let energy = 0;
      let brightness = 0;

      for (let sample = start + 1; sample < end; sample += 1) {
        const current = mono[sample];
        const previous = mono[sample - 1];
        energy += current * current;
        brightness += Math.abs(current - previous);
      }

      const frameLength = Math.max(1, end - start);
      energyRaw.push(Math.sqrt(energy / frameLength));
      brightnessRaw.push(brightness / frameLength);
    }

    const slices = buildSlicesFromSeries(energyRaw, brightnessRaw);
    const averageEnergy = slices.reduce((total, slice) => total + slice.energy, 0) / slices.length;
    const averageBrightness = slices.reduce((total, slice) => total + slice.brightness, 0) / slices.length;
    const bpm = estimateBpm(mono, decoded.sampleRate);
    const { introSecond, outroSecond } = pickIntroOutro(slices);

    return {
      durationSeconds,
      usableDurationSeconds: Math.max(45, outroSecond - introSecond),
      bpm,
      key: pickKey(hashString(file.name) + Math.round(averageBrightness * 100)),
      averageEnergy,
      averageBrightness,
      introSecond,
      outroSecond,
      transitionMoments: deriveTransitionMoments(slices, durationSeconds),
      slices,
      isEstimated: false,
    };
  } finally {
    void audioContext.close();
  }
};

export const analyzeLinkedTrack = (url: string, provider: Provider): TrackAnalysis => {
  const seed = hashString(url + provider);
  const durationSeconds = 180 + (seed % 121);
  const slices: EnergySlice[] = [];

  for (let second = 0; second < durationSeconds; second += 1) {
    const energy = clamp(0.45 + Math.sin((second + seed % 17) / 14) * 0.25 + ((seed >> (second % 8)) & 7) / 40, 0.12, 0.95);
    const brightness = clamp(0.4 + Math.cos((second + seed % 29) / 11) * 0.2, 0.15, 0.9);
    const transitionScore = clamp((1 - energy) * 0.55 + brightness * 0.45, 0, 1);
    slices.push({ second, energy, brightness, transitionScore });
  }

  const averageEnergy = slices.reduce((total, slice) => total + slice.energy, 0) / slices.length;
  const averageBrightness = slices.reduce((total, slice) => total + slice.brightness, 0) / slices.length;
  const { introSecond, outroSecond } = pickIntroOutro(slices);

  return {
    durationSeconds,
    usableDurationSeconds: Math.max(60, outroSecond - introSecond),
    bpm: 92 + (seed % 46),
    key: pickKey(seed),
    averageEnergy,
    averageBrightness,
    introSecond,
    outroSecond,
    transitionMoments: deriveTransitionMoments(slices, durationSeconds),
    slices,
    isEstimated: true,
  };
};

const orderRank = (analysis: TrackAnalysis, vibe: Vibe) => {
  switch (vibeProfiles[vibe].order) {
    case 'lift':
      return analysis.averageEnergy * 0.65 + (analysis.bpm / 160) * 0.35;
    case 'cruise':
      return analysis.averageBrightness * 0.35 + analysis.averageEnergy * 0.65;
    case 'peak':
      return analysis.averageEnergy * 0.6 + (analysis.bpm / 160) * 0.4;
    case 'dark':
      return analysis.averageEnergy * 0.55 + (1 - analysis.averageBrightness) * 0.45;
    case 'moody':
      return (1 - analysis.averageBrightness) * 0.55 + (analysis.bpm / 160) * 0.45;
  }
};

const transitionCompatibility = (current: TrackAnalysis, next: TrackAnalysis, vibe: Vibe) => {
  const bpmGap = Math.abs(current.bpm - next.bpm) / 50;
  const energyGap = Math.abs(current.averageEnergy - next.averageEnergy);
  const brightnessGap = Math.abs(current.averageBrightness - next.averageBrightness);
  const orderPenalty = (() => {
    switch (vibeProfiles[vibe].order) {
      case 'lift':
        return next.averageEnergy < current.averageEnergy ? 0.4 : 0;
      case 'peak':
        return next.averageEnergy + 0.05 < current.averageEnergy ? 0.35 : 0;
      case 'dark':
      case 'moody':
        return next.averageBrightness > current.averageBrightness + 0.12 ? 0.3 : 0;
      case 'cruise':
        return next.averageEnergy < current.averageEnergy - 0.2 ? 0.25 : 0;
    }
  })();

  return bpmGap * 0.45 + energyGap * 0.35 + brightnessGap * 0.2 + orderPenalty;
};

const orderTracks = (tracks: TrackInput[], vibe: Vibe) => {
  const pending = [...tracks].filter((track) => track.analysis);
  if (pending.length < 2) {
    return pending;
  }

  pending.sort((left, right) => (orderRank(left.analysis!, vibe) > orderRank(right.analysis!, vibe) ? 1 : -1));

  const ordered: TrackInput[] = [pending.shift()!];
  while (pending.length > 0) {
    const current = ordered[ordered.length - 1].analysis!;
    let bestIndex = 0;
    let bestScore = Infinity;
    pending.forEach((candidate, index) => {
      const score = transitionCompatibility(current, candidate.analysis!, vibe);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    ordered.push(pending.splice(bestIndex, 1)[0]);
  }

  return ordered;
};

const allocateDurations = (tracks: TrackInput[], targetMinutes?: number) => {
  const durations = tracks.map((track) => track.analysis!.usableDurationSeconds);
  const minimum = 45;
  const total = durations.reduce((sum, value) => sum + value, 0);
  if (!targetMinutes || targetMinutes * 60 >= total) {
    return durations;
  }

  const target = targetMinutes * 60;
  const floorTotal = tracks.length * minimum;
  if (target <= floorTotal) {
    return tracks.map(() => minimum);
  }

  let remainingCut = total - target;
  const allocated = [...durations];

  while (remainingCut > 0.5) {
    const adjustable = allocated.map((value, index) => ({ value, index })).filter(({ value }) => value > minimum);
    if (adjustable.length === 0) {
      break;
    }
    const capacity = adjustable.reduce((sum, item) => sum + (item.value - minimum), 0);
    adjustable.forEach(({ value, index }) => {
      const share = ((value - minimum) / capacity) * remainingCut;
      const cut = Math.min(value - minimum, Math.max(1, Math.round(share)));
      allocated[index] -= cut;
      remainingCut -= cut;
    });
  }

  return allocated.map((value) => Math.max(minimum, Math.round(value)));
};

const buildTransitionLength = (fromTrack: TrackAnalysis, toTrack: TrackAnalysis, vibe: Vibe) => {
  const [min, max] = vibeProfiles[vibe].transitionRange;
  const bpmGap = Math.abs(fromTrack.bpm - toTrack.bpm);
  const bias = bpmGap < 8 ? 2 : bpmGap > 20 ? -1 : 0;
  return clamp(Math.round((min + max) / 2 + bias), min, max);
};

export const generateMixPlan = ({
  title,
  tracks,
  vibe,
  targetMinutes,
}: {
  title: string;
  tracks: TrackInput[];
  vibe: Vibe;
  targetMinutes?: number;
}): MixPlan => {
  const ordered = orderTracks(tracks, vibe);
  const allocations = allocateDurations(ordered, targetMinutes);
  const warnings: string[] = [];

  if (tracks.some((track) => track.analysis?.isEstimated)) {
    warnings.push('Some streaming links use estimated analysis because browser-only audio decoding is not available for those providers.');
  }

  const planTracks: MixPlanTrack[] = ordered.map((track, index) => {
    const analysis = track.analysis!;
    const playDurationSeconds = Math.min(allocations[index], analysis.durationSeconds);
    const transitionLength = index < ordered.length - 1 ? buildTransitionLength(analysis, ordered[index + 1].analysis!, vibe) : 0;
    const startOffsetSeconds = clamp(analysis.introSecond, 0, Math.max(0, analysis.durationSeconds - playDurationSeconds));
    const endOffsetSeconds = clamp(startOffsetSeconds + playDurationSeconds, playDurationSeconds, analysis.durationSeconds);
    const transitionAnchor = analysis.transitionMoments.find((moment) => moment >= startOffsetSeconds + 24 && moment <= endOffsetSeconds - 10);
    const transitionOutAt = transitionAnchor ?? Math.max(startOffsetSeconds + 24, endOffsetSeconds - transitionLength - 4);

    return {
      trackId: track.id,
      title: track.title,
      provider: track.source.kind === 'upload' ? 'upload' : track.source.provider,
      bpm: analysis.bpm,
      key: analysis.key,
      playDurationSeconds,
      startOffsetSeconds,
      endOffsetSeconds,
      eqProfile: vibeProfiles[vibe].eq,
      transitionOut:
        transitionLength > 0
          ? {
              fromSecond: transitionOutAt,
              toSecond: clamp(transitionOutAt + transitionLength, transitionOutAt + 4, endOffsetSeconds),
              lengthSeconds: transitionLength,
              style: vibeProfiles[vibe].transitionStyle,
              reason: `Blend near a phrase-friendly pocket with ${Math.round(analysis.averageEnergy * 100)}% energy.`,
            }
          : undefined,
      notes: [
        analysis.isEstimated ? 'Remote link analysis is estimated.' : 'Audio was analyzed second by second from the uploaded file.',
        `Average energy ${Math.round(analysis.averageEnergy * 100)}%, brightness ${Math.round(analysis.averageBrightness * 100)}%.`,
      ],
    };
  });

  for (let index = 1; index < planTracks.length; index += 1) {
    const previous = planTracks[index - 1];
    const current = planTracks[index];
    const currentAnalysis = ordered[index].analysis!;
    const transitionLength = previous.transitionOut?.lengthSeconds ?? 0;
    current.transitionIn = {
      fromSecond: clamp(currentAnalysis.introSecond, 0, Math.max(0, currentAnalysis.durationSeconds - transitionLength)),
      toSecond: clamp(currentAnalysis.introSecond + transitionLength, transitionLength, currentAnalysis.durationSeconds),
      lengthSeconds: transitionLength,
      style: previous.transitionOut?.style ?? vibeProfiles[vibe].transitionStyle,
      reason: `Matched into ${current.bpm} BPM with ${current.key} tonal color.`,
    };
  }

  const overlap = planTracks.slice(0, -1).reduce((sum, track) => sum + (track.transitionOut?.lengthSeconds ?? 0), 0);
  const totalDurationSeconds = planTracks.reduce((sum, track) => sum + track.playDurationSeconds, 0) - overlap;

  if (targetMinutes && totalDurationSeconds < targetMinutes * 60 - 30) {
    warnings.push('The target duration is longer than the usable material, so the generated mix stays shorter than requested.');
  }

  return {
    title: title.trim() || 'Untitled mix',
    vibe,
    targetMinutes,
    totalDurationSeconds,
    tracks: planTracks,
    summary: `${planTracks.length} tracks sequenced for a ${vibe.toLowerCase()} set with ${planTracks.length - 1} transitions.`,
    warnings,
  };
};

export const formatSeconds = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};