# BSV Evidence Gate

A public proof-of-concept for court-authorized, retention-bound video evidence
using encrypted UHRP storage and controller-owned GlobalKVStore state on BSV.

The demo uses fictional identities and clearly marked synthetic footage. It is
not a production evidence-management system and makes no claim that a network
can prove every third-party copy was erased. Instead, it demonstrates:

- AES-256-GCM encryption before storage;
- content-addressed ciphertext resolution through UHRP;
- signed, time-limited court-order credentials;
- role-gated decryption;
- spend-linked PushDrop state transitions and independent overlay verification; and
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

The release scripts make every paid action explicit and bounded:

```sh
npm run uhrp:estimate
CONFIRM_BSV_SPEND=YES MAX_UHRP_SATS=100 npm run uhrp:publish
npm run state:plan
CONFIRM_BSV_SPEND=YES MAX_STATE_WRITES=12 MAX_STATE_SATS=18000 npm run state:publish
```

`uhrp:publish` uploads only the encrypted object. `state:publish` creates two
independent six-state GlobalKVStore chains: one ends in `HELD`, and its companion
no-hold record ends in `EXPIRED`. Every update spends the previous PushDrop token;
the generic `tm_kvstore` overlay tracks the live UTXO and retains its history.
The publisher refuses to run unless the exact remaining write count and the
conservative satoshi ceiling are supplied. It is resumable and refuses to advance
a chain whose live history differs from the deterministic manifest.

The seven original OP_RETURN markers remain in `demo-config.json` as
`legacyReceipts` for audit continuity. They are not presented as authoritative
state and are not used by the verifier.

## Verification model

The public verifier resolves both keys from `ls_kvstore`, reconstructs the
oldest-to-newest histories, checks the evidence ID and transition sequence,
pins the expected controller identity, verifies each current PushDrop signature,
and confirms the overlay tip matches the published outpoint. This makes an
update a spend of the prior state rather than an unrelated data receipt.

The shared KV overlay validates token structure, controller signatures, and UTXO
ownership. The application validates the evidence-specific state machine. A
production system should move those transition rules into a dedicated evidence
topic manager instead of relying on a browser verifier alone.

## Security boundary

The public guided demo contains fictional demo identities and a recoverable
demo decryption key so every visitor can complete the experience. Production
systems must keep keys in an independently secured service or hardware-backed
wallet, authenticate real institutions, and enforce applicable evidence law.
