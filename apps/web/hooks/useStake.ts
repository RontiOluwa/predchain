"use client";

import { useState, useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient, useAccount } from "wagmi";
import { parseEther, parseUnits } from "viem";
import { PRED_TOKEN_ABI, PREDICTION_MARKET_ABI } from "@/lib/wagmi.config";
import { stakesApi } from "@/lib/api";
import { useAuth } from "./useAuth";

type StakeStep =
    | "idle"
    | "authenticating"
    | "approving"
    | "waiting-approve"
    | "staking"
    | "waiting-stake"
    | "recording"
    | "done"
    | "error";

export function useStake() {
    const { address } = useAccount();
    const { authenticate } = useAuth();
    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();

    const [step, setStep] = useState<StakeStep>("idle");
    const [error, setError] = useState<string | null>(null);
    const [stakeTxHash, setStakeTxHash] = useState<`0x${string}` | undefined>();

    const { isLoading: isWaitingForTx } = useWaitForTransactionReceipt({
        hash: stakeTxHash,
    });

    const stake = useCallback(
        async ({
            marketId,
            contractAddress,
            side,
            amount,
        }: {
            marketId: string;
            contractAddress: string;
            side: "YES" | "NO";
            amount: string;
        }): Promise<boolean> => {
            if (!address || !publicClient) {
                setError("Connect your wallet first");
                return false;
            }

            setError(null);
            const amountWei = parseEther(amount);
            const tokenAddress = process.env["NEXT_PUBLIC_PRED_TOKEN_ADDRESS"] as `0x${string}`;

            try {
                // ── Step 1: Authenticate ──────────────────────────────
                setStep("authenticating");
                const authed = await authenticate();
                if (!authed) {
                    setError("Authentication failed");
                    setStep("error");
                    return false;
                }

                // ── Step 2: Approve token spend ───────────────────────
                setStep("approving");
                const approveTxHash = await writeContractAsync({
                    address: tokenAddress,
                    abi: PRED_TOKEN_ABI,
                    functionName: "approve",
                    args: [contractAddress as `0x${string}`, parseUnits(amount, 18)],
                    // gas: 100_000n,
                });



                // ── Step 3: Wait for approval ─────────────────────────
                setStep("waiting-approve");
                await publicClient.waitForTransactionReceipt({
                    hash: approveTxHash,
                    confirmations: 1,
                });

                // ── Step 4: Stake on-chain ────────────────────────────
                setStep("staking");
                const stakeHash = await writeContractAsync({
                    address: contractAddress as `0x${string}`,
                    abi: PREDICTION_MARKET_ABI,
                    functionName: side === "YES" ? "stakeYes" : "stakeNo",
                    args: [amountWei],
                    // gas: 150_000n,
                });

                setStakeTxHash(stakeHash);

                // ── Step 5: Wait for stake confirmation ───────────────
                setStep("waiting-stake");
                const stakeReceipt = await publicClient.waitForTransactionReceipt({
                    hash: stakeHash,
                    confirmations: 1,
                });

                // ← ADD THIS CHECK
                if (stakeReceipt.status === "reverted") {
                    throw new Error(
                        "Stake transaction reverted on-chain. Check you have enough PRED tokens and the market is still OPEN."
                    );
                }

                // ── Step 6: Record in backend ─────────────────────────
                setStep("recording");
                await stakesApi.record({
                    marketId,
                    side,
                    amount: amountWei.toString(),
                    userAddress: address,
                    txHash: stakeHash,
                });

                setStep("done");
                return true;
            } catch (err) {
                const message = err instanceof Error ? err.message : "Staking failed";
                setError(message);
                setStep("error");
                return false;
            }
        },
        [address, authenticate, writeContractAsync, publicClient]
    );

    const reset = useCallback(() => {
        setStep("idle");
        setError(null);
        setStakeTxHash(undefined);
    }, []);

    return {
        stake,
        reset,
        step,
        error,
        isLoading: step !== "idle" && step !== "done" && step !== "error",
        isWaitingForTx,
        stepLabel: STEP_LABELS[step],
    };
}

const STEP_LABELS: Record<StakeStep, string> = {
    idle: "",
    authenticating: "Authenticating wallet...",
    approving: "Approve token spend in MetaMask...",
    "waiting-approve": "Waiting for approval confirmation...",
    staking: "Confirm stake in MetaMask...",
    "waiting-stake": "Waiting for stake confirmation...",
    recording: "Recording stake...",
    done: "Stake confirmed!",
    error: "Failed",
};