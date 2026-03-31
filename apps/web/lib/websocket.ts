"use client";

import { useEffect, useRef, useCallback } from "react";

export type WsMessage =
    | { type: "connected"; message: string }
    | { type: "market:update"; data: { id: string; status: string; outcome?: string } }
    | { type: "market:pool"; data: { marketId: string; yesPool: string; noPool: string; probability: number } }
    | { type: "market:resolved"; data: { marketId: string; outcome: string } }
    | { type: "ping" }
    | { type: "subscribed"; marketId: string }
    | { type: "subscribed:all" }
    | { type: "error"; message: string };

interface UseMarketSocketOptions {
    onMessage: (msg: WsMessage) => void;
    marketId?: string;    // Subscribe to a specific market
    subscribeAll?: boolean; // Subscribe to all markets
}

/**
 * WebSocket hook for real-time market updates.
 *
 * Connects to the API gateway WebSocket server and handles:
 * - Auto-reconnect on disconnect (1 second delay)
 * - Keepalive pong responses to server ping
 * - Selective subscription to specific markets or all markets
 */
export function useMarketSocket({
    onMessage,
    marketId,
    subscribeAll = false,
}: UseMarketSocketOptions) {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);;
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage; // Always use latest callback

    const connect = useCallback(() => {
        const wsUrl =
            process.env["NEXT_PUBLIC_WS_URL"] ?? "ws://localhost:3001/ws/markets";

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            // Subscribe after connection is established
            if (subscribeAll) {
                ws.send(JSON.stringify({ type: "subscribe:all" }));
            } else if (marketId) {
                ws.send(JSON.stringify({ type: "subscribe", marketId }));
            }
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data) as WsMessage;

                // Respond to server keepalive pings
                if (msg.type === "ping") {
                    ws.send(JSON.stringify({ type: "pong" }));
                    return;
                }

                onMessageRef.current(msg);
            } catch {
                console.warn("Failed to parse WebSocket message", event.data);
            }
        };

        ws.onclose = () => {
            // Auto-reconnect after 1 second
            reconnectTimer.current = setTimeout(connect, 1000);
        };

        ws.onerror = () => {
            ws.close(); // Triggers onclose which triggers reconnect
        };
    }, [marketId, subscribeAll]);

    useEffect(() => {
        connect();

        return () => {
            clearTimeout(reconnectTimer.current);
            wsRef.current?.close();
        };
    }, [connect]);
}