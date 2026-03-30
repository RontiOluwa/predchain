"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useCreateMarket } from "@/hooks/useMarkets";
// import { useIsMounted } from "@/hooks/useIsMounted";
import { useAuth } from "@/hooks/useAuth";

export const dynamic = "force-dynamic";

const EXAMPLES = [
    "Will ETH exceed $5,000 by December 31st, 2026?",
    "Will Arsenal win the Premier League in the 2025-26 season?",
    "Will BTC exceed $150,000 by end of 2026?",
];

export default function CreatePage() {

    // const mounted = useIsMounted();
    const router = useRouter();
    const { mutateAsync, isPending, error } = useCreateMarket();
    const { authenticate, isAuthenticated, isAuthenticating } = useAuth();
    const [input, setInput] = useState("");
    const [authError, setAuthError] = useState<string | null>(null);
    const { address, isConnected } = useAccount();

    // if (!mounted) return null;

    const handleSubmit = async () => {
        if (!address || !input.trim()) return;

        setAuthError(null);

        // Step 1: Authenticate if not already authed
        if (!isAuthenticated) {
            const authed = await authenticate();
            if (!authed) {
                setAuthError("Wallet authentication failed. Please try again.");
                return;
            }
        }

        // Step 2: Create the market
        try {
            const result = await mutateAsync({
                rawInput: input,
                creatorAddress: address,
            });
            router.push(`/markets/${result.market.id}`);
        } catch {
            // error shown via mutation error state
        }
    };

    const isLoading = isPending || isAuthenticating;

    return (
        <div className="max-w-xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Create a Market</h1>
                <p className="text-gray-500 text-sm mt-1">
                    Describe your prediction in plain English. AI handles the rest.
                </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
                <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                        Your prediction
                    </label>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Will ETH exceed $5,000 by December 31st, 2026?"
                        rows={3}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">{input.length}/500</p>
                </div>

                <div>
                    <p className="text-xs text-gray-500 mb-2">Try an example:</p>
                    <div className="space-y-1">
                        {EXAMPLES.map((ex) => (
                            <button
                                key={ex}
                                onClick={() => setInput(ex)}
                                className="w-full text-left text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 px-2 py-1.5 rounded transition-colors"
                            >
                                {ex}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                    <p className="font-medium">What happens next:</p>
                    <p>1. Sign a message with MetaMask to authenticate</p>
                    <p>2. Claude parses your prediction into a structured market</p>
                    <p>3. A smart contract deploys on Base Sepolia (~15 seconds)</p>
                    <p>4. Users can stake PRED tokens on YES or NO</p>
                </div>

                {/* Auth status */}
                {isAuthenticated && (
                    <div className="text-xs text-green-600 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        Wallet authenticated
                    </div>
                )}

                {/* Errors */}
                {(authError || error) && (
                    <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                        {authError ?? (error instanceof Error ? error.message : "Failed")}
                    </div>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={!isConnected || !input.trim() || isLoading}
                    className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium text-sm disabled:opacity-40 hover:bg-gray-800 transition-colors"
                >
                    {!isConnected
                        ? "Connect wallet first"
                        : isAuthenticating
                            ? "Sign the message in MetaMask..."
                            : isPending
                                ? "Parsing with Claude..."
                                : !isAuthenticated
                                    ? "Authenticate + Create Market"
                                    : "Create Market"}
                </button>
            </div>
        </div>
    );
}
