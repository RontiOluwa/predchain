import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyMessage } from "viem";
import { loggers } from "@predchain/shared";

const log = loggers.apiGateway;

/**
 * Auth strategy: Ethereum wallet signature verification.
 *
 * Instead of username/password, users sign a message with their
 * wallet private key. We verify the signature on the server to
 * confirm they own the address they claim to be.
 *
 * Flow:
 * 1. Frontend calls POST /auth/nonce to get a one-time message
 * 2. User signs the message with MetaMask
 * 3. Frontend calls POST /auth/verify with signature + address
 * 4. Server verifies signature, returns JWT
 * 5. All subsequent requests include JWT in Authorization header
 *
 * Why not just trust the address from the request body?
 * Without signature verification, anyone could claim to be any address.
 */

export interface AuthPayload {
    address: string; // Ethereum wallet address
    iat: number;     // Issued at
    exp: number;     // Expires at
}

/**
 * In-memory nonce store.
 * In production, move this to Redis with a 5-minute TTL
 * to support multiple server instances.
 */
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

/**
 * Generates a one-time sign message for a wallet address.
 * The message includes a timestamp to prevent replay attacks.
 */
export function generateNonce(address: string): string {
    const nonce = `Sign this message to authenticate with Predchain.\n\nAddress: ${address}\nNonce: ${Math.random().toString(36).slice(2)}\nTimestamp: ${Date.now()}`;

    nonceStore.set(address.toLowerCase(), {
        nonce,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    return nonce;
}

/**
 * Verifies a wallet signature against the stored nonce.
 * Returns the verified address or throws.
 */
export async function verifyWalletSignature(
    address: string,
    signature: string
): Promise<string> {
    const normalizedAddress = address.toLowerCase();
    const stored = nonceStore.get(normalizedAddress);

    if (!stored) {
        throw new Error("No nonce found for this address. Call /auth/nonce first.");
    }

    if (Date.now() > stored.expiresAt) {
        nonceStore.delete(normalizedAddress);
        throw new Error("Nonce expired. Please request a new one.");
    }

    // Verify the signature using viem
    const isValid = await verifyMessage({
        address: address as `0x${string}`,
        message: stored.nonce,
        signature: signature as `0x${string}`,
    });

    if (!isValid) {
        throw new Error("Invalid signature.");
    }

    // Delete nonce after use — one-time only
    nonceStore.delete(normalizedAddress);

    log.info("Wallet signature verified", { address });
    return address.toLowerCase();
}

/**
 * Fastify preHandler hook that protects routes requiring authentication.
 *
 * Usage on a route:
 *   { preHandler: [requireAuth] }
 *
 * Reads the JWT from the Authorization header and attaches
 * the decoded payload to request.user.
 */
export async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    try {
        await request.jwtVerify();
    } catch {
        log.warn("Unauthorized request", {
            url: request.url,
            ip: request.ip,
        });
        reply.status(401).send({ error: "Unauthorized" });
    }
}