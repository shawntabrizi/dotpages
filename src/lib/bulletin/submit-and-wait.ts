// Generic Observable→Promise bridge for signSubmitAndWatch. Reused by both
// the Bulletin store path and the pallet-revive contract calls.

import type { PolkadotSigner } from "polkadot-api";

export type DeployStatus = "signing" | "broadcasting" | "in-block" | "finalized";

interface SubmitResult {
    blockHash: string;
    blockNumber: number;
}

export async function submitAndWait(
    tx: {
        signSubmitAndWatch: (signer: PolkadotSigner) => {
            subscribe: (observer: {
                next: (ev: unknown) => void;
                error: (err: unknown) => void;
            }) => { unsubscribe: () => void };
        };
    },
    signer: PolkadotSigner,
    onStatus?: (status: DeployStatus) => void,
): Promise<SubmitResult> {
    return new Promise((resolve, reject) => {
        let sub: { unsubscribe: () => void } | undefined;
        let bestBlock: { hash: string; number: number } | undefined;

        onStatus?.("signing");

        sub = tx.signSubmitAndWatch(signer).subscribe({
            next: (raw: unknown) => {
                const ev = raw as {
                    type: string;
                    found?: boolean;
                    ok?: boolean;
                    dispatchError?: unknown;
                    block?: { hash: string; number: number; index: number };
                };

                if (ev.type === "broadcasted") onStatus?.("broadcasting");

                if (ev.type === "txBestBlocksState" && ev.found && ev.block) {
                    if (ev.ok === false || ev.dispatchError) {
                        sub?.unsubscribe();
                        const info = ev.dispatchError
                            ? JSON.stringify(ev.dispatchError, (_, v) =>
                                  typeof v === "bigint" ? String(v) : v,
                              )
                            : "Transaction included but dispatch failed";
                        reject(new Error(`Transaction failed: ${info}`));
                        return;
                    }
                    bestBlock = { hash: ev.block.hash, number: ev.block.number };
                    onStatus?.("in-block");
                }

                if (ev.type === "finalized") {
                    sub?.unsubscribe();
                    if (ev.dispatchError) {
                        const info = JSON.stringify(ev.dispatchError, (_, v) =>
                            typeof v === "bigint" ? String(v) : v,
                        );
                        reject(new Error(`Transaction failed: ${info}`));
                        return;
                    }
                    onStatus?.("finalized");
                    resolve({
                        blockHash: ev.block?.hash ?? bestBlock?.hash ?? "",
                        blockNumber: ev.block?.number ?? bestBlock?.number ?? 0,
                    });
                }

                if (ev.type === "invalid" || ev.type === "dropped") {
                    sub?.unsubscribe();
                    reject(new Error(`Transaction ${ev.type}`));
                }
            },
            error: (err: unknown) => {
                sub?.unsubscribe();
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        });
    });
}
