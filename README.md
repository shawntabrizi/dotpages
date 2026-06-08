# hello-playground

A single-page WYSIWYG site builder that runs as a `.dot.li` app and deploys what you type — straight to IPFS (via Bulletin Chain) and a `.dot` name. Built for the "open a thing, type two fields, tap deploy, you have a website" demo.

The deployer itself is meant to be hosted at `hello-playground.dot` (or wherever) and accessed inside Polkadot Desktop / Polkadot Mobile. Everything runs in-browser — no backend, no CORS proxy, no native binaries.

## What's here

```
hello-playground/
├── index.html
├── package.json           # React 19 + Vite + host-api 0.8.6 + product-sdk + multiformats + @noble/hashes
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx           # entry
    ├── App.tsx            # editor + preview + deploy panel; owns all state
    ├── template.ts        # bare HTML template + renderHtml(siteContent) + Block model
    ├── signer.ts          # Host API 0.8.6 SignerManager wrapper + useResourceAllocationState
    ├── account.ts         # ActiveAccount — host / extension / dev signer sources
    └── deploy.ts          # CID compute + auto-name derivation + full chain submission
```

## What's wired

- **Editor + preview.** Block-based WYSIWYG editor (headings, paragraphs, links/buttons, images, dividers) with Markdown and HTML/CSS/JS modes. The iframe preview renders `renderHtml(content)` live — **the exact bytes that would be uploaded.**
- **Three signing modes via `src/account.ts`** — `ActiveAccount` is the uniform shape; sources are wired independently so toggling between them never tears down the others:
  - `host` — Polkadot Desktop / Mobile via `@parity/product-sdk-signer` (host-api 0.8.6). Tried automatically on mount; gated on `BulletinAllowance` + `SmartContractAllowance` both `Allocated`.
  - `extension` — Talisman / SubWallet / Polkadot.js via `polkadot-api/pjs-signer`. Surfaced as a "Connect browser wallet" button.
  - `dev` — `//Bob` via `createDevSigner` from `@parity/product-sdk-tx`. Always available; useful for local development.
- **Full chain deploy** (requires Polkadot host — see below): Bulletin store via `CloudStorageClient` + DotNS register + content-hash bind. All three signer sources (host / extension / dev) submit for real.
- **CID computation** works standalone: Blake2b-256 + raw codec (`0x55`) computed client-side. Pressing Deploy in a plain browser shows the bytes, CID, and gateway URL — nothing is submitted.
- **Auto-name.** Leave the `.dot name` field blank and the deployer picks a NoStatus-shape label (base ≥9 chars + exactly 2 trailing digits, so any signer without PoP can register it).

[^1]: Inline reference for the protocol detail — not the actual link. See the skill in `~/.claude/skills/bulletin-storage` for the authoritative version.

## End-to-end deploy

**In-app deploy requires running inside a Polkadot host (Desktop or Mobile).** The Bulletin store is host-routed via `CloudStorageClient` (from `@parity/product-sdk-chain-client`) and DotNS via `createPapiProvider` — both require the host's chain transport. There is no direct-WS fallback; outside a host the SDK throws `"Host provider unavailable"`. Opening in a plain browser (`npm run dev`) is preview-only: the editor, live preview, and CID computation all work, but nothing is submitted.

When running inside a host, "Deploy" runs the full chain dance — no `bulletin-deploy`, no Kubo, no backend:

1. **Bulletin store** — `CloudStorageClient.store(bytes)` → wait for inclusion. Yields CID + block.
2. **DotNS register** (ENS-style commit-reveal):
   - `Revive.map_account()` (one-shot, cached per session)
   - `REGISTRAR_CONTROLLER.makeCommitment(...)` (read-only)
   - `REGISTRAR_CONTROLLER.commit(commitment)` (extrinsic)
   - Wait `minCommitmentAge` (~60 s) — front-running protection, mandatory
   - `POP_RULES.priceWithoutCheck(label, ownerH160)` → price × 1.1 / NATIVE_TO_ETH_RATIO
   - `REGISTRAR_CONTROLLER.register(registration)` (extrinsic, with payment value)
3. **Content hash bind** — `CONTENT_RESOLVER.setContenthash(namehash("<label>.dot"), encodeIpfsContenthash(cid))`

The DotNS phase is **best-effort**: if register / setContenthash fails (most commonly because the signer has no PAS for fees on Asset Hub Next), the result card still shows the successful Bulletin store + gateway URL.

### Lib layout

```
src/lib/
├── polkadot/
│   ├── constants.ts        ← AH-Next RPC + genesis, BULLETIN_GATEWAY, 5 DotNS contract addresses, NATIVE_TO_ETH_RATIO
│   └── clients.ts          ← Cached PAPI client for Asset Hub (host-routed via createPapiProvider in-host, direct WS standalone)
├── bulletin/
│   ├── submit-and-wait.ts  ← Observable → Promise tx helper (handles signed/broadcast/inBlock/finalized)
│   └── store.ts            ← Authorization check + CloudStorageClient store (host-routed, environment: "paseo")
└── dotns/
    ├── abis.ts             ← REGISTRY / REGISTRAR_CONTROLLER / CONTENT_RESOLVER / POP_RULES Solidity-style fragments
    ├── namehash.ts         ← viem namehash wrapper
    ├── address.ts          ← SS58 → H160 via ReviveApi.address (cached)
    ├── contracts.ts        ← ensureAccountMapped + dryRunContractCall + submitContractCall
    ├── register.ts         ← Commit-reveal flow
    └── content-hash.ts     ← encodeIpfsContenthash + setContenthash submission
```

### Prereqs for a successful deploy (any signer)

- **Running inside Polkadot Desktop or Mobile.** Chain access is host-routed. `npm run dev` in a plain browser is preview-only.
- **Bulletin authorization** for the signing address. One-time via [the self-serve faucet](https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet).
- **PAS on Asset Hub Next** for the signer's mapped H160. Contract calls aren't feeless — register + setContenthash + the initial map_account all need fees. Use [the PAS faucet](https://faucet.polkadot.io/) — pick "Paseo Asset Hub Next".
- **Host resource grants** (host-signer only): both `BulletinAllowance` and `SmartContractAllowance` must be `Allocated`. The Deploy panel shows a "Request host allowances" button when they're missing.
- **~60 s patience** between commit and register — the commitment age is protocol-mandated (front-running protection).

> **Note on AH-Next testnet resets:** Asset Hub Next is a testnet; its genesis hash rotates after resets. If DotNS calls start failing with descriptor mismatches, re-run `npx papi update` followed by `npx papi generate`, then update `ASSET_HUB_GENESIS` in `src/lib/polkadot/constants.ts` to the new value from `.papi/polkadot-api.json` (`"pah".genesis`).

## Run

```sh
npm install
npm run dev
```

Open the dev server. The editor + preview render fully. The Deploy button computes the CID and shows the gateway URL (preview-only — chain submission requires running inside a Polkadot host).

## Deploy this app to `hello-playground.dot.li`

The deployer itself ships via [playground-cli](https://github.com/paritytech/playground-cli) (the `dot` command). It builds `dist/`, uploads the static bundle to Bulletin, and registers `hello-playground.dot` on DotNS — pointing at the resulting CID.

```sh
# one-time: install + provision session keys
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash
dot init

# every release: build is auto-run by the CLI
npm run deploy:dot -- --signer phone
```

For unattended / CI deploys, swap the signer for a dev keypair:

```sh
npm run deploy:dot -- --signer dev --suri //Alice
```

Useful flags to pass through (`npm run deploy:dot -- ...`):

- `--playground` — publish to the Playground registry so it appears in users' "my apps".
- `--moddable` — publish the source repo URL so others can `dot mod hello-playground`.
- `--no-build` — skip the Vite build (assume `dist/` is already current).
- `--env <paseo-next-v2|testnet|mainnet>` — target network (default matches what the app talks to in-browser).

The signer hostname mapping in `src/signer.ts::getProductAccountIdentifier` already collapses `hello-playground.dot.li` back to the `hello-playground.dot` product identifier, so host-signed flows keep working under the deployed origin.

## Conventions

- React 19 + Vite + TypeScript. Plain CSS with custom-property tokens (not Tailwind — see "design system" note below).
- **Three-way signer resolution.** Host API 0.8.6 first (tried automatically on mount), then injected extension, with `//Bob` as a one-tick override for "I just want to test the flow without setting anything up." All three sources submit for real when running inside a host.
- HTML escaping in `template.ts::escape` covers all five XML entities. URLs in image/link blocks go through `safeUrl()` which rejects anything that isn't `http(s)`, relative, or a fragment — so a user can't smuggle a `javascript:` URL into the produced page.
- The preview iframe uses `sandbox="allow-scripts allow-popups"`. No `allow-same-origin` — the generated HTML can't reach back into the editor or call `window.parent`.

### Design system note

This project intentionally **does not** adopt the Tailwind-based `polkadot-design-system` skill yet. The parent template (`playground-app-template`) uses plain CSS with custom-property tokens, and matching it is more important during scaffolding than enforcing the full design system. A future migration to the design system is one of the open follow-ups.

## Open follow-ups

- [ ] Account-picker UI for the extension path — today we auto-pick the first extension's first account.
- [ ] Tiptap or contenteditable for richer in-place editing if the structured-form pattern turns out to be too limiting.
- [ ] Migrate styling to the Tailwind-based `polkadot-design-system` once a few more usage patterns settle.
- [ ] The local `.papi/bulletin` descriptor is now unused (the `CloudStorageClient` uses its own bundled chain client). It can be pruned with `npx papi remove bulletin` when convenient — left in place for now to avoid churn.
