// Pallet-revive bridge: dry-run a contract call, submit a contract call,
// and (one-time per account) ensure the SS58 → H160 mapping exists.
//
// Patterns adapted from dotdot-deployer. The 4x gas multiplier + minimum
// 2 PAS storage deposit defaults are inherited from the DotNS SDK reference.

import { Binary, type PolkadotSigner } from "polkadot-api";
import { getAssetHubClient } from "../polkadot/clients.ts";
import { submitAndWait, type DeployStatus } from "../bulletin/submit-and-wait.ts";

const MAX_WEIGHT = 18446744073709551615n;
const MIN_STORAGE_DEPOSIT = 2_000_000_000_000n; // 2 PAS
const ZERO_H160 = "0x0000000000000000000000000000000000000000";

const GAS_MULTIPLIER = 4n;
const DEFAULT_REF_TIME = 5_000_000_000n;
const DEFAULT_PROOF_SIZE = 500_000n;

interface DryRunResult {
    success: boolean;
    gasConsumed: { refTime: bigint; proofSize: bigint };
    storageDeposit: bigint;
    returnData: `0x${string}`;
}

const mappedAccounts = new Set<string>();

function bytesToHex(data: unknown): `0x${string}` {
    if (data instanceof Uint8Array) {
        return `0x${Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    }

    const maybeBinary = data as
        | { asHex?: () => string; asBytes?: () => Uint8Array }
        | null
        | undefined;
    const asHex = maybeBinary?.asHex?.();
    if (asHex?.startsWith("0x")) return asHex as `0x${string}`;

    const asBytes = maybeBinary?.asBytes?.();
    if (asBytes) return bytesToHex(asBytes);

    return "0x";
}

function toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    return 0n;
}

function chargedStorageDeposit(value: unknown): bigint {
    const deposit = value as { type?: string; value?: unknown } | null | undefined;
    if (deposit?.type === "Charge") return toBigInt(deposit.value);
    if (deposit?.type === "Refund") return 0n;
    return toBigInt(value);
}

export async function ensureAccountMapped(
    signerAddress: string,
    signer: PolkadotSigner,
): Promise<void> {
    if (mappedAccounts.has(signerAddress)) return;

    const { unsafeApi, api } = getAssetHubClient();

    // Probe: a dry-run against the zero address. If the account is unmapped,
    // pallet-revive returns AccountUnmapped — much faster than checking storage.
    try {
        const test = await unsafeApi.apis.ReviveApi.call(
            signerAddress,
            ZERO_H160,
            0n,
            { ref_time: MAX_WEIGHT, proof_size: MAX_WEIGHT },
            MAX_WEIGHT,
            Binary.fromHex("0x"),
        );
        const r = test as {
            result?: {
                value?: {
                    type?: string;
                    value?: { type?: string; value?: { type?: string } };
                };
            };
        };
        const isUnmapped =
            r.result?.value?.type === "Module" &&
            r.result?.value?.value?.type === "Revive" &&
            r.result?.value?.value?.value?.type === "AccountUnmapped";
        if (!isUnmapped) {
            mappedAccounts.add(signerAddress);
            return;
        }
    } catch {
        // fall through to mapping
    }

    const tx = api.tx.Revive.map_account();
    await submitAndWait(tx, signer);

    // Poll until the mapping propagates (usually 1-2 blocks).
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
            const check = await unsafeApi.apis.ReviveApi.call(
                signerAddress,
                ZERO_H160,
                0n,
                undefined,
                undefined,
                Binary.fromHex("0x"),
            );
            const c = check as {
                result?: {
                    value?: {
                        type?: string;
                        value?: { type?: string; value?: { type?: string } };
                    };
                };
            };
            const stillUnmapped =
                c.result?.value?.type === "Module" &&
                c.result?.value?.value?.type === "Revive" &&
                c.result?.value?.value?.value?.type === "AccountUnmapped";
            if (!stillUnmapped) {
                mappedAccounts.add(signerAddress);
                return;
            }
        } catch {
            // keep retrying
        }
    }

    throw new Error("Account mapping did not propagate after multiple attempts");
}

export async function dryRunContractCall(
    contractAddress: string,
    callerAddress: string,
    encodedData: `0x${string}`,
    value: bigint = 0n,
): Promise<DryRunResult> {
    const { unsafeApi } = getAssetHubClient();

    const dryRun = await unsafeApi.apis.ReviveApi.call(
        callerAddress,
        contractAddress.toLowerCase() as `0x${string}`,
        value,
        { ref_time: MAX_WEIGHT, proof_size: MAX_WEIGHT },
        MAX_WEIGHT,
        Binary.fromHex(encodedData),
    );

    const r = dryRun as {
        result?: {
            success?: boolean;
            value?: { flags?: number; data?: unknown };
        };
        weight_required?: {
            ref_time?: bigint | number;
            proof_size?: bigint | number;
        };
        storage_deposit?: unknown;
    };

    const flags = r.result?.value?.flags ?? 0;
    const success = r.result?.success === true && !(flags & 1);

    return {
        success,
        gasConsumed: {
            refTime: BigInt(r.weight_required?.ref_time ?? 0),
            proofSize: BigInt(r.weight_required?.proof_size ?? 0),
        },
        storageDeposit: chargedStorageDeposit(r.storage_deposit),
        returnData: bytesToHex(r.result?.value?.data),
    };
}

export async function submitContractCall(
    contractAddress: string,
    signer: PolkadotSigner,
    encodedData: `0x${string}`,
    value: bigint = 0n,
    gasEstimate?: { refTime: bigint; proofSize: bigint },
    storageDepositEstimate?: bigint,
    onStatus?: (status: DeployStatus) => void,
): Promise<{ blockHash: string; blockNumber: number }> {
    const { api } = getAssetHubClient();

    const refTime = gasEstimate ? gasEstimate.refTime * GAS_MULTIPLIER : DEFAULT_REF_TIME;
    const proofSize = gasEstimate
        ? gasEstimate.proofSize * GAS_MULTIPLIER
        : DEFAULT_PROOF_SIZE;

    let storageDeposit = storageDepositEstimate
        ? storageDepositEstimate + storageDepositEstimate / 5n
        : MIN_STORAGE_DEPOSIT;
    if (storageDeposit < MIN_STORAGE_DEPOSIT) storageDeposit = MIN_STORAGE_DEPOSIT;

    const tx = api.tx.Revive.call({
        // Descriptor types `dest` as SizedHex<20> (branded plain string), not
        // a Binary class instance. Pallet-revive accepts the lowercase hex.
        dest: contractAddress.toLowerCase() as `0x${string}`,
        value,
        weight_limit: { ref_time: refTime, proof_size: proofSize },
        storage_deposit_limit: storageDeposit,
        data: Binary.fromHex(encodedData),
    });

    return submitAndWait(tx, signer, onStatus);
}
