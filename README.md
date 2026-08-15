# ReadTheRoom

**Make your AI stop feeling generic.**

ReadTheRoom is a local, reviewable behavior-calibration layer for AI assistants.
A short guided session tunes how your assistant handles directness, warmth,
humor, profanity, corrections, brainstorming, short messages, and tool restraint
, without turning every conversation into a settings panel.

One guided session. Zero generic presets. Your AI actually *reads the room.*

> Public Professional v3.4 is a released product. Calibration state is ephemeral and local to the running process. It is not a hosted account service or a production SLA.

![ReadTheRoom calibration studio](docs/images/readtheroom-desktop.png)

Run the proof, drop in a prompt, and compare Default AI vs ReadTheRoom side by side.

## What it does

- **Guided behavior calibration**, tune real behavior, not tone sliders
- **Explicit profile and context controls**, you decide what the AI knows and how it acts
- **Sandbox-style experimentation**, test freely, nothing learns silently
- **Reviewable calibration receipts**, see exactly what changed and why
- **Public-only runtime boundaries**, loopback by default, no silent data collection
- **Responsive desktop and mobile**, calibrate anywhere

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm test
npm start
```

Open `http://127.0.0.1:8877/read-the-room-public-pro-v3-4/`.

No dependency installation is required. The package uses Node's built-in runtime and test runner.

## Why it exists

Most "AI personality" settings are a slider and a prayer. ReadTheRoom treats
behavior calibration as a first-class problem: a guided session that produces a
reviewable, repeatable behavior profile, so your assistant stops sounding like
a default and starts sounding like *yours*.

## Public API surface

The standalone server exposes only the public calibration application and its documented profile, artifact, archetype, apply, session, and health routes. Internal MAYA runtime files and private profiles are not included.

## Verification

```bash
node --check scripts/read-the-room/readtheroomPublicServer.mjs
node --check scripts/read-the-room/readtheroomPolicy.js
node --check scripts/read-the-room/readtheroomCalibrationSession.js
node --check scripts/read-the-room/rtrToMemoryLane.mjs
npm test
```

A ready-to-enable GitHub Actions template is included at `docs/ci/verify.yml.example`; local verification remains the release authority for this release.

The release has also passed clean-extraction, browser, responsive-layout, session-isolation, malformed-request, and public-boundary audits. See [PUBLIC_LIMITS.md](PUBLIC_LIMITS.md) for the precise claim boundary.

## Security and privacy

- Loopback-only server by default
- Ephemeral in-memory calibration sessions
- No account system or telemetry
- Hardened browser response headers
- Explicit route allowlist and traversal denial

Do not expose the development server directly to the internet. Report sensitive findings privately using [SECURITY.md](SECURITY.md).

## Memory Layer (Memory Lane bridge)

Completed calibration sessions can be sealed into a [Memory Lane](https://github.com/MAYA-Platform/MAYA-Memory-Lane) library — the same tamper-evident, chain-verified, searchable memory layer that powers MAYA and Hermes. A session that lives in a local JSON file today becomes a sealed, chain-linked block you can search, resume, and prove hasn't been altered.

```bash
node scripts/read-the-room/rtrToMemoryLane.mjs \
  --store path/to/readtheroom-calibration-sessions.json \
  --ml-base http://127.0.0.1:8770
```

Deterministic and free: facts are written explicitly (no LLM extraction, no token cost). Re-running is idempotent — a session ledger (`data/.rtr-ml-sync-ledger.json`) prevents double-sealing. Use `--dry-run` to preview first. The bridge runs against any Memory Lane server (`MEMORY_LANE_LIBRARY` pointed at your own library).

This is the read side of the same loop: Memory Lane collects itself (write) and answers questions across sessions (read) — ReadTheRoom calibration history becomes durable, queryable memory instead of an editable local file.

## License

ReadTheRoom Public Professional is distributed under the MIT License. See [LICENSE.txt](LICENSE.txt) for the full terms.

Bundled font files remain governed by their own notices: [OFL-Inter.txt](read-the-room-public-pro/assets/fonts/OFL-Inter.txt) and [OFL-JetBrains-Mono.txt](read-the-room-public-pro/assets/fonts/OFL-JetBrains-Mono.txt).

Copyright (c) 2026 2ndNatureAi.
