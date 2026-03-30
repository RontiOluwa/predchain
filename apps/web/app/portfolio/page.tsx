"use client";

import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { stakesApi } from "@/lib/api";
// import { useIsMounted } from "@/hooks/useIsMounted";
import { formatPred } from "@/hooks/useMarkets";
import Link from "next/link";


export default function PortfolioPage() {

    const { address, isConnected } = useAccount();
    // const mounted = useIsMounted();
    // if (!mounted) return null;
    const { data, isLoading } = useQuery({
        queryKey: ["stakes", "user", address],
        queryFn: () => stakesApi.byUser(address!),
        enabled: !!address,
    });

    if (!isConnected) {
        return (
            <div className="text-center py-16 text-gray-500">
                Connect your wallet to view your portfolio.
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Portfolio</h1>

            {isLoading && <p className="text-gray-500">Loading stakes...</p>}

            {data?.stakes.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    No stakes yet. <Link href="/" className="text-blue-600 hover:underline">Browse markets →</Link>
                </div>
            )}

            <div className="space-y-3">
                {data?.stakes.map((stake) => (
                    <Link key={stake.id} href={`/markets/${stake.marketId}`}>
                        <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-all">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-gray-900 font-medium line-clamp-1">
                                    {stake.market?.question ?? stake.marketId}
                                </p>
                                <span className={`text-sm font-semibold ${stake.side === "YES" ? "text-green-600" : "text-red-600"}`}>
                                    {stake.side}
                                </span>
                            </div>
                            <div className="flex justify-between mt-1 text-xs text-gray-500">
                                <span>{formatPred(stake.amount)} PRED staked</span>
                                <span>{new Date(stake.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}