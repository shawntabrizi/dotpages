// Bulletin storage flow via the host-routed CloudStorageClient: pre-flight
// authorization check → store().send() → receipt with CID + block. The
// authorization check is REQUIRED — unauthorized store transactions fail
// silently on Bulletin Chain (no on-chain error event).
//
// The client is a lazy singleton built once and reused. Its signer is resolved
// per-call from the currently-active account (host / extension / dev) so the
// same client signs with whichever source the user selected — deploy.ts still
// threads `account.signer` explicitly for the dev path, but the CloudStorage
// client must use the live active account.

import {
    CloudStorageClient,
    createLazySigner,
    calculateCid,
} from "@parity/product-sdk-cloud-storage";
import type { PolkadotSigner } from "polkadot-api";
import { getCurrentAccount } from "../../account.ts";
import { BULLETIN_FAUCET_URL, BULLETIN_GATEWAY } from "../polkadot/constants.ts";
import type { DeployStatus } from "./submit-and-wait.ts";

/** Per-transaction chain cap — applies regardless of account authorization. */
export const MAX_TX_BYTES = 2 * 1024 * 1024; // 2 MiB on Paseo Next (8 MiB on Polkadot Bulletin)
const MAX_SIZE = MAX_TX_BYTES;

// `environment: "paseo"` resolves to the paseo-bulletin-next chain
// (genesis 0x8cfe…0a22, wss://paseo-bulletin-next-rpc.polkadot.io) — the same
// chain BULLETIN_RPC points at. Verified against the chain-client preset.
const ENVIRONMENT = "paseo" as const;

export interface StoreHTMLResult {
    cid: string;
    blockNumber: number;
    blockHash: string;
    ipfsUrl: string;
    bytes: number;
}

interface AuthCheck {
    authorized: boolean;
    transactions: number;
    bytes: bigint;
}

// Promise-based singleton so concurrent first callers share one
// CloudStorageClient.create() instead of each spinning up their own. The lazy
// signer defers signer resolution to each store call, picking up account
// switches (host → extension → dev) automatically.
let clientPromise: Promise<CloudStorageClient> | null = null;

function getCloudStorageClient(): Promise<CloudStorageClient> {
    if (!clientPromise) {
        const signer: PolkadotSigner = createLazySigner(
            () => getCurrentAccount()?.signer ?? null,
        );
        clientPromise = CloudStorageClient.create({ environment: ENVIRONMENT, signer });
    }
    return clientPromise;
}

export async function checkBulletinAuthorization(address: string): Promise<AuthCheck> {
    const client = await getCloudStorageClient();
    const auth = await client.checkAuthorization(address);
    return {
        authorized: auth.authorized && auth.remainingTransactions > 0 && auth.remainingBytes > 0n,
        transactions: auth.remainingTransactions,
        bytes: auth.remainingBytes,
    };
}

export async function storeBytes(params: {
    bytes: Uint8Array;
    signer: PolkadotSigner;
    signerAddress: string;
    displayName: string;
    label?: string;
    onStatus?: (status: DeployStatus) => void;
}): Promise<StoreHTMLResult> {
    const { bytes, signerAddress, displayName, label = "Content", onStatus } = params;

    if (bytes.length === 0) throw new Error(`${label} is empty — nothing to store`);
    if (bytes.length > MAX_SIZE) {
        throw new Error(
            `${label} is ${bytes.length.toLocaleString()} bytes — Bulletin max is ${MAX_SIZE.toLocaleString()} (~2 MiB)`,
        );
    }

    const client = await getCloudStorageClient();

    const auth = await client.checkAuthorization(signerAddress);
    if (!auth.authorized || auth.remainingTransactions <= 0 || auth.remainingBytes <= 0n) {
        throw new Error(
            `No Bulletin authorization for ${displayName} (${signerAddress}).\n\n` +
                `Self-serve faucet:\n${BULLETIN_FAUCET_URL}`,
        );
    }
    if (auth.remainingBytes < BigInt(bytes.length)) {
        throw new Error(
            `${displayName} is authorized for ${auth.remainingBytes} bytes but ${label.toLowerCase()} is ${bytes.length} bytes`,
        );
    }

    onStatus?.("signing");
    const result = await client.store(bytes).send();
    onStatus?.("finalized");

    const cid = result.cid?.toString() ?? (await calculateCid(bytes)).toString();
    return {
        cid,
        blockNumber: result.blockNumber ?? 0,
        // StoreResult exposes block number + extrinsic index, not a block hash.
        // The hash isn't surfaced by the host-routed store path; downstream only
        // displays the number, so leave it empty.
        blockHash: "",
        ipfsUrl: `${BULLETIN_GATEWAY}${cid}`,
        bytes: bytes.length,
    };
}

export async function storeHTML(params: {
    html: string;
    signer: PolkadotSigner;
    signerAddress: string;
    displayName: string;
    onStatus?: (status: DeployStatus) => void;
}): Promise<StoreHTMLResult> {
    return storeBytes({
        bytes: new TextEncoder().encode(params.html),
        signer: params.signer,
        signerAddress: params.signerAddress,
        displayName: params.displayName,
        label: "HTML",
        onStatus: params.onStatus,
    });
}
