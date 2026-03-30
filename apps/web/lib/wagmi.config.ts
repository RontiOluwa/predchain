import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia } from "wagmi/chains";

/**
 * Wagmi config — wallet connections and chain setup.
 *
 * We only support Base Sepolia for now (testnet).
 * Adding mainnet later is a one-line change: add `base` to chains.
 *
 * Get a WalletConnect project ID at: https://cloud.walletconnect.com
 */
export const wagmiConfig = getDefaultConfig({
    appName: "Predchain",
    projectId: process.env["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"] ?? "predchain-dev",
    chains: [baseSepolia],
    ssr: true, // Required for Next.js App Router
});

/**
 * PredToken contract ABI — only functions the frontend calls.
 * approve() is called before stakeYes/stakeNo so the market
 * contract can spend the user's tokens.
 */
export const PRED_TOKEN_ABI = [
    {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
    },
    {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ type: "uint256" }],
    },
    {
        name: "faucet",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
    },
] as const;

/**
 * PredictionMarket contract ABI — staking functions only.
 */
export const PREDICTION_MARKET_ABI = [
    {
        name: "stakeYes",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "amount", type: "uint256" }],
        outputs: [],
    },
    {
        name: "stakeNo",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "amount", type: "uint256" }],
        outputs: [],
    },
    {
        name: "claimPayout",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
    },
    {
        name: "claimRefund",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
    },
    {
        name: "impliedProbabilityYes",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
    },
    {
        name: "getMarketInfo",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [
            { name: "_status", type: "uint8" },
            { name: "_outcome", type: "uint8" },
            { name: "_yesPool", type: "uint256" },
            { name: "_noPool", type: "uint256" },
            { name: "_deadline", type: "uint256" },
            { name: "_probabilityYes", type: "uint256" },
        ],
    },
] as const;