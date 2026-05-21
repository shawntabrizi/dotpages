// ENS-style namehash. DotNS reuses the same algorithm, so viem's
// implementation works as-is.

import { namehash as viemNamehash } from "viem";

export function namehash(name: string): `0x${string}` {
    return viemNamehash(name);
}

export function labelToFullName(label: string): string {
    return `${label}.dot`;
}
