# ReadTheRoom Public Professional v3.4 Final

## Public routes

- Canonical route: `/read-the-room-public-pro/`
- Version alias: `/read-the-room-public-pro-v3-4/`
- Standalone local URL: `http://127.0.0.1:8877/read-the-room-public-pro-v3-4/`

## Product boundary

ReadTheRoom is the public proof experience for context-before-response. It demonstrates generic versus calibrated behavior, action restraint, review-before-learning, and downloadable receipts without exposing the private internal runtime.

## Canonical public runtime

Use the dedicated standalone server:

```bash
npm start
```

Equivalent command:

```bash
node scripts/read-the-room/readtheroomPublicServer.mjs
```

Optional environment variables:

```bash
HOST=127.0.0.1 PORT=8877 npm start
```

The standalone server is dependency-free and isolated from non-public company systems. Public deployments should use this packaged runtime only.

## Runtime protections

The dedicated public runtime:

- Serves only `read-the-room-public-pro/` static assets.
- Exposes only explicitly enumerated ReadTheRoom APIs plus minimal health.
- Returns `404` for repository files, internal APIs, documents, state, source paths, and traversal attempts.
- Keeps calibration data in process memory only.
- Ignores caller-selected session IDs and issues 128-bit random capability IDs.
- Expires sessions after one hour and caps the process at 1,000 sessions.
- Rejects malformed JSON, bodies larger than 64 KiB, and unsupported methods.
- Emits CSP, frame denial, `nosniff`, referrer, resource-isolation, and restrictive browser-permission headers.
- Loads no private profile or private runtime state.
- Installs no dependencies and executes no repository code outside the two packaged ReadTheRoom policy/session modules.

## Privacy behavior

- Typed prompts are sent to the hosted ReadTheRoom process and kept only in ephemeral process memory for the active session.
- The browser stores only the random session ID in `localStorage`; the server process stores the corresponding session until expiration or restart.
- Nothing becomes persistent profile learning without explicit review; the released product does not enable persistent profile writes.
- Voice recognition is handled by the user’s browser and may use its online speech service. ReadTheRoom receives only the resulting text and retains it in ephemeral session memory.
- The release does not claim zero processing, local-only processing, or absolute security.

## HTTPS deployment requirements

Bind the Node process to loopback and place it behind a managed HTTPS reverse proxy. The proxy or hosting layer must provide:

- TLS and HTTP-to-HTTPS redirect
- Request-rate limiting
- deployment logs with secret redaction
- process restart and health monitoring
- an explicit public hostname
- no direct access to the private repository or internal runtime

Do not announce the release until the actual HTTPS URL passes the production smoke matrix for routes, assets, MIME types, APIs, headers, traversal denial, prompt-injection refusal, session isolation, browser console/network state, and mobile/desktop behavior.

## Verification

Package verification:

```bash
npm test
```

Start the verified loopback runtime with `npm start`.

The Edge/CDP QA script verifies 1920×1080, 1600×900, 1366×768, and 390×844 viewports, pointer-driven controls, the quick-proof response path, duplicate IDs, horizontal overflow, font loading, console/network errors, root pseudo-element artifacts, and reduced-motion behavior.

## Release language

Allowed before real HTTPS verification:

> Code-complete and locally verified for a released product.

Allowed only after the deployed URL passes the production smoke:

> Deployed and verified for released product access.

Do not market the product as breach-proof, perfectly safe, or production-certified. The defensible claim is that ReadTheRoom uses explicit boundaries, ephemeral sessions, review-before-learning, action restraint, and verifiable release receipts.
