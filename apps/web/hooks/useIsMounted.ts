"use client";

import { useState, useEffect } from "react";

/**
 * Returns true only after the component has mounted on the client.
 * Use this to guard any component that uses wagmi hooks,
 * preventing WagmiProviderNotFoundError during the SSR/hydration window.
 */
export function useIsMounted() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    return mounted;
}