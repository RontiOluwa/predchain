import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

/**
 * Load environment variables manually.
 * We keep this simple — no dotenv dependency in the contracts package.
 * Set these in your shell before running deploy commands:
 *   export RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
 *   export DEPLOYER_PRIVATE_KEY=0x...
 */
const RPC_URL = process.env["RPC_URL"] ?? "";
const DEPLOYER_PRIVATE_KEY = process.env["DEPLOYER_PRIVATE_KEY"] ?? "";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                /**
                 * runs: 200 is the standard trade-off between deploy cost and
                 * call cost. Higher = cheaper repeated calls, more expensive deploy.
                 * For a prediction market with many user interactions, 200 is right.
                 */
                runs: 200,
            },
            evmVersion: "paris",
        },
    },
    networks: {
        /**
         * Local Hardhat node — runs in memory, instant blocks.
         * Use this for tests and rapid iteration.
         * Start with: pnpm node (from contracts package)
         */
        localhost: {
            url: "http://127.0.0.1:8545",
        },
        /**
         * Base Sepolia testnet.
         * Free ETH faucet: https://www.alchemy.com/faucets/base-sepolia
         * RPC from Alchemy: https://alchemy.com → create Base Sepolia app
         */
        baseSepolia: {
            url: RPC_URL,
            accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
            chainId: 84532,
        },
    },
    /**
     * TypeChain generates TypeScript types from our compiled ABIs.
     * After compilation, you get fully typed contract instances in tests
     * and the deploy script — no manual type casting needed.
     */
    typechain: {
        outDir: "typechain-types",
        target: "ethers-v6",
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",
    },
};

export default config;