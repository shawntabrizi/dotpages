// paseo-next-v2 endpoints + DotNS contract addresses.
// Sources:
//   - playground-cli/src/config.ts (RPCs + gateway)
//   - bulletin-deploy/assets/environments.json (DotNS contract addresses)

export const BULLETIN_RPC = "wss://paseo-bulletin-next-rpc.polkadot.io";
export const BULLETIN_GATEWAY = "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/";

export const ASSET_HUB_RPC = "wss://paseo-asset-hub-next-rpc.polkadot.io";

// Asset Hub Next genesis hash (`.papi/polkadot-api.json` "pah".genesis).
// Used to host-route the chain provider via `createPapiProvider`.
export const ASSET_HUB_GENESIS =
    "0x173cea9df45656cf612c8b8ece56e04e9a693c69cfaac47d3628dae735067af8";

// DotNS deployed contract addresses on paseo-next-v2's Asset Hub.
export const DOTNS_CONTRACTS = {
    registry: "0x8877344A885682523B4613779C95688ed7037BfD",
    registrar: "0x885b8085bA92A31c4ef52076f77379E647ECC399",
    registrarController: "0x320b72c6e70D5a631d835FfD95915B288b26E6Be",
    contentResolver: "0x2c9FF5D9136DBE5814C7B4FDbeDC15273a776663",
    popRules: "0x2002C1c15b88632Ad01c7770f6EbE1Ca05c8472E",
} as const;

/** 1 PAS (native, 12 decimals) = 1_000_000 Wei (EVM, 18 decimals). */
export const NATIVE_TO_ETH_RATIO = 1_000_000n;

/** Self-serve faucet for Bulletin storage authorization on Paseo. */
export const BULLETIN_FAUCET_URL =
    "https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet";

/** PAS faucet for paying contract fees on Asset Hub Next. */
export const PAS_FAUCET_URL = "https://faucet.polkadot.io/";
