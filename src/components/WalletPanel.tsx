"use client";

import { useMemo, useState } from "react";
import { JsonRpcProvider, formatEther } from "ethers";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  COLLECTION_FEE_MON,
  MONAD_FAUCET_URL,
  MONAD_TESTNET,
} from "@/lib/contracts";

export function WalletPanel() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [balanceMon, setBalanceMon] = useState<string>("--");
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [loadingFaucet, setLoadingFaucet] = useState(false);
  const [message, setMessage] = useState("");
  const [faucetExplorerUrl, setFaucetExplorerUrl] = useState("");

  const walletAddress = useMemo(() => wallets[0]?.address ?? "", [wallets]);

  const refreshBalance = async () => {
    if (!walletAddress) {
      return;
    }

    setLoadingBalance(true);
    try {
      const provider = new JsonRpcProvider(MONAD_TESTNET.rpcUrl);
      const balance = await provider.getBalance(walletAddress);
      setBalanceMon(Number(formatEther(balance)).toFixed(4));
    } catch {
      setBalanceMon("error");
    } finally {
      setLoadingBalance(false);
    }
  };

  const dripTestnetMon = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!walletAddress) {
      setMessage("Preparing your embedded wallet...");
      return;
    }

    setLoadingFaucet(true);
    setMessage("Sending testnet MON to your wallet...");
    setFaucetExplorerUrl("");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toAddress: walletAddress }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const payload = (await res.json()) as {
        ok?: boolean;
        txHash?: string;
        txExplorerUrl?: string;
        status?: "confirmed" | "pending" | "failed";
        error?: string;
        details?: string;
      };
      if (!res.ok || !payload.ok) {
        setMessage(payload.error ?? payload.details ?? "Faucet request failed. Use public faucet link.");
        if (payload.txExplorerUrl) {
          setFaucetExplorerUrl(payload.txExplorerUrl);
        }
        return;
      }

      if (payload.txExplorerUrl) {
        setFaucetExplorerUrl(payload.txExplorerUrl);
      }

      if (payload.status === "pending") {
        setMessage(`Faucet broadcasted. Confirmation pending. Tx: ${payload.txHash?.slice(0, 12)}...`);
      } else {
        setMessage(`Faucet sent. Tx: ${payload.txHash?.slice(0, 12)}...`);
      }
      await refreshBalance();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Faucet request timed out. Please retry in a few seconds.");
      } else {
        setMessage("Faucet request failed. Use public faucet link.");
      }
    } finally {
      setLoadingFaucet(false);
    }
  };

  return (
    <section className="rounded-3xl border-4 border-black bg-[#fff4d6] p-5 shadow-[8px_8px_0_0_#000]">
      <h3 className="text-2xl font-black text-black">Wallet Station</h3>
      <p className="mt-1 text-sm font-bold text-zinc-700">
        Collections use your wallet balance. Each collect pays {COLLECTION_FEE_MON} MON network fee.
      </p>

      <div className="mt-3 rounded-2xl border-2 border-black bg-white p-3 text-sm font-bold">
        <div>Network: {MONAD_TESTNET.name}</div>
        <div>Address: {walletAddress || "Not connected"}</div>
        <div>Balance: {balanceMon} MON</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={refreshBalance}
          disabled={!walletAddress || loadingBalance}
          className="rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-black disabled:opacity-60"
        >
          {loadingBalance ? "Checking..." : "Refresh Balance"}
        </button>
        <button
          type="button"
          onClick={dripTestnetMon}
          disabled={loadingFaucet}
          className="rounded-full border-2 border-black bg-[#00b96b] px-4 py-2 text-sm font-black text-black disabled:opacity-60"
        >
          {loadingFaucet ? "Requesting..." : "Get Testnet Token"}
        </button>
        <a
          href={MONAD_FAUCET_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border-2 border-black bg-[#ffbc42] px-4 py-2 text-sm font-black text-black"
        >
          Open Monad Faucet
        </a>
      </div>

      {message ? (
        <div className="mt-3 rounded-xl border-2 border-black bg-[#e0f2fe] p-2 text-sm font-black text-black">
          <p>{message}</p>
          {faucetExplorerUrl ? (
            <a
              href={faucetExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-black"
            >
              View Faucet Tx
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
