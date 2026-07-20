# ReadTheRoom

**Context before response.**

ReadTheRoom is a local, reviewable behavior-calibration layer for AI assistants. A short guided session tunes how an assistant handles directness, warmth, humor, profanity, corrections, brainstorming, short messages, and tool restraint without turning every conversation into a settings panel.

> Public Professional v3.4 is a controlled public beta. Calibration state is ephemeral and local to the running process. It is not a hosted account service or a production SLA.

![ReadTheRoom calibration studio](docs/images/readtheroom-desktop.png)

## What it proves

- Guided behavior calibration instead of generic tone presets
- Explicit profile and context controls
- Sandbox-style experimentation without silent durable learning
- Reviewable calibration receipts
- Public-only runtime boundaries and loopback-by-default operation
- Responsive desktop and mobile experience

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm test
npm start
```

Open `http://127.0.0.1:8877/read-the-room-public-pro-v3-4/`.

No dependency installation is required. The package uses Node's built-in runtime and test runner.

## Public API surface

The standalone server exposes only the public calibration application and its documented profile, artifact, archetype, apply, session, and health routes. Internal MAYA runtime files and private profiles are not included.

## Verification

```bash
node --check scripts/read-the-room/readtheroomPublicServer.mjs
node --check scripts/read-the-room/readtheroomPolicy.js
node --check scripts/read-the-room/readtheroomCalibrationSession.js
npm test
```

A ready-to-enable GitHub Actions template is included at `docs/ci/verify.yml.example`; local verification remains the release authority for this beta.

The release has also passed clean-extraction, browser, responsive-layout, session-isolation, malformed-request, and public-boundary audits. See [PUBLIC_BETA_LIMITS.md](PUBLIC_BETA_LIMITS.md) for the precise claim boundary.

## Security and privacy

- Loopback-only server by default
- Ephemeral in-memory calibration sessions
- No account system or telemetry
- Hardened browser response headers
- Explicit route allowlist and traversal denial

Do not expose the development server directly to the internet. Report sensitive findings privately using [SECURITY.md](SECURITY.md).

## License

Source-available under the [2ndNatureAi Public Beta Evaluation License](LICENSE.txt). Evaluation and good-faith security research are allowed; redistribution, commercial use, hosted service use, and production deployment require written authorization.

Copyright © 2026 2ndNatureAi.
