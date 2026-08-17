# mixR

A macOS desktop app — and a local website — that turns a list of songs into one continuous, beat-aware, crossfaded DJ mix and renders it to a real MP3 you can play, save, and share.

Name the songs, paste links, or drop files. mixR finds the audio, measures each track's tempo, key, and loudness, sequences them into a set that suits the vibe you picked, and renders a single 320 kbps MP3 with proper crossfades, level matching, and chapter markers.

Everything runs locally. There are no accounts, no API keys, and no server costs.

---

## Quick start

```bash
npm install
npm run dev
```

That launches the Vite dev server and the Electron app together. On first run the app asks to download **yt-dlp** (a free 3 MB tool it uses to find and fetch audio); click the button and wait a few seconds.

To use it in a browser instead (same machine, same library):

```bash
npm run web          # production UI + API at http://127.0.0.1:8787
npm run dev:web      # Vite hot reload + API, open http://localhost:5173
```

**Email link** in the top bar opens your mail app with a Wi-Fi address so someone on the same network can open mixR. Leave `npm run web` running while they use it. The desktop app stays on localhost and is not shared that way.

In the browser, **Install app** adds mixR to the Home Screen or the app drawer (Chrome/Edge on localhost, or Share → Add to Home Screen on iPhone). The Mac still has to be running `npm run web` — the phone is only the UI.

To run the website in Docker on a machine that already has Docker (not an old Mac):

```bash
docker compose up --build
```

Then open http://127.0.0.1:8787. Mixes persist in a Docker volume. This does not replace the `.pkg` for someone on Catalina — current Docker Desktop will not install there.

To build a standalone app:

```bash
npm run dist       # builds a DMG into release/
npm run dist:dir   # faster: unpackaged .app into release/mac/
```

## How it works

```
song name / link / file
        │
        ▼
  ingest ─────────► yt-dlp downloads the audio, ffmpeg transcodes it to a
        │           canonical 44.1 kHz stereo FLAC and caches it by fingerprint
        ▼
  analyze ────────► tempo (autocorrelation + octave correction), musical key
        │           (chroma + Krumhansl-Schmuckler), loudness (EBU R128),
        │           per-second energy and brightness, intro/outro points
        ▼
  plan ───────────► orders the set for the chosen vibe, allocates how long each
        │           track plays, picks blend lengths, and matches levels
        ▼
  render ─────────► one ffmpeg graph: trim, gain, EQ, chained acrossfade,
                    limiter → lossless intermediate → 320 kbps MP3 with tags
                    and one chapter per track
```

The whole pipeline is local. The only network traffic is fetching the songs you ask for.

### Why there is a local server

The UI talks to a small Express service on `127.0.0.1`. It exists because a browser page cannot download audio, run ffmpeg, or write files to disk — that work needs a Node process with real binaries. In the desktop app, Electron starts this service in-process; nothing is exposed outside your machine.

## What you can add to a mix

| Input | What happens |
| --- | --- |
| A song name | Searched on YouTube or SoundCloud; pick from live results as you type |
| A YouTube or SoundCloud link | Downloaded directly |
| A Spotify link | Read for artist and title, then matched to real audio elsewhere (Spotify serves no audio to third parties) |
| A local file | Used as-is — no download, works fully offline |

## Vibes

Forty vibes across four groups (time of day, season, genre, mood). The vibe you choose is not cosmetic: it sets the running order (lift, cruise, peak, dark, or moody), the length and curve of each blend, and a gentle mastering EQ. Picking several blends them into the profile closest to their average energy.

## The finished mix

- **320 kbps MP3**, 44.1 kHz stereo
- **Normalised to −14 LUFS** integrated, the common streaming level, with a true-peak limiter
- **Per-track gain matching** so no song jumps out
- **Chapter markers** for every track, so players can skip through the set
- **ID3 tags** with the mix name, vibe, and tracklist

Rendering is a deliberate two-pass process: the crossfaded mix is built losslessly first, then measured and encoded with a single static gain. A one-pass dynamic normaliser would pump the whole set, which is exactly what a DJ mix must not do.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + Electron, with hot reload |
| `npm run web` | Production website + API at http://127.0.0.1:8787 |
| `npm run dev:web` | Vite + the API, for working in a browser |
| `npm test` | The full test suite (637 tests) |
| `npm run typecheck` | Typechecks the client and the server/Electron code |
| `npm run build` | Typecheck, build the UI, bundle the Electron entry points |
| `npm run dist` | Build a macOS DMG into `release/` |
| `npm run doctor` | Checks ffmpeg, yt-dlp, and the data directories |
| `npm run check:search` | Prints live search results for a query |
| `npm run check:ingest` | Ingests one song and prints its analysis |
| `npm run check:render` | Builds a complete mix end to end |
| `npm run check:api` | Drives a running app through the HTTP API |
| `npm run build:icon` | Regenerates the app icon from code |

## Where files live

Everything is under `~/Library/Application Support/mixR`:

| Folder | Contents |
| --- | --- |
| `media/` | Cached lossless FLAC per song (~25–30 MB per 4-minute track) |
| `renders/` | Finished mixes (~2.4 MB per minute) |
| `analysis/` | Cached tempo/key/energy analysis |
| `bin/` | The downloaded yt-dlp |
| `library.json` | Your mixes and tracks |

Songs are cached so reusing one is instant. The Library screen shows what is on disk and lets you delete anything.

## Requirements

- macOS 10.15 Catalina or later (Intel x64 or Apple Silicon)
- Node.js 20 or newer (to build from source)
- Python 3.10+ *(optional)* — if present, yt-dlp runs as a fast Python zipapp; otherwise a slower self-contained binary is used

ffmpeg ships with the app. Nothing else needs installing.

## Project layout

```
electron/       main + preload processes
server/         local API: ingest, analyze, plan, render, library
  lib/analyze.ts    tempo, key, loudness, energy
  lib/render.ts     the ffmpeg filter graph
  lib/ingest.ts     search, download, transcode, cache
src/            React UI
  lib/mixEngine.ts  sequencing, blend lengths, level matching (shared)
tests/          637 tests over the planner, graph builder, and analysis
scripts/        build, diagnostics, and end-to-end checks
```

`src/lib/mixEngine.ts` is deliberately pure and shared by both sides, so the plan the UI draws is exactly the one the renderer builds.

## Known limitations

- **A short target with many songs will overrun.** No track is ever trimmed below 45 seconds, so ten songs cannot fit into five minutes. The plan says so in its warnings rather than reducing the set to fragments.
- **Key detection is approximate on sparse material.** Confidence is reported, and low-confidence results are called out in the plan notes.
- **The packaged app is unsigned.** On first launch, right-click the app and choose Open.

## A note on sources

mixR uses yt-dlp, the same way a person would use it from a terminal. Downloading audio from YouTube is against its Terms of Service. Nothing is uploaded or redistributed, but that is the tradeoff for fetching songs by name — use your own judgement, and prefer local files or material you have rights to.
