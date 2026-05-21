// Deploy flow.
//
// What's wired today: HTML rendering, CID computation (Blake2b-256, raw codec
// — matches Bulletin Chain's default per the bulletin-storage skill), and an
// auto-name derivation if the user leaves the field blank.
//
// What's NOT yet wired: the actual chain extrinsics. `previewDeploy` returns
// what WOULD be deployed — the bytes, the CID, the target URL — so the UI can
// render a meaningful confirmation today, and the on-chain submission can be
// dropped in without changing the call site.
//
// TODO when the chain bits land:
//   1. signerManager.requestResourceAllocation() (already invoked at connect)
//   2. Build a Bulletin client via createPapiProvider(bulletinGenesisHash)
//   3. api.tx.TransactionStorage.store(Binary.fromBytes(bytes)).signSubmitAndWatch(...).subscribe(...)
//      (per bulletin-storage skill: Observable, NOT Promise; check
//      `ev.type === 'txBestBlocksState' && ev.found`; unsubscribe in
//      success AND error)
//   4. DotNS register + setContenthash via pallet-revive (product-sdk-contracts).
//      Open question: does the .dot.li resolver accept a raw CIDv1
//      (codec 0x55) or require a UnixFS directory wrapper containing
//      `index.html`? Empirical test before wiring this up.

import { blake2b } from "@noble/hashes/blake2b";
import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";

const RAW_CODEC = 0x55;
const BLAKE2B_256_MULTIHASH_CODE = 0xb220;

export interface DeployPreview {
    bytes: number;
    cid: string;
    domain: string;
    url: string;
}

function computeCid(bytes: Uint8Array): CID {
    const hash = blake2b(bytes, { dkLen: 32 });
    const digest = Digest.create(BLAKE2B_256_MULTIHASH_CODE, hash);
    return CID.createV1(RAW_CODEC, digest);
}

// Auto-derive a NoStatus-shape label from the header text. The CLI's
// `dot decentralize` random-name picker uses the same constraint (base
// length >= 9 + exactly 2 trailing digits = NoStatus per DotNS's classifier).
// Mirror that here so the deployer doesn't accidentally pick a PoP-gated
// name from a user header like "Hi".
function deriveDomain(seed: string): string {
    let s = seed
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (!s) s = "hello";
    if (s.length > 24) s = s.slice(0, 24).replace(/-+$/, "");
    const letters = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map((b) => String.fromCharCode(97 + (b % 26)))
        .join("");
    const digits = String((crypto.getRandomValues(new Uint8Array(1))[0] % 90) + 10);
    // Pad so prefix + letters >= 9 chars (NoStatus base-length threshold).
    const minPrefixLen = 9;
    const prefixLen = s.length + 1; // +1 for the connecting hyphen
    const padded = prefixLen + letters.length >= minPrefixLen
        ? letters
        : letters + "abcd".slice(0, Math.max(0, minPrefixLen - prefixLen - letters.length));
    return `${s}-${padded}${digits}`;
}

export async function previewDeploy(html: string, domain: string | null): Promise<DeployPreview> {
    const bytes = new TextEncoder().encode(html);
    const cid = computeCid(bytes);
    const finalDomain = (domain ?? "").replace(/\.dot$/i, "") || deriveDomain(html.slice(0, 64));
    return {
        bytes: bytes.length,
        cid: cid.toString(),
        domain: finalDomain,
        url: `https://${finalDomain}.dot.li`,
    };
}
