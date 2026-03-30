import Link from "next/link";
import type { ApiMarket } from "@/lib/api";
import { MarketStatus } from "./MarketStatus";
import { ProbabilityBar } from "./ProbabilityBar";

export function MarketCard({ market }: { market: ApiMarket }) {
    const deadline = new Date(market.deadline);
    const isExpired = deadline < new Date();
    const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);

    return (
        <Link href={`/markets/${market.id}`}>
            <div className="border border-gray-200 rounded-xl p-5 hover:border-gray-300 hover:shadow-sm transition-all bg-white cursor-pointer">

                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-medium text-gray-900 leading-snug line-clamp-2">
                        {market.question}
                    </h3>
                    <MarketStatus status={market.status} />
                </div>

                {/* Probability bar */}
                <div className="mb-4">
                    <ProbabilityBar
                        yesPool={market.yesPool}
                        noPool={market.noPool}
                        outcome={market.outcome}
                    />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                        <span className="font-medium text-gray-700">{market.resolutionSource}</span>
                        · {market.subject}
                    </span>
                    <span>
                        {isExpired
                            ? "Expired"
                            : `${daysLeft}d left`}
                    </span>
                </div>
            </div>
        </Link>
    );
}