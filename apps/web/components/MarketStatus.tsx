type Status = "PENDING" | "OPEN" | "LOCKED" | "RESOLVED" | "SETTLED" | "CANCELLED";

const CONFIG: Record<Status, { label: string; className: string }> = {
    PENDING: { label: "Deploying", className: "bg-yellow-100 text-yellow-800" },
    OPEN: { label: "Open", className: "bg-green-100 text-green-800" },
    LOCKED: { label: "Locked", className: "bg-blue-100 text-blue-800" },
    RESOLVED: { label: "Resolved", className: "bg-purple-100 text-purple-800" },
    SETTLED: { label: "Settled", className: "bg-gray-100 text-gray-800" },
    CANCELLED: { label: "Cancelled", className: "bg-red-100 text-red-800" },
};

export function MarketStatus({ status }: { status: Status }) {
    const { label, className } = CONFIG[status] ?? CONFIG.CANCELLED;
    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
            {status === "OPEN" && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />
            )}
            {label}
        </span>
    );
}