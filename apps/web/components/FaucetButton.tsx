"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { faucetApi } from "@/lib/api";

export default function FaucetButton() {
    const { address } = useAccount();
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState<string | null>(null);

    const claim = async () => {
        if (!address) return;
        setLoading(true);
        setError(null);
        setCooldown(null);

        try {
            await faucetApi.claim(address);
            setDone(true);
            setTimeout(() => setDone(false), 5000);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed";
            if (message.includes("Cooldown")) {
                setCooldown(message);
            } else {
                setError(message);
            }
        } finally {
            setLoading(false);
        }
    };

    if (!address) return null;

    return (
        <div className="flex flex-col gap-1">
            <button
                onClick={claim}
                disabled={loading || done}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:text-gray-900 hover:border-gray-300 disabled:opacity-50 transition-all"
            >
                {loading
                    ? "Sending tokens..."
                    : done
                        ? "✓ 10,000 PRED received!"
                        : "Get test PRED"}
            </button>
            {cooldown && (
                <span className="text-xs text-amber-600">{cooldown}</span>
            )}
            {error && (
                <span className="text-xs text-red-500">{error}</span>
            )}
        </div>
    );
}