"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

/**
 * ConnectButton uses wagmi hooks internally.
 * Must be dynamically imported with ssr: false to prevent
 * indexedDB errors during server-side rendering.
 */
const ConnectButton = dynamic(
    () =>
        import("@rainbow-me/rainbowkit").then((m) => m.ConnectButton),
    {
        ssr: false, loading: () => (
            <div className="h-8 w-32 bg-gray-100 rounded-lg animate-pulse" />
        )
    }
);

export function Navbar() {
    return (
        <nav className="border-b border-gray-200 bg-white">
            <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
                <div className="flex items-center gap-8">
                    <Link href="/" className="font-bold text-gray-900 text-lg">
                        Predchain
                    </Link>
                    <div className="flex items-center gap-6 text-sm">
                        <Link href="/" className="text-gray-600 hover:text-gray-900">
                            Markets
                        </Link>
                        <Link href="/create" className="text-gray-600 hover:text-gray-900">
                            Create
                        </Link>
                        <Link href="/portfolio" className="text-gray-600 hover:text-gray-900">
                            Portfolio
                        </Link>
                    </div>
                </div>
                <ConnectButton
                    showBalance={false}
                    chainStatus="icon"
                    accountStatus="address"
                />
            </div>
        </nav>
    );
}