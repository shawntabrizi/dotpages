// Cached PAPI clients for Bulletin Chain and Asset Hub Next.
//
// Both use direct WebSocket today (standalone mode). Host-routed providers
// via `createPapiProvider(genesisHash)` are a follow-up — that path needs the
// AH-Next genesis hash and `isInHost()` guards from the polkadot-triangle
// skill. For the //Bob deploy path (which is always standalone) this is fine.

import { createClient, type TypedApi } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { paseo_bulletin } from "@parity/product-sdk-descriptors/paseo-bulletin";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { ASSET_HUB_RPC, BULLETIN_RPC } from "./constants.ts";

type BulletinApi = TypedApi<typeof paseo_bulletin>;
type AssetHubApi = TypedApi<typeof paseo_asset_hub>;
type Client = ReturnType<typeof createClient>;

let bulletinClient: Client | null = null;
let bulletinApi: BulletinApi | null = null;

let assetHubClient: Client | null = null;
let assetHubApi: AssetHubApi | null = null;
let assetHubUnsafeApi: ReturnType<Client["getUnsafeApi"]> | null = null;

export function getBulletinClient(): { client: Client; api: BulletinApi } {
    if (!bulletinClient) {
        bulletinClient = createClient(getWsProvider(BULLETIN_RPC));
        bulletinApi = bulletinClient.getTypedApi(paseo_bulletin);
    }
    return { client: bulletinClient, api: bulletinApi! };
}

export function getAssetHubClient(): {
    client: Client;
    api: AssetHubApi;
    unsafeApi: ReturnType<Client["getUnsafeApi"]>;
} {
    if (!assetHubClient) {
        assetHubClient = createClient(getWsProvider(ASSET_HUB_RPC));
        assetHubApi = assetHubClient.getTypedApi(paseo_asset_hub);
        assetHubUnsafeApi = assetHubClient.getUnsafeApi();
    }
    return { client: assetHubClient, api: assetHubApi!, unsafeApi: assetHubUnsafeApi! };
}
