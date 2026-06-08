// Dynamic resolution of the playground-registry contract.
//
// hello-playground deploys profile sites; we also want each deployed site
// listed in the playground registry so it appears in playground.dot's grid.
// This module exposes a single `getRegistryContract()` that returns a typed
// handle to the `@w3s/playground-registry` contract. The actual publish call
// lives in a later task — here we only build the resolution infrastructure.
//
// Reset survival: the Paseo Asset Hub Next testnet resets periodically and
// rotates contract addresses. Rather than hardcode the registry address, we
// use `ContractManager.fromLiveClient`, which queries the on-chain CDM
// meta-registry at call time for the CURRENT address of each requested
// library, falling back to the cdm.json snapshot's address only as a last
// resort. The ABI always comes from the installed cdm.json snapshot (used for
// typing + decoding). This mirrors playground-app/src/utils/contracts.ts.

import { getChainAPI } from "@parity/product-sdk-chain-client";
import {
  ContractManager,
  type CdmJson,
  type Contract,
  type ContractDef,
  type Contracts,
} from "@parity/product-sdk-contracts";
import { seedToAccount } from "@parity/product-sdk-keys";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
// The chain-client preset for "paseo" resolves AssetHub to this exact
// descriptor, so the live client and the descriptor we hand to fromLiveClient
// stay in lockstep. Imported directly because ContractManager needs the
// asset-hub chain descriptor to derive its typed Revive API.
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import cdmJson from "../../../cdm.json" with { type: "json" };

// Same environment as the rest of the app (Paseo Asset Hub Next). Kept local
// so this module has no dependency on a future src/config.ts.
const CHAIN = "paseo" as const;

// Production = @w3s. Local dev / staging-test = @staging. The pvm
// `cdm = "@w3s/playground-registry"` annotation decides where new builds
// publish; for UI testing against a fresh staging deploy whose ABI hasn't
// shipped to @w3s yet, set VITE_PLAYGROUND_REGISTRY_PACKAGE=@staging/playground-registry
// in .env.local. Mirrors playground-app's contractManifest.ts override.
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const REGISTRY_PACKAGE_OVERRIDE = env.VITE_PLAYGROUND_REGISTRY_PACKAGE;
export const PLAYGROUND_REGISTRY: "@w3s/playground-registry" | "@staging/playground-registry" =
  REGISTRY_PACKAGE_OVERRIDE === "@staging/playground-registry"
    ? "@staging/playground-registry"
    : "@w3s/playground-registry";

// Resolve only the registry — no need to pay for resolving contracts this app
// never calls.
const LIBRARIES = [PLAYGROUND_REGISTRY] as const;

// Typed contract handle for the resolved package id. Falls back to the generic
// ContractDef handle when codegen hasn't augmented `Contracts` for this build.
type ContractFor<K extends string> = K extends keyof Contracts
  ? Contracts[K] extends ContractDef
    ? Contract<Contracts[K]>
    : Contract<ContractDef>
  : Contract<ContractDef>;

export type PlaygroundRegistryContract = ContractFor<typeof PLAYGROUND_REGISTRY>;

// Read origin for the CDM meta-registry dry-run queries. Deliberately separate
// from user transaction signing so address resolution does not depend on a
// connected product account. Lazy so the sr25519 derivation stays off the
// synchronous module-load path. Same derivation playground-app uses.
let _readOrigin: string | undefined;
const READ_ORIGIN_DERIVATION = "//playground-querier";
export const getReadOrigin = (): string =>
  (_readOrigin ??= seedToAccount(DEV_PHRASE, READ_ORIGIN_DERIVATION).ss58Address);

// Singleton, cached on first use. This is host-routed (getChainAPI needs the
// host container), so it is only callable at deploy time in-host — no
// standalone fallback. The rejected-promise-reset pattern means a failed first
// call (e.g. host not ready) clears the cache so a later call can retry,
// instead of permanently caching the rejection.
let cached: Promise<PlaygroundRegistryContract> | null = null;

export function getRegistryContract(): Promise<PlaygroundRegistryContract> {
  if (cached) return cached;
  cached = (async () => {
    const client = await getChainAPI(CHAIN);
    // Live address resolution: fromLiveClient queries the on-chain CDM
    // meta-registry for the current address of each library in `libraries`,
    // so a post-reset redeploy is picked up without rebuilding the frontend.
    // ABIs still come from the cdm.json snapshot. No signerManager — the
    // resolution reads use the dedicated dry-run origin; the publish task
    // passes an explicit signer at tx time. Setting defaultOrigin also
    // suppresses the SDK's per-query "No origin configured" warning.
    const manager = await ContractManager.fromLiveClient(
      cdmJson as unknown as CdmJson,
      client.raw.assetHub,
      paseo_asset_hub,
      {
        defaultOrigin: getReadOrigin(),
        registryOrigin: getReadOrigin(),
        libraries: LIBRARIES,
      },
    );
    return manager.getContract(PLAYGROUND_REGISTRY) as PlaygroundRegistryContract;
  })().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}
