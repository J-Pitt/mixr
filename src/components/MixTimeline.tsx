import { useEffect, useRef } from 'react';
import type { MixPlan } from '../types';

const TRACK_COLORS = ['#8b5cf6', '#2dd4a8', '#e040a8', '#c8963a', '#5b8def', '#f0776c'];

interface MixTimelineProps {
  plan: MixPlan;
  currentTime: number;
  onSeek?: (seconds: number) => void;
}

interface Block {
  index: number;
  start: number;
  end: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  energy: number[];
  title: string;
}

/** Positions each track on the mix timeline, including its blend overlaps. */
function layout(plan: MixPlan): Block[] {
  let cursor = 0;
  return plan.tracks.map((track, index) => {
    const start = track.mixStartSeconds ?? cursor;
    const outgoing = track.transitionOut?.lengthSeconds ?? 0;
    cursor = start + track.playDurationSeconds - outgoing;

    return {
      index,
      start,
      end: start + track.playDurationSeconds,
      fadeInSeconds: track.transitionIn?.lengthSeconds ?? 0,
      fadeOutSeconds: outgoing,
      energy: track.energyPreview ?? [],
      title: track.title,
    };
  });
}

/**
 * Canvas timeline: a ribbon showing where each track sits and how far the blends
 * overlap, above a waveform lane drawn from the measured energy curve.
 */
export function MixTimeline({ plan, currentTime, onSeek }: MixTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const total = Math.max(1, plan.totalDurationSeconds);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;

      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      // Read theme colors from CSS so the canvas follows light and dark mode.
      const styles = getComputedStyle(canvas);
      const gridColor = styles.getPropertyValue('--timeline-grid').trim() || 'rgba(255,255,255,0.10)';
      const labelColor = styles.getPropertyValue('--timeline-label').trim() || 'rgba(255,255,255,0.42)';
      const playheadColor = styles.getPropertyValue('--timeline-playhead').trim() || 'rgba(255,255,255,0.92)';

      const blocks = layout(plan);
      const ribbonHeight = 22;
      const ribbonGap = 10;
      const laneTop = ribbonHeight + ribbonGap;
      const laneHeight = height - laneTop - 18;
      const toX = (seconds: number) => (seconds / total) * width;

      // Ribbon: alternating lanes so overlapping blends are visible.
      blocks.forEach((block) => {
        const x = toX(block.start);
        const blockWidth = Math.max(2, toX(block.end) - x);
        const y = block.index % 2 === 0 ? 0 : ribbonHeight / 2;
        const color = TRACK_COLORS[block.index % TRACK_COLORS.length];

        context.fillStyle = `${color}55`;
        context.strokeStyle = color;
        context.lineWidth = 1;
        roundRect(context, x, y, blockWidth, ribbonHeight / 2 - 1, 3);
        context.fill();
        context.stroke();
      });

      // Waveform lane.
      blocks.forEach((block) => {
        const color = TRACK_COLORS[block.index % TRACK_COLORS.length];
        const startX = toX(block.start);
        const endX = toX(block.end);
        const blockWidth = Math.max(1, endX - startX);
        const bars = block.energy.length;
        if (bars === 0) return;

        const barWidth = blockWidth / bars;
        for (let bar = 0; bar < bars; bar += 1) {
          const x = startX + bar * barWidth;
          const seconds = block.start + (bar / bars) * (block.end - block.start);

          // Fade the bars inside a blend so overlaps read as a handover.
          let alpha = 0.85;
          if (block.fadeInSeconds > 0 && seconds < block.start + block.fadeInSeconds) {
            alpha *= (seconds - block.start) / block.fadeInSeconds;
          }
          if (block.fadeOutSeconds > 0 && seconds > block.end - block.fadeOutSeconds) {
            alpha *= (block.end - seconds) / block.fadeOutSeconds;
          }

          const magnitude = Math.max(0.04, Math.min(1, block.energy[bar]));
          const barHeight = magnitude * laneHeight;
          context.fillStyle = withAlpha(color, Math.max(0.08, alpha));
          context.fillRect(x, laneTop + (laneHeight - barHeight), Math.max(0.8, barWidth - 0.5), barHeight);
        }
      });

      // Minute gridlines.
      context.strokeStyle = gridColor;
      context.fillStyle = labelColor;
      context.font = '10px ui-sans-serif, system-ui, sans-serif';
      context.lineWidth = 1;
      for (let minute = 1; minute * 60 < total; minute += 1) {
        const x = Math.floor(toX(minute * 60)) + 0.5;
        context.beginPath();
        context.moveTo(x, laneTop);
        context.lineTo(x, laneTop + laneHeight);
        context.stroke();
        context.fillText(`${minute}m`, x + 3, height - 6);
      }

      // Playhead.
      if (currentTime > 0) {
        const x = Math.floor(toX(Math.min(currentTime, total))) + 0.5;
        context.strokeStyle = playheadColor;
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, laneTop + laneHeight);
        context.stroke();

        context.fillStyle = playheadColor;
        context.beginPath();
        context.arc(x, laneTop + laneHeight, 3, 0, Math.PI * 2);
        context.fill();
      }
    };

    draw();

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [plan, currentTime, total]);

  const seek = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(total, fraction * total)));
  };

  return (
    <canvas
      ref={canvasRef}
      className={onSeek ? 'mix-timeline seekable' : 'mix-timeline'}
      onClick={seek}
      role={onSeek ? 'slider' : undefined}
      aria-label={onSeek ? 'Mix position' : undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(currentTime)}
    />
  );
}

function withAlpha(hex: string, alpha: number): string {
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${value}`;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const limit = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + limit, y);
  context.arcTo(x + width, y, x + width, y + height, limit);
  context.arcTo(x + width, y + height, x, y + height, limit);
  context.arcTo(x, y + height, x, y, limit);
  context.arcTo(x, y, x + width, y, limit);
  context.closePath();
}
