// IPFS content-hash encoding + setContenthash submission. Binds the
// registered `<label>.dot` node to the CID stored on Bulletin.

import { encodeFunctionData } from "viem";
import type { PolkadotSigner } from "polkadot-api";
import { encode as encodeContentHash } from "@ensdomains/content-hash";
import { DOTNS_CONTRACTS } from "../polkadot/constants.ts";
import { CONTENT_RESOLVER_ABI } from "./abis.ts";
import { labelToFullName, namehash } from "./namehash.ts";
import {
    assertDryRunOk,
    dryRunContractCall,
    ensureAccountMapped,
    submitContractCall,
} from "./contracts.ts";

export function encodeIpfsContenthash(cidString: string): `0x${string}` {
    const encoded = encodeContentHash("ipfs", cidString);
    return `0x${encoded}` as `0x${string}`;
}

export async function setContentHash(params: {
    label: string;
    cidString: string;
    signerAddress: string;
    signer: PolkadotSigner;
    onStatus?: (status: string) => void;
}): Promise<void> {
    const { label, cidString, signerAddress, signer, onStatus } = params;

    const node = namehash(labelToFullName(label));
    const contentBytes = encodeIpfsContenthash(cidString);

    await ensureAccountMapped(signerAddress, signer);

    const encoded = encodeFunctionData({
        abi: CONTENT_RESOLVER_ABI,
        functionName: "setContenthash",
        args: [node, contentBytes],
    });

    onStatus?.("Estimating gas for setContenthash…");
    const gasEstimate = await dryRunContractCall(
        DOTNS_CONTRACTS.contentResolver,
        signerAddress,
        encoded,
    );

    // A failed estimate previously fell back to default gas and submitted
    // anyway — paying fees for a guaranteed revert. Stop instead.
    assertDryRunOk(gasEstimate, "setContenthash");

    onStatus?.("Setting content hash…");
    await submitContractCall(
        DOTNS_CONTRACTS.contentResolver,
        signer,
        encoded,
        0n,
        gasEstimate.gasConsumed,
        gasEstimate.storageDeposit,
        (status) => {
            if (status === "signing") onStatus?.("Signing content hash update…");
            if (status === "in-block") onStatus?.("Content hash set");
        },
    );
}
