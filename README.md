# BSV Evidence Gate

A public proof-of-concept for court-authorized, retention-bound video evidence
using encrypted UHRP storage and a BSV audit trail.

The demo uses fictional identities and clearly marked synthetic footage. It is
not a production evidence-management system and makes no claim that a network
can prove every third-party copy was erased. Instead, it demonstrates:

- AES-256-GCM encryption before storage;
- content-addressed ciphertext resolution through UHRP;
- signed, time-limited court-order credentials;
- role-gated decryption;
- BSV-anchored lifecycle events and independent verification; and
- cryptographic expiry by retiring the official object and destroying its key.

## Development

```sh
npm install
npm --prefix frontend install
npm run verify
npm run dev
```

The encryption build script turns the synthetic source clip in
`frontend/assets-source` into the ciphertext shipped with the local demo. The
live deployment config can replace that local ciphertext URL with a UHRP URL.

## Mainnet publication

The release scripts make every paid action explicit and quote-capped:

```sh
npm run uhrp:estimate
CONFIRM_BSV_SPEND=YES MAX_UHRP_SATS=100 npm run uhrp:publish
CONFIRM_BSV_SPEND=YES MAX_ANCHOR_SATS=1000 npm run anchor:demo
```

`uhrp:publish` uploads only the encrypted object. `anchor:demo` creates seven
small BSV data transactions for the fictional scenario and records their TXIDs
in `frontend/public/demo-config.json`. Both commands refuse to spend without the
explicit confirmation environment variable and a positive satoshi cap.

## Security boundary

The public guided demo contains fictional demo identities and a recoverable
demo decryption key so every visitor can complete the experience. Production
systems must keep keys in an independently secured service or hardware-backed
wallet, authenticate real institutions, and enforce applicable evidence law.
