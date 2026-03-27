import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbiItem,
    type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { loggers } from "@predchain/shared";

const log = loggers.marketService;

/**
 * MarketFactory ABI — only the functions we actually call.
 * We don't need the full ABI here, just what the market service uses.
 * This keeps the dependency lean — no need to import Hardhat artifacts.
 */
const FACTORY_ABI = [
    parseAbiItem(
        "function createMarket(bytes32 marketId, uint256 deadline) returns (address)"
    ),
    parseAbiItem(
        "function getMarket(bytes32 marketId) view returns (address)"
    ),
    parseAbiItem(
        "function marketCount() view returns (uint256)"
    ),
    parseAbiItem(
        "event MarketCreated(bytes32 indexed marketId, address indexed marketContract, uint256 deadline, uint256 timestamp)"
    ),
] as const;

/**
 * FactoryClient wraps viem interactions with the deployed MarketFactory.
 *
 * Two clients:
 * - publicClient  → read-only calls (view functions, event logs)
 * - walletClient  → write calls (createMarket) — requires private key
 */
export class FactoryClient {
    private publicClient;
    private walletClient;
    private factoryAddress: `0x${string}`;

    constructor() {
        const rpcUrl = process.env["RPC_URL"];
        const privateKey = process.env["DEPLOYER_PRIVATE_KEY"];
        const factoryAddress = process.env["FACTORY_CONTRACT_ADDRESS"];

        if (!rpcUrl) throw new Error("RPC_URL is not set");
        if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
        if (!factoryAddress) throw new Error("FACTORY_CONTRACT_ADDRESS is not set");

        this.factoryAddress = factoryAddress as `0x${string}`;

        const account = privateKeyToAccount(privateKey as `0x${string}`);

        this.publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(rpcUrl),
        });

        this.walletClient = createWalletClient({
            chain: baseSepolia,
            transport: http(rpcUrl),
            account,
        });
    }

    /**
     * Deploys a new PredictionMarket contract via the factory.
     *
     * @param marketId  UUID from PostgreSQL (converted to bytes32)
     * @param deadline  Unix timestamp (seconds) when staking closes
     * @returns         Transaction hash of the createMarket() call
     *
     * The actual contract address is emitted in the MarketCreated event.
     * We read it back using getDeployedMarketAddress() after confirmation.
     */
    async deployMarket(marketId: string, deadline: Date): Promise<Hash> {
        log.info("Deploying market contract", { marketId });

        // Convert UUID string to bytes32
        // Pad the UUID string to 32 bytes using hex encoding
        const marketIdBytes32 = this.uuidToBytes32(marketId);
        const deadlineUnix = BigInt(Math.floor(deadline.getTime() / 1000));

        const txHash = await this.walletClient.writeContract({
            address: this.factoryAddress,
            abi: FACTORY_ABI,
            functionName: "createMarket",
            args: [marketIdBytes32, deadlineUnix],
        });

        log.info("Market deployment transaction submitted", { marketId, txHash });
        return txHash;
    }

    /**
     * Waits for a transaction to be confirmed and returns the receipt.
     * Throws if the transaction reverts.
     */
    async waitForTransaction(txHash: Hash) {
        log.info("Waiting for transaction confirmation", { txHash });

        const receipt = await this.publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
        });

        if (receipt.status === "reverted") {
            throw new Error(`Transaction reverted: ${txHash}`);
        }

        log.info("Transaction confirmed", {
            txHash,
            blockNumber: receipt.blockNumber.toString(),
        });

        return receipt;
    }

    /**
     * Fetches the deployed market contract address for a given marketId.
     * Called after deployMarket() is confirmed on-chain.
     */
    async getDeployedMarketAddress(marketId: string): Promise<string | null> {
        const marketIdBytes32 = this.uuidToBytes32(marketId);

        const address = await this.publicClient.readContract({
            address: this.factoryAddress,
            abi: FACTORY_ABI,
            functionName: "getMarket",
            args: [marketIdBytes32],
        });

        // Factory returns address(0) if market doesn't exist
        if (address === "0x0000000000000000000000000000000000000000") {
            return null;
        }

        return address;
    }

    /**
     * Converts a UUID string to a bytes32 hex string.
     *
     * Example:
     *   "550e8400-e29b-41d4-a716-446655440000"
     *   → "0x3535306538343030652932623431643461373136343436363535343430303030"
     *
     * We strip the hyphens, encode as UTF-8 bytes, then left-pad to 32 bytes.
     */
    private uuidToBytes32(uuid: string): `0x${string}` {
        const stripped = uuid.replace(/-/g, "");
        // Encode to UTF-8, take at most 32 bytes, left-align in a 32-byte buffer
        const bytes = Buffer.from(stripped, "utf8").subarray(0, 32);
        const padded = Buffer.alloc(32); // zero-filled
        bytes.copy(padded, 0);           // copy from start, right-pad with zeros
        return `0x${padded.toString("hex")}`;
    }
}