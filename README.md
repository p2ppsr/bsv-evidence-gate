# BSV Evidence Gate

A public proof-of-concept for privacy-first video evidence on BSV.

[Open the live demo](https://evidence.bsv.media/)

Body-camera footage stays encrypted until a signed court order grants narrow,
time-limited access. The design lets the public inspect the evidence history
without receiving general access to a real video. In this demo, every visitor
can play each fictional role and open the synthetic footage.

## What the demo shows

- The synthetic video is encrypted with AES-256-GCM before storage.
- Only the encrypted file is published through UHRP.
- The browser creates and verifies a signed 30-minute court order.
- The browser checks the encrypted file's SHA-256 fingerprint before opening it.
- The opened video is checked against its original SHA-256 fingerprint.
- Two controller-owned GlobalKVStore histories on BSV demonstrate the legal-hold
  and seven-day-expiry outcomes.
- The independent verifier checks both six-step histories, their expected
  controller, their transition order, their current PushDrop signatures, and
  their published tip outpoints.

The guided controls do not publish a new transaction for each visitor. They
replay a fictional case and reveal the matching transactions from two
prepublished mainnet histories:

```text
CAPTURED
  -> STORED
  -> ACCESS_REQUESTED
  -> AUTHORIZED
  -> VIEWED
  -> HELD or EXPIRED
```

The hold and expiry paths are separate records. They are not competing spends
of one state token.

## What is real and what is simulated

The following parts run for real:

- UHRP retrieval of the encrypted video
- encrypted-file and original-video fingerprint checks
- in-browser P-256 court-order signing and verification
- in-memory AES-GCM decryption
- mainnet GlobalKVStore lookup and history reconstruction
- current PushDrop signature, controller, transition, and tip verification
- links to the six BSV transactions in the selected outcome

The policy outcome is simulated. Running the expiry path does not delete the
published UHRP object and does not destroy the public demo key. The interface
shows how a production evidence service would remove its official copy and
retire externally managed key material. This repository intentionally includes
a recoverable deterministic key so every visitor can complete the demo.

No blockchain or evidence system can prove that an unauthorized third party
never made a separate copy. The public record proves what the governed system
committed to doing.

## How it works

### Encrypted evidence

The deterministic build reads the synthetic source clip from
`frontend/assets-source/bodycam-demo.mp4`, writes the encrypted object to
`frontend/public/evidence/bodycam-demo.mp4.enc`, and generates
`frontend/src/demoEvidence.generated.ts`.

The deterministic key and IV make this public demo reproducible. Production
keys must be random, secret, and managed outside the web application.

At runtime, the browser:

1. retrieves the encrypted object from the configured UHRP URL;
2. compares its SHA-256 fingerprint with the published manifest;
3. verifies the signed court order;
4. decrypts the video in memory; and
5. compares the opened video with the original capture fingerprint.

### Public BSV state

`frontend/public/demo-config.json` contains two published GlobalKVStore
records:

- `EV-2026-1042-A`, ending in `HELD`;
- `EV-2026-1042-B`, ending in `EXPIRED`.

Each update spends the previous controller-owned PushDrop token. The shared
`tm_kvstore` topic manager tracks the current UTXO, while `ls_kvstore`
returns the record and its history.

The application adds evidence-specific checks in the browser. It requires the
exact six states for each outcome, rejects skipped or reordered states,
rejects evidence-ID substitution, pins the expected controller, verifies the
current token signature, and requires the returned tip to match the manifest.

The seven original OP_RETURN markers remain in `demo-config.json` as
`legacyReceipts` for audit continuity. The application does not use them as
authoritative state.

### Court order

The guided scenario creates an ephemeral ECDSA P-256 key pair in the browser,
signs a canonical JSON court-order payload, and verifies that signature before
opening the video. This demonstrates the authorization flow, not a real court
identity or production credential system.

## Local development

Requirements:

- Node.js 22
- npm

Install and run:

```sh
npm ci
npm --prefix frontend ci
npm run verify
npm run dev
```

The local site is served by Vite at `http://127.0.0.1:5173`.
`npm run verify` regenerates the deterministic encrypted evidence, runs the
five Vitest tests, checks TypeScript, and creates the production frontend build.

Useful commands:

```sh
npm test
npm run build:frontend
npm run encrypt:evidence
npm --prefix frontend run preview
```

## Mainnet publication

These commands can spend BSV. Estimate and plan first:

```sh
npm run uhrp:estimate
npm run state:plan
```

Publishing is deliberately guarded by an explicit approval flag and a satoshi
ceiling:

```sh
CONFIRM_BSV_SPEND=YES MAX_UHRP_SATS=100 npm run uhrp:publish
CONFIRM_BSV_SPEND=YES \
  MAX_STATE_WRITES="$PLANNED_WRITES" \
  MAX_STATE_SATS="$PLANNED_CEILING" \
  npm run state:publish
```

`uhrp:publish` uploads only the encrypted object and updates
`demo-config.json`. Its default requested retention period is 43,200 minutes.

`state:publish` requires an authenticated mainnet BRC-100 wallet. It is
resumable, requires `MAX_STATE_WRITES` to equal the exact remaining write
count reported by `state:plan`, and requires `MAX_STATE_SATS` to meet that
plan's conservative ceiling. It refuses to continue if live history differs
from the deterministic manifest. Each accepted transaction is submitted to the
pinned overlay and confirmed through the lookup service before publication
advances. The current manifest is already fully published, so its remaining
write count is zero.

## Deployment

The production site is a frontend-only CARS deployment:

- Site: [evidence.bsv.media](https://evidence.bsv.media/)
- Network: BSV mainnet
- CARS project: `aa29efd9c43b3aa923430fc1d062f82e`
- Deployment trigger: pushes to `master`
- Required GitHub Actions secret: `CARS_PRIVATE_KEY`
- Optional GitHub Actions secret: `CARS_WALLET_STORAGE`

The deployment workflow installs locked dependencies, runs `npm run verify`,
builds the CARS artifact, checks transport and project balance, and releases the
frontend over HTTPS.

## Project layout

```text
frontend/
  assets-source/                  synthetic source video
  public/demo-config.json        live UHRP and BSV record manifest
  public/evidence/                encrypted video and preview assets
  scripts/encrypt-evidence.mjs    deterministic demo encryption
  src/App.tsx                     guided experience and verifier UI
  src/demoCrypto.ts              signing, hashing, and decryption
  src/evidenceLedger.ts          GlobalKVStore history verification
scripts/
  publish-uhrp.mjs               guarded encrypted-file publisher
  publish-global-state.mjs       guarded, resumable state publisher
.github/workflows/deploy.yaml     verification and CARS deployment
```

## Production requirements

A production implementation must add:

- real institutional identity and authorization;
- secret, external key custody or hardware-backed wallets;
- server-enforced access windows and purpose restrictions;
- an evidence-specific topic manager that enforces transitions before admission;
- actual storage retirement and key-destruction procedures;
- operational audit, recovery, legal-hold, and incident-response controls; and
- review against the evidence and privacy laws of each jurisdiction.

## License

[Open BSV License](LICENSE.txt)
