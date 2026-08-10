# mixR

mixR is a browser-based DJ mix planner. It lets you build a mix by adding songs from local uploads or supported streaming links, choosing a vibe, and optionally setting a target duration.

The current MVP includes:

- local audio upload analysis with second-by-second energy and brightness scoring
- link intake for YouTube, Spotify, and SoundCloud
- vibe-based track reordering and EQ guidance
- target-length trimming and transition planning
- a mix blueprint view that explains where blends should happen

Streaming links are accepted, but browser-only analysis cannot decode those platforms' audio directly. For those tracks, the app uses a deterministic fallback profile until a backend ingestion pipeline is added.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Auto Commit And Push

Run this to automatically commit and push repository changes every 10 minutes:

```bash
npm run autopush
```

Validation without writing git history:

```bash
npm run autopush:dry-run
```

The loop only commits when there are changes, and it skips cycles if `git user.name` or `git user.email` is not configured.
