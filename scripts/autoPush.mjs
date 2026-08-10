import { execSync, spawnSync } from 'node:child_process';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const intervalMs = 10 * 60 * 1000;
const dryRun = args.has('--dry-run');
const once = args.has('--once');

const run = (command, options = {}) =>
  execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();

const log = (message) => {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[auto-push ${timestamp}] ${message}\n`);
};

const hasGitIdentity = () => {
  const name = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' }).stdout.trim();
  const email = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout.trim();
  return Boolean(name && email);
};

const syncRepository = () => {
  try {
    const branch = run('git branch --show-current');
    if (!branch) {
      log('Skipping cycle because no current branch was detected.');
      return;
    }

    if (!hasGitIdentity()) {
      log('Skipping cycle because git user.name or user.email is not configured.');
      return;
    }

    const statusBefore = run('git status --short');
    if (!statusBefore) {
      log(`No changes to commit on ${branch}.`);
      return;
    }

    log(`Detected changes on ${branch}.`);
    if (dryRun) {
      log('Dry run enabled; skipping add, commit, and push.');
      return;
    }

    run('git add -A');
    const stagedStatus = run('git diff --cached --name-status');
    if (!stagedStatus) {
      log('Nothing staged after git add -A.');
      return;
    }

    const commitMessage = `chore: auto-save ${new Date().toISOString()}`;
    run(`git commit -m "${commitMessage}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    run(`git push origin ${branch}`, { stdio: ['ignore', 'pipe', 'pipe'] });
    log(`Committed and pushed to origin/${branch}.`);
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    log(`Cycle failed: ${output}`);
  }
};

log(dryRun ? 'Starting auto-push in dry-run mode.' : 'Starting auto-push.');
syncRepository();

if (!once) {
  setInterval(syncRepository, intervalMs);
}