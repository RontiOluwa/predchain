"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatEther } from "viem";
import { PRED_TOKEN_ABI } from "@/lib/wagmi.config";
import { faucetApi } from "@/lib/api";

const ConnectButton = dynamic(
    () => import("@rainbow-me/rainbowkit").then((m) => m.ConnectButton),
    {
        ssr: false,
        loading: () => (
            <div className="h-8 w-28 bg-gray-100 rounded-lg animate-pulse" />
        ),
    }
);

function PredBalance() {
    const { address, isConnected } = useAccount();
    const [claiming, setClaiming] = useState(false);
    const [claimed, setClaimed] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { data: balance, refetch } = useReadContract({
        address: process.env[
            "NEXT_PUBLIC_PRED_TOKEN_ADDRESS"
        ] as `0x${string}`,
        abi: PRED_TOKEN_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        query: { enabled: !!address && isConnected },
    });

    const predBalance = balance ? parseFloat(formatEther(balance)) : 0;
    const isLow = predBalance < 1000;

    const claim = async () => {
        if (!address) return;
        setClaiming(true);
        setError(null);
        try {
            await faucetApi.claim(address);
            setClaimed(true);
            refetch();
            setTimeout(() => setClaimed(false), 4000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed");
            setTimeout(() => setError(null), 4000);
        } finally {
            setClaiming(false);
        }
    };

    if (!isConnected || !address) return null;

    return (
        <div className="flex items-center gap-2">
            {/* PRED Balance */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-xs font-mono text-gray-700">
                    {predBalance.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                    })}{" "}
                    PRED
                </span>
            </div>

            {/* Faucet button — only when balance is low */}
            {isLow && (
                <button
                    onClick={claim}
                    disabled={claiming || claimed}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${claimed
                            ? "bg-green-50 border-green-200 text-green-700"
                            : error
                                ? "bg-red-50 border-red-200 text-red-600"
                                : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                        } disabled:opacity-60`}
                >
                    {claiming
                        ? "Sending..."
                        : claimed
                            ? "✓ 10k PRED!"
                            : error
                                ? error.includes("Cooldown")
                                    ? "Cooldown active"
                                    : "Failed"
                                : "+ Get PRED"}
                </button>
            )}
        </div>
    );
}

export function Navbar() {
    const [menuOpen, setMenuOpen] = useState(false);

    // Close menu on route change
    useEffect(() => {
        setMenuOpen(false);
    }, []);

    return (
        <nav className="border-b border-gray-200 bg-white sticky top-0 z-50">
            <div className="max-w-5xl mx-auto px-4">
                <div className="h-14 flex items-center justify-between gap-4">

                    {/* Left — logo + desktop nav links */}
                    <div className="flex items-center gap-6 min-w-0">
                        <Link
                            href="/"
                            className="font-bold text-gray-900 text-lg shrink-0"
                        >
                            Predchain
                        </Link>

                        {/* Desktop nav links */}
                        <div className="hidden md:flex items-center gap-5 text-sm">
                            <Link
                                href="/"
                                className="text-gray-500 hover:text-gray-900 transition-colors"
                            >
                                Markets
                            </Link>
                            <Link
                                href="/create"
                                className="text-gray-500 hover:text-gray-900 transition-colors"
                            >
                                Create
                            </Link>
                            <Link
                                href="/portfolio"
                                className="text-gray-500 hover:text-gray-900 transition-colors"
                            >
                                Portfolio
                            </Link>
                        </div>
                    </div>

                    {/* Right — balance + faucet + connect (desktop) */}
                    <div className="hidden md:flex items-center gap-3 shrink-0">
                        <PredBalance />
                        <ConnectButton
                            showBalance={false}
                            chainStatus="icon"
                            accountStatus="address"
                        />
                    </div>

                    {/* Mobile — connect button + hamburger */}
                    <div className="flex md:hidden items-center gap-2 shrink-0">
                        <ConnectButton
                            showBalance={false}
                            chainStatus="none"
                            accountStatus="avatar"
                        />
                        <button
                            onClick={() => setMenuOpen(!menuOpen)}
                            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                            aria-label="Toggle menu"
                        >
                            <div className="w-5 flex flex-col gap-1">
                                <span
                                    className={`block h-0.5 bg-gray-700 transition-transform origin-center ${menuOpen ? "rotate-45 translate-y-1.5" : ""
                                        }`}
                                />
                                <span
                                    className={`block h-0.5 bg-gray-700 transition-opacity ${menuOpen ? "opacity-0" : ""
                                        }`}
                                />
                                <span
                                    className={`block h-0.5 bg-gray-700 transition-transform origin-center ${menuOpen ? "-rotate-45 -translate-y-1.5" : ""
                                        }`}
                                />
                            </div>
                        </button>
                    </div>
                </div>

                {/* Mobile dropdown menu */}
                {menuOpen && (
                    <div className="md:hidden border-t border-gray-100 py-3 space-y-1">
                        <Link
                            href="/"
                            onClick={() => setMenuOpen(false)}
                            className="block px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                        >
                            Markets
                        </Link>
                        <Link
                            href="/create"
                            onClick={() => setMenuOpen(false)}
                            className="block px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                        >
                            Create
                        </Link>
                        <Link
                            href="/portfolio"
                            onClick={() => setMenuOpen(false)}
                            className="block px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                        >
                            Portfolio
                        </Link>

                        {/* Balance + faucet in mobile menu */}
                        <div className="pt-2 border-t border-gray-100 px-2">
                            <PredBalance />
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
}