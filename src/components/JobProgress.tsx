import type { RenderProgress } from '../types';

interface JobProgressProps {
  job: RenderProgress;
  onCancel: () => void;
}

const stageLabels: Record<string, string> = {
  queued: 'Queued',
  resolving: 'Finding songs',
  downloading: 'Fetching audio',
  analyzing: 'Analyzing',
  planning: 'Sequencing',
  rendering: 'Rendering',
  done: 'Done',
  error: 'Failed',
};

export function JobProgress({ job, onCancel }: JobProgressProps) {
  const percent = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
  const running = job.stage !== 'done' && job.stage !== 'error';

  return (
    <section className="panel job-panel">
      <div className="section-heading block-heading">
        <div>
          <p className="eyebrow">{stageLabels[job.stage] ?? job.stage}</p>
          <h2>Building your mix</h2>
        </div>
        {running ? (
          <button type="button" className="ghost-button danger" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>

      <div className="progress-track">
        <div className={running ? 'progress-fill active' : 'progress-fill'} style={{ width: `${percent}%` }} />
      </div>
      <p className="summary-note">
        {percent}% · {job.message}
      </p>

      <ul className="job-tracks">
        {job.tracks.map((track, index) => (
          <li key={`${track.label}-${index}`} className="job-track" data-status={track.status}>
            <span className="job-track-status" aria-hidden="true">
              {track.status === 'ready' ? '✓' : track.status === 'error' ? '✕' : track.status === 'working' ? '●' : '○'}
            </span>
            <span className="job-track-label">{track.label}</span>
            {track.detail ? <span className="job-track-detail">{track.detail}</span> : null}
          </li>
        ))}
      </ul>

      {job.stage === 'error' ? <p className="error-banner">{job.error ?? job.message}</p> : null}
    </section>
  );
}
