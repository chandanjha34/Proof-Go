"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { fetchProfile } from "@/lib/api";
import { MonadBadge } from "@/components/MonadBadge";
import { COLLECTION_FEE_MON } from "@/lib/contracts";
import { payCollectionFee } from "@/lib/walletFee";
import { getTxExplorerUrl } from "@/lib/explorer";
import type { IdentityProfile } from "@/lib/types";

export default function PublicProfilePage() {
  const params = useParams<{ tokenId: string }>();
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const tokenId = params.tokenId;
  const [profile, setProfile] = useState<IdentityProfile | null>(null);
  const [collectorName, setCollectorName] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [message, setMessage] = useState("");
  const [feeExplorerUrl, setFeeExplorerUrl] = useState("");
  const [collectExplorerUrl, setCollectExplorerUrl] = useState("");
  const collectorAddress = useMemo(() => wallets[0]?.address ?? "", [wallets]);

  useEffect(() => {
    const load = async () => {
      const next = await fetchProfile(tokenId);
      setProfile(next);
    };

    load();
  }, [tokenId]);

  const handleCollect = async (event: FormEvent) => {
    event.preventDefault();
    if (!collectorName.trim()) {
      return;
    }

    if (!authenticated) {
      setMessage("Please login via email to collect.");
      login();
      return;
    }

    if (!collectorAddress) {
      setMessage("Preparing your wallet, please try again in a moment.");
      return;
    }

    if (!wallets[0]) {
      setMessage("Wallet not ready yet. Please retry.");
      return;
    }

    setMessage(`Paying ${COLLECTION_FEE_MON} MON collection fee...`);
    setFeeExplorerUrl("");
    setCollectExplorerUrl("");

    let feeTxHash = "";
    let assistedFeeMode = false;
    try {
      const feeTx = await payCollectionFee(wallets[0]);
      feeTxHash = feeTx.txHash;
      assistedFeeMode = feeTx.assistedMode;
      if (feeTx.txHash) {
        setFeeExplorerUrl(feeTx.explorerUrl ?? getTxExplorerUrl(feeTx.txHash));
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Fee payment failed: ${error.message}`
          : "Fee payment failed. Please fund wallet and retry.",
      );
      return;
    }

    setMessage("Executing collect on Monad...");
    const res = await fetch("/api/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collectorAddress,
        collectorName: collectorName.trim(),
        profileId: tokenId,
        feeTxHash: feeTxHash || undefined,
        assistedFeeMode,
      }),
    });

    const payload = (await res.json()) as {
      error?: string;
      txHash?: string;
      txExplorerUrl?: string;
      feeTxExplorerUrl?: string;
    };

    if (!res.ok) {
      setMessage(payload.error ?? "Could not collect this profile right now.");
      return;
    }

    if (payload.feeTxExplorerUrl) {
      setFeeExplorerUrl(payload.feeTxExplorerUrl);
    }
    if (payload.txExplorerUrl) {
      setCollectExplorerUrl(payload.txExplorerUrl);
    }

    setMessage(assistedFeeMode ? "⚡ Added to collection on Monad (assisted fee mode)!" : "⚡ Added to collection on Monad!");
    setShowPrompt(false);
  };

  if (!profile) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-4 py-10">
        <p className="text-xl font-black">Scanning personality...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <MonadBadge text="Confirmed on Monad" />
      <section className="grid gap-6 rounded-3xl border-4 border-black bg-white p-4 shadow-[8px_8px_0_0_#000] md:grid-cols-2">
        <img
          src={profile.posterUrl}
          alt={`${profile.name} poster`}
          className="h-full w-full rounded-2xl border-2 border-black object-cover"
        />
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-black text-black">{profile.name}</h1>
          <p className="text-lg font-bold text-zinc-700">{profile.tagline}</p>
          {profile.oneLiner ? (
            <p className="rounded-xl border-2 border-black bg-[#fef9c3] p-3 text-sm font-black text-black">
              {profile.oneLiner}
            </p>
          ) : null}
          {profile.creativeComment ? (
            <p className="rounded-xl border-2 border-black bg-[#e0f2fe] p-3 text-sm font-bold text-zinc-800">
              {profile.creativeComment}
            </p>
          ) : null}
          {profile.pokemonNature || profile.pokemonType ? (
            <div className="rounded-xl border-2 border-black bg-[#ffe4e6] p-3 text-sm font-black text-black">
              {profile.pokemonNature ? `Nature: ${profile.pokemonNature}` : ""}
              {profile.pokemonNature && profile.pokemonType ? " • " : ""}
              {profile.pokemonType ? `Type: ${profile.pokemonType}` : ""}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {profile.traits.map((trait) => (
              <span
                key={trait}
                className="rounded-full border-2 border-black bg-[#fef08a] px-3 py-1 text-xs font-black"
              >
                {trait}
              </span>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-3 text-sm font-bold text-zinc-800">
            {profile.socials.x ? <a href={profile.socials.x}>X</a> : null}
            {profile.socials.linkedin ? <a href={profile.socials.linkedin}>LinkedIn</a> : null}
            {profile.socials.instagram ? <a href={profile.socials.instagram}>Instagram</a> : null}
          </div>

          <div className="mt-auto flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowPrompt(true)}
              className="rounded-full border-2 border-black bg-[#00b96b] px-4 py-2 font-black text-black shadow-[4px_4px_0_0_#000]"
            >
              Add to My Collection
            </button>
            <button
              type="button"
              onClick={() => navigator.share?.({ title: "ProofOfMeet", url: window.location.href })}
              className="rounded-full border-2 border-black bg-[#fff4d6] px-4 py-2 font-black text-black"
            >
              Share
            </button>
            <button
              type="button"
              onClick={() => setShowPrompt(true)}
              className="rounded-full border-2 border-black bg-white px-4 py-2 font-black text-black"
            >
              Connect
            </button>
          </div>
        </div>
      </section>

      {showPrompt ? (
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleCollect}
          className="rounded-2xl border-4 border-black bg-[#7ee7ff] p-4 shadow-[6px_6px_0_0_#000]"
        >
          <p className="mb-2 text-lg font-black">Enter your name</p>
          <div className="flex gap-2">
            <input
              value={collectorName}
              onChange={(event) => setCollectorName(event.target.value)}
              className="w-full rounded-xl border-2 border-black bg-white px-3 py-2 font-bold"
              placeholder="Your name"
              required
            />
            <button
              type="submit"
              className="rounded-xl border-2 border-black bg-[#ffbc42] px-4 py-2 font-black"
            >
              Collect
            </button>
          </div>
        </motion.form>
      ) : null}

      {message ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border-2 border-black bg-[#b3ff66] p-3 text-center font-black"
        >
          <p>{message}</p>
          {feeExplorerUrl ? (
            <a
              href={feeExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-black"
            >
              View Fee Tx
            </a>
          ) : null}
          {collectExplorerUrl ? (
            <a
              href={collectExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-2 mt-2 inline-block rounded-full border-2 border-black bg-[#fff4d6] px-3 py-1 text-xs font-black"
            >
              View Collect Tx
            </a>
          ) : null}
        </motion.div>
      ) : null}
    </main>
  );
}
