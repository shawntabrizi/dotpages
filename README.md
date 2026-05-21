# hello-playground

A single-page WYSIWYG site builder that runs as a `.dot.li` app and deploys what you type — straight to IPFS (via Bulletin Chain) and a `.dot` name. Built for the "open a thing, type two fields, tap deploy, you have a website" demo.

The deployer itself is meant to be hosted at `hello-playground.dot` (or wherever) and accessed inside Polkadot Desktop / Polkadot Mobile. Everything runs in-browser — no backend, no CORS proxy, no native binaries.

## What's here

```
hello-playground/
├── index.html
├── package.json           # React 19 + Vite + product-sdk + multiformats + @noble/hashes
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx           # entry
    ├── App.tsx            # layout: editor pane (left) + iframe preview (right)
    ├── App.css            # plain CSS, mobile-first via media query at 720px
    ├── Editor.tsx         # form fields (header, subheader, accent, background, font) + add-block menu
    ├── Preview.tsx        # iframe with srcDoc = renderHtml(content) — byte-for-byte the deploy artifact
    ├── template.ts        # the bare HTML template + renderHtml(siteContent) + Block model
    ├── signer.ts          # Host API SignerManager wrapper, adapted from playground-app-template
    └── deploy.ts          # CID compute + auto-name derivation; chain submission is TODO
```

## What's wired

- **Editor + preview.** A form with header / subheader / accent / background / font fields, plus an "Add element" button for extra paragraphs, links, images, and dividers. The iframe preview renders `renderHtml(content)` live — **the exact bytes that would be uploaded.**
- **Three signing modes via `src/account.ts`** — `ActiveAccount` is the uniform shape; sources are wired independently so toggling between them never tears down the others:
  - `host` — Polkadot Desktop / Mobile via `@parity/product-sdk-signer` (same pattern as the template). Tried automatically on mount.
  - `extension` — Talisman / SubWallet / Polkadot.js via `polkadot-api/pjs-signer`. Surfaced as a "Connect browser wallet" button when host is unavailable.
  - `dev` — `//Bob` via `createDevSigner` from `@parity/product-sdk-tx`. Always wins when the checkbox is ticked, so a local dev session works with no wallet at all.
- **CID computation.** Blake2b-256 + raw codec (`0x55`) — matches Bulletin's default per the [bulletin-storage skill](https://publicsuffix.org/list/public_suffix_list.dat) [^1]. Computed client-side from `@noble/hashes` + `multiformats`. Pressing Deploy shows the bytes, the CID, and the `.dot.li` URL you'd land at.
- **Auto-name.** Leave the `.dot name` field blank and the deployer picks a NoStatus-shape label (matches `dot decentralize`'s rule: base ≥9 chars + exactly 2 trailing digits, so any signer without PoP can register it).

[^1]: Inline reference for the protocol detail — not the actual link. See the skill in `~/.claude/skills/bulletin-storage` for the authoritative version.

## What's NOT wired (and why)

The "Deploy" button stops at **preview**: it computes the bytes + CID + target name, shows them, and prints `Chain submission is not yet wired`. Three reasons it's not a one-line follow-up:

1. **Open question on the `.dot.li` resolver.** Bulletin storage of a raw single-file (codec `0x55`) gives you a `bafkrei…` CID. The CLI's `dot deploy` path goes through bulletin-deploy, which builds a UnixFS DAG-PB directory containing `index.html` (a `bafybei…` CID). We don't know empirically whether the `.dot.li` resolver SPA accepts the raw-codec single-file CID, or requires the directory wrapper. **One quick test before wiring this**: deploy a raw blob via `TransactionStorage.store`, point a fresh DotNS contenthash at the resulting CID, load `<name>.dot.li`, check whether it renders or 404s. If raw works, the rest is ~50 LOC. If we need a wrapper, that's another ~150 LOC of hand-built DAG-PB protobuf (no Kubo needed, but more glue).
2. **DotNS register isn't a single SDK call yet.** The CLI does this via `bulletin-deploy` + `pallet-revive`. Calling the DotNS contract directly from browser PAPI needs the ABI, the live contract addresses (already in `playground-cli/src/config.ts`), and the same `withSpan` retry + commit-reveal logic — non-trivial.
3. **Resource allocation.** `BulletInAllowance` and `SmartContractAllowance` are requested at connect time, but we don't yet verify the outcome before submitting. Unauthorized stores fail **silently** on Bulletin Chain (per the skill's Global Invariants), so we'd need to gate the submit on a confirmed `Allocated` outcome.

`src/deploy.ts` has TODO comments at each of these handoff points.

## Run

```sh
npm install
npm run dev
```

Open the dev server. The editor + preview should both render with the default content. The Deploy button works against the in-memory preview today — wire up the chain submission next.

## Conventions

- React 19 + Vite + TypeScript. Plain CSS with custom-property tokens (not Tailwind — see "design system" note below).
- **Three-way signer resolution.** Host API first, then injected extension, with `//Bob` as a one-tick override for "I just want to test the flow without setting anything up." Per the polkadot-triangle skill's host-first / standalone-fallback rule. The host signer's `signBytes` is stubbed today — chain submission will call `signerManager.signRaw(...)` directly via the source-specific path, not the bare PAPI signer.
- HTML escaping in `template.ts::escape` covers all five XML entities. URLs in image/link blocks go through `safeUrl()` which rejects anything that isn't `http(s)`, relative, or a fragment — so a user can't smuggle a `javascript:` URL into the produced page.
- The preview iframe uses `sandbox="allow-popups allow-popups-to-escape-sandbox"`. No `allow-scripts`, no `allow-same-origin` — the generated HTML can't reach back into the editor or call `window.parent`.

### Design system note

This project intentionally **does not** adopt the Tailwind-based `polkadot-design-system` skill yet. The parent template (`playground-app-template`) uses plain CSS with custom-property tokens, and matching it is more important during scaffolding than enforcing the full design system. A future migration to the design system is one of the open follow-ups.

## Open follow-ups

- [ ] Empirically test whether `.dot.li` resolves raw-codec CIDs or requires UnixFS directory wrapping. Decide the storage shape.
- [ ] Wire `TransactionStorage.store` with the right Observable handling (per `bulletin-storage` skill: `.subscribe()`, `txBestBlocksState && found`, unsubscribe on both paths).
- [ ] Wire DotNS register + setContenthash via `product-sdk-contracts`.
- [ ] Gate "Deploy" on a confirmed `Allocated` outcome for both `BulletInAllowance` and `SmartContractAllowance`.
- [ ] Account-picker UI for the extension path — today we auto-pick the first extension's first account.
- [ ] Resolve the host `signer` stub so chain submission can use a uniform `PolkadotSigner` across all three sources (or branch on `source` at submit time).
- [ ] Tiptap or contenteditable for richer in-place editing if the structured-form pattern turns out to be too limiting.
- [ ] Migrate styling to the Tailwind-based `polkadot-design-system` once a few more usage patterns settle.
