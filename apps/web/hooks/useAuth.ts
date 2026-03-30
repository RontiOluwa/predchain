"use client";

import { useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { authApi } from "@/lib/api";

/**
 * useAuth handles the full wallet authentication flow:
 * 1. Get a nonce from the backend
 * 2. Sign it with MetaMask via wagmi
 * 3. Verify the signature, receive a JWT
 * 4. Store the JWT in localStorage
 *
 * The JWT is then automatically included in all API requests
 * via the getAuthHeader() function in api.ts.
 */
export function useAuth() {
    const { address } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isAuthenticated = (): boolean => {
        if (!address) return false;
        const token = localStorage.getItem("predchain_jwt");
        if (!token) return false;

        // Decode JWT payload (no verification — server verifies)
        try {
            const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
            // Check token not expired and belongs to current address
            return (
                payload.exp * 1000 > Date.now() &&
                payload.address?.toLowerCase() === address.toLowerCase()
            );
        } catch {
            return false;
        }
    };

    const authenticate = useCallback(async (): Promise<boolean> => {
        if (!address) {
            setError("Connect your wallet first");
            return false;
        }

        if (isAuthenticated()) return true;

        setIsAuthenticating(true);
        setError(null);

        try {
            // Step 1: Get nonce from backend
            const { nonce } = await authApi.getNonce(address);

            // Step 2: Sign with MetaMask — triggers wallet popup
            const signature = await signMessageAsync({ message: nonce });

            // Step 3: Verify signature, receive JWT
            const { token } = await authApi.verify(address, signature);

            // Step 4: Store JWT
            localStorage.setItem("predchain_jwt", token);

            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Authentication failed");
            return false;
        } finally {
            setIsAuthenticating(false);
        }
    }, [address, signMessageAsync]);

    const logout = useCallback(() => {
        localStorage.removeItem("predchain_jwt");
    }, []);

    return {
        isAuthenticated: isAuthenticated(),
        isAuthenticating,
        error,
        authenticate,
        logout,
        address,
    };
}