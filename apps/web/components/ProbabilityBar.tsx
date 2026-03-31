import { calcProbability, formatPred } from "@/hooks/useMarkets";

interface ProbabilityBarProps {
    yesPool: string;
    noPool: string;
    outcome?: "YES" | "NO" | "VOID" | undefined;
}

export function ProbabilityBar({ yesPool, noPool, outcome }: ProbabilityBarProps) {
    const probability = calcProbability(yesPool, noPool);
    const noProb = 100 - probability;

    return (
        <div className="space-y-2">
            {/* Bar */}
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
                <div
                    className="bg-green-500 transition-all duration-500"
                    style={{ width: `${probability}%` }}
                />
                <div
                    className="bg-red-400 transition-all duration-500"
                    style={{ width: `${noProb}%` }}
                />
            </div>

            {/* Labels */}
            <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="font-medium text-green-700">YES</span>
                    <span className="text-gray-500">{probability}%</span>
                    <span className="text-gray-400 text-xs">({formatPred(yesPool)} PRED)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 text-xs">({formatPred(noPool)} PRED)</span>
                    <span className="text-gray-500">{noProb}%</span>
                    <span className="font-medium text-red-600">NO</span>
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                </div>
            </div>

            {/* Outcome banner if resolved */}
            {outcome && outcome !== "VOID" && (
                <div className={`text-center py-1 rounded text-sm font-semibold ${outcome === "YES"
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                    }`}>
                    Resolved: {outcome}
                </div>
            )}
            {outcome === "VOID" && (
                <div className="text-center py-1 rounded text-sm font-semibold bg-gray-50 text-gray-600">
                    Voided — full refunds available
                </div>
            )}
        </div>
    );
}