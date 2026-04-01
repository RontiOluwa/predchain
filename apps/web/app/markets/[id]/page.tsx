"use client";

import { useParams } from "next/navigation";
import { useMarket } from "@/hooks/useMarkets";
import { StakePanel } from "@/components/StakePanel";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { MarketStatus } from "@/components/MarketStatus";
// import { useIsMounted } from "@/hooks/useIsMounted";

export const dynamic = "force-dynamic";
export default function MarketDetailPage() {

    const { id } = useParams<{ id: string }>();
    // const mounted = useIsMounted();
    const { data, isLoading, error } = useMarket(id);
    // if (!mounted) return null;

    if (isLoading) {
        return (
            <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-100 rounded w-full" />
                <div className="h-32 bg-gray-100 rounded" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="text-center py-12 text-gray-500">
                Market not found.
            </div>
        );
    }

    const { market } = data;
    const deadline = new Date(market.deadline);

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                    <h1 className="text-xl font-bold text-gray-900">{market.question}</h1>
                    <MarketStatus status={market.status} />
                </div>
                <p className="text-gray-600 text-sm">{market.description}</p>
            </div>

            {/* Probability */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="text-sm font-medium text-gray-700 mb-3">
                    Market Probability
                </h2>
                <ProbabilityBar
                    yesPool={market.yesPool}
                    noPool={market.noPool}
                    outcome={market.outcome}
                />
            </div>

            {/* Details */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-medium text-gray-700">Details</h2>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                    <span className="text-gray-500">Condition</span>
                    <span className="font-mono text-gray-900">
                        {market.subject} {market.conditionOperator} {market.conditionThreshold} {market.conditionUnit}
                    </span>
                    <span className="text-gray-500">Deadline</span>
                    <span className="text-gray-900">{deadline.toLocaleDateString()}</span>
                    <span className="text-gray-500">Resolution</span>
                    <span className="text-gray-900">{market.resolutionSource}</span>
                    {/* <span className="text-gray-500">AI Confidence</span>
                    <span className="text-gray-900">{(market.confidence * 100).toFixed(0)}%</span> */}
                    {market.contractAddress && (
                        <>
                            <span className="text-gray-500">Contract</span>
                            <a
                                href={`https://sepolia.basescan.org/address/${market.contractAddress}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline font-mono text-xs truncate"
                            >
                                {market.contractAddress.slice(0, 10)}...
                            </a>
                        </>
                    )}
                </div>
            </div>

            {/* Staking panel */}
            <StakePanel market={market} />

            {/* Resolution evidence */}
            {market.resolutionEvidence && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                    <h2 className="text-sm font-medium text-gray-700">Resolution Evidence</h2>
                    <div className="text-sm space-y-2">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Oracle value</span>
                            <span className="font-mono">{market.resolutionEvidence.oracleValue}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 block mb-1">AI Reasoning</span>
                            <p className="text-gray-800 bg-gray-50 rounded p-2 text-xs leading-relaxed">
                                {market.resolutionEvidence.reasoning}
                            </p>
                        </div>
                        {market.resolutionEvidence.settlementTxHash && (
                            <a
                                href={`https://sepolia.basescan.org/tx/${market.resolutionEvidence.settlementTxHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline text-xs block"
                            >
                                View settlement transaction →
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}