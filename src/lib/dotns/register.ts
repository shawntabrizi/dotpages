// Commit-reveal DotNS registration flow. ENS-style — front-running protection
// via a 60s commitment age.

import { encodeFunctionData, decodeFunctionResult } from "viem";
import type { PolkadotSigner } from "polkadot-api";
import { DOTNS_CONTRACTS, NATIVE_TO_ETH_RATIO } from "../polkadot/constants.ts";
import { POP_RULES_ABI, REGISTRAR_CONTROLLER_ABI, REGISTRY_ABI } from "./abis.ts";
import { labelToFullName, namehash } from "./namehash.ts";
import { dryRunContractCall, ensureAccountMapped, submitContractCall } from "./contracts.ts";

function generateSecret(): `0x${string}` {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return ("0x" +
        Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")) as `0x${string}`;
}

export async function checkDomainAvailability(
    label: string,
    callerAddress: string,
): Promise<boolean> {
    const node = namehash(labelToFullName(label));
    const encoded = encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: "recordExists",
        args: [node],
    });

    const result = await dryRunContractCall(DOTNS_CONTRACTS.registry, callerAddress, encoded);
    if (!result.success) return true; // assume available when probe fails

    const exists = decodeFunctionResult({
        abi: REGISTRY_ABI,
        functionName: "recordExists",
        data: result.returnData,
    });
    return !exists;
}

export interface DomainQuote {
    /** Price in Wei (18 decimals). Null when neither price probe succeeded. */
    price: bigint | null;
    /** The name's requirement tier (0 = available to all; probed empirically:
     *  1 = Lite personhood, 3 = governance-reserved). Null on fallback path. */
    status: number | null;
    /** The caller's verification tier — registrable when userStatus >= status. */
    userStatus: number | null;
    /** PoP-rules classification message (present even on success,
     *  e.g. "Available to all"). */
    message: string | null;
}

/** Read-only price + PoP-rules verdict — used by pre-flight and register. */
export async function quoteDomain(
    label: string,
    ownerEvmAddress: `0x${string}`,
    callerAddress: string,
): Promise<DomainQuote> {
    const encoded = encodeFunctionData({
        abi: POP_RULES_ABI,
        functionName: "priceWithoutCheck",
        args: [label, ownerEvmAddress],
    });
    const result = await dryRunContractCall(DOTNS_CONTRACTS.popRules, callerAddress, encoded);

    if (!result.success) {
        // Fallback: simpler price() lookup.
        const fallback = encodeFunctionData({
            abi: POP_RULES_ABI,
            functionName: "price",
            args: [label],
        });
        const fbResult = await dryRunContractCall(
            DOTNS_CONTRACTS.popRules,
            callerAddress,
            fallback,
        );
        if (!fbResult.success) return { price: null, status: null, userStatus: null, message: null };
        const price = decodeFunctionResult({
            abi: POP_RULES_ABI,
            functionName: "price",
            data: fbResult.returnData,
        });
        return { price, status: null, userStatus: null, message: null };
    }

    const metadata = decodeFunctionResult({
        abi: POP_RULES_ABI,
        functionName: "priceWithoutCheck",
        data: result.returnData,
    }) as { price: bigint; status: number; userStatus: number; message: string };
    return {
        price: metadata.price,
        status: metadata.status,
        userStatus: metadata.userStatus,
        message: metadata.message || null,
    };
}

async function getDomainPrice(
    label: string,
    ownerEvmAddress: `0x${string}`,
    callerAddress: string,
): Promise<bigint> {
    return (await quoteDomain(label, ownerEvmAddress, callerAddress)).price ?? 0n;
}

async function getMinCommitmentAge(callerAddress: string): Promise<number> {
    const encoded = encodeFunctionData({
        abi: REGISTRAR_CONTROLLER_ABI,
        functionName: "minCommitmentAge",
    });
    const result = await dryRunContractCall(
        DOTNS_CONTRACTS.registrarController,
        callerAddress,
        encoded,
    );
    if (!result.success) return 60;
    const age = decodeFunctionResult({
        abi: REGISTRAR_CONTROLLER_ABI,
        functionName: "minCommitmentAge",
        data: result.returnData,
    });
    return Number(age);
}

export async function registerDomain(params: {
    label: string;
    ownerEvmAddress: `0x${string}`;
    signerAddress: string;
    signer: PolkadotSigner;
    onStatus?: (status: string) => void;
}): Promise<void> {
    const { label, ownerEvmAddress, signerAddress, signer, onStatus } = params;

    onStatus?.("Mapping account on Asset Hub…");
    await ensureAccountMapped(signerAddress, signer);

    const secret = generateSecret();
    const registration = { label, owner: ownerEvmAddress, secret, reserved: false } as const;

    // 1. Compute commitment (read-only)
    onStatus?.("Computing commitment…");
    const makeCommitmentData = encodeFunctionData({
        abi: REGISTRAR_CONTROLLER_ABI,
        functionName: "makeCommitment",
        args: [registration],
    });
    const commitmentResult = await dryRunContractCall(
        DOTNS_CONTRACTS.registrarController,
        signerAddress,
        makeCommitmentData,
    );
    if (!commitmentResult.success) {
        throw new Error("Failed to compute commitment");
    }
    const commitment = decodeFunctionResult({
        abi: REGISTRAR_CONTROLLER_ABI,
        functionName: "makeCommitment",
        data: commitmentResult.returnData,
    });

    // 2. Submit commitment (extrinsic)
    onStatus?.("Submitting commitment…");
    const commitData = encodeFunctionData({
        abi: REGISTRAR_CONTROLLER_ABI,
        functionName: "commit",
        args: [commitment],
    });
    const commitGas = await dryRunContractCall(
        DOTNS_CONTRACTS.registrarController,
        signerAddress,
        commitData,
    );
    await submitContractCall(
        DOTNS_CONTRACTS.registrarController,
        signer,
        commitData,
        0n,
        commitGas.gasConsumed,
        commitGas.storageDeposit,
        (status) => {
            if (status === "signing") onStatus?.("Signing commitment…");
            if (status === "in-block") onStatus?.("Commitment confirmed");
        },
    );

    // 3. Wait through the commitment age. Front-running protection — the
    // protocol REQUIRES this delay.
    const minAge = await getMinCommitmentAge(signerAddress);
    const totalWait = minAge + 6; // safety buffer per DotNS SDK
    for (let remaining = totalWait; remaining > 0; remaining--) {
        onStatus?.(`Waiting ${remaining}s for commitment age…`);
        await new Promise((r) => setTimeout(r, 1000));
    }

    // 4. Register with the priced payment value.
    onStatus?.("Pricing domain…");
    const priceWei = await getDomainPrice(label, ownerEvmAddress, signerAddress);
    const bufferedWei = (priceWei * 110n) / 100n; // 10% buffer per DotNS SDK
    const bufferedNative = bufferedWei / NATIVE_TO_ETH_RATIO;

    const registerData = encodeFunctionData({
        abi: REGISTRAR_CONTROLLER_ABI,
        functionName: "register",
        args: [registration],
    });
    const registerGas = await dryRunContractCall(
        DOTNS_CONTRACTS.registrarController,
        signerAddress,
        registerData,
        bufferedNative,
    );
    await submitContractCall(
        DOTNS_CONTRACTS.registrarController,
        signer,
        registerData,
        bufferedNative,
        registerGas.gasConsumed,
        registerGas.storageDeposit,
        (status) => {
            if (status === "signing") onStatus?.("Signing registration…");
            if (status === "in-block") onStatus?.("Domain registered");
        },
    );
}
