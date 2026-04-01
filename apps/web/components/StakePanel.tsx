"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useStake } from "@/hooks/useStake";
import type { ApiMarket } from "@/lib/api";
import FaucetButton from "./FaucetButton";

export function StakePanel({ market }: { market: ApiMarket }) {
    const { isConnected } = useAccount();
    const { stake, reset, step, error, isLoading, stepLabel } = useStake();
    const [amount, setAmount] = useState("100");
    const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);

    const canStake =
        market.status === "OPEN" &&
        market.contractAddress &&
        isConnected &&
        !isLoading;

    const handleStake = async () => {
        if (!selectedSide || !market.contractAddress) return;

        const success = await stake({
            marketId: market.id,
            contractAddress: market.contractAddress,
            side: selectedSide,
            amount,
        });

        if (success) {
            setTimeout(reset, 3000); // Reset after 3s
        }
    };

    if (market.status !== "OPEN") {
        return (
            <div className="border border-gray-200 rounded-xl p-5 bg-gray-50">
                <p className="text-sm text-gray-500 text-center">
                    {market.status === "PENDING" && "Contract deploying — staking opens shortly"}
                    {market.status === "LOCKED" && "Staking is closed — market locked"}
                    {market.status === "RESOLVED" && "Market resolved — claim your payout below"}
                    {market.status === "CANCELLED" && "Market cancelled — claim your refund below"}
                </p>
            </div>
        );
    }

    return (
        <div className="border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900">Place a stake</h3>

            {/* Side selection */}
            <div className="grid grid-cols-2 gap-3">
                <button
                    onClick={() => setSelectedSide("YES")}
                    className={`py-3 rounded-lg font-semibold text-sm border-2 transition-all ${selectedSide === "YES"
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-gray-200 text-gray-600 hover:border-green-300"
                        }`}
                >
                    YES
                </button>
                <button
                    onClick={() => setSelectedSide("NO")}
                    className={`py-3 rounded-lg font-semibold text-sm border-2 transition-all ${selectedSide === "NO"
                        ? "border-red-500 bg-red-50 text-red-600"
                        : "border-gray-200 text-gray-600 hover:border-red-300"
                        }`}
                >
                    NO
                </button>
            </div>

            {/* Amount input */}
            <div>
                <label className="text-sm text-gray-600 mb-1 block">Amount (PRED)</label>
                <div className="flex gap-2">
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        min="1"
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {/* Quick amount buttons */}
                    {["100", "500", "1000"].map((v) => (
                        <button
                            key={v}
                            onClick={() => setAmount(v)}
                            className="px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {/* Status message */}
            {isLoading && (
                <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                    <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    {stepLabel}
                </div>
            )}

            {step === "done" && (
                <div className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">
                    Stake confirmed on-chain!
                </div>
            )}

            {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    {error}
                </div>
            )}

            {/* Submit button */}
            <button
                onClick={handleStake}
                disabled={!canStake || !selectedSide || !amount}
                className="w-full py-3 rounded-lg font-semibold text-sm bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
            >
                {!isConnected
                    ? "Connect wallet to stake"
                    : !selectedSide
                        ? "Select YES or NO"
                        : isLoading
                            ? "Processing..."
                            : `Stake ${amount} PRED on ${selectedSide}`}
            </button>


            {/* <FaucetButton /> */}
            <p className="text-xs text-gray-400 text-center">
                Two MetaMask confirmations required: approve + stake
            </p>
        </div>
    );
}