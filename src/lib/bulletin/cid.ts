// Bulletin Chain's default CID: Blake2b-256 (multihash 0xb220) + raw codec (0x55).
// MUST match the chain's expected hash so stored data is retrievable by gateway.

import { blake2b } from "@noble/hashes/blake2b";
import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";

const RAW_CODEC = 0x55;
const BLAKE2B_256_MULTIHASH_CODE = 0xb220;

export function computeCID(bytes: Uint8Array): CID {
    const hash = blake2b(bytes, { dkLen: 32 });
    const digest = Digest.create(BLAKE2B_256_MULTIHASH_CODE, hash);
    return CID.createV1(RAW_CODEC, digest);
}
