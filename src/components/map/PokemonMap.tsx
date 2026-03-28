"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { DivIcon, LatLngTuple } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { COLLECTION_FEE_MON } from "@/lib/contracts";
import { supabase, type EncounterWaveRow, type LiveLocationRow } from "@/lib/supabase";
import { payCollectionFee } from "@/lib/walletFee";
import { getTxExplorerUrl } from "@/lib/explorer";

const NETWORKING_SESSION_MINUTES = 45;
const LOCATION_PUSH_INTERVAL_MS = 6000;
const LOCATION_MIN_MOVE_METERS = 5;
const ENCOUNTER_METERS = 10;

const avatars = ["⚡", "🔥", "🌊", "🌿", "👻", "🐲", "🪨", "🧿", "🦋", "🐉"];
const dummyNames = ["PikaByte", "FlareFox", "AquaMint", "LeafDash", "GhostPing", "DracoNode"];

function hashToAvatar(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return avatars[Math.abs(hash) % avatars.length];
}

function seededOffset(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }

  const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
  const radiusMeters = 8 + (Math.abs(hash) % 22);
  return { angle, radiusMeters };
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceMeters(a: LatLngTuple, b: LatLngTuple) {
  const R = 6371000;
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const deltaLat = toRad(b[0] - a[0]);
  const deltaLon = toRad(b[1] - a[1]);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function addMetersToLatLng(center: LatLngTuple, meters: number, angleRad: number): LatLngTuple {
  const earth = 6378137;
  const dLat = (meters * Math.cos(angleRad)) / earth;
  const dLng = (meters * Math.sin(angleRad)) / (earth * Math.cos(Math.PI * center[0] / 180));
  return [center[0] + (dLat * 180) / Math.PI, center[1] + (dLng * 180) / Math.PI];
}

function markerIcon(emoji: string) {
  return new DivIcon({
    className: "",
    html: `<div style='font-size:34px;filter:drop-shadow(0 2px 1px #0006)'>${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 32],
  });
}

function RecenterOnMe({ center }: { center: LatLngTuple }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 18);
  }, [center, map]);
  return null;
}

function parseTs(value: string) {
  return new Date(value).getTime();
}

function createDummyRows(center: LatLngTuple): LiveLocationRow[] {
  return dummyNames.map((name, index) => {
    const key = `dummy-${index}`;
    const offset = seededOffset(key);
    const point = addMetersToLatLng(center, 20 + index * 12, offset.angle);
    return {
      wallet_address: key,
      display_name: name,
      profile_id: null,
      latitude: point[0],
      longitude: point[1],
      avatar: avatars[index % avatars.length],
      networking_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

export function PokemonMap() {
  const { authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const [center, setCenter] = useState<LatLngTuple>([28.6139, 77.209]);
  const [myAddress, setMyAddress] = useState("");
  const [displayName, setDisplayName] = useState("Explorer");
  const [rows, setRows] = useState<LiveLocationRow[]>([]);
  const [incomingWaves, setIncomingWaves] = useState<EncounterWaveRow[]>([]);
  const [nearby, setNearby] = useState<LiveLocationRow | null>(null);
  const [message, setMessage] = useState("");
  const [feeExplorerUrl, setFeeExplorerUrl] = useState("");
  const [collectExplorerUrl, setCollectExplorerUrl] = useState("");
  const [emailLabel, setEmailLabel] = useState("networking@proofgo.local");
  const [networkingUntil, setNetworkingUntil] = useState<number | null>(null);
  const [currentPos, setCurrentPos] = useState<LatLngTuple | null>(null);
  const [lastSentPos, setLastSentPos] = useState<LatLngTuple | null>(null);

  const myProfileId = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem("proof-go-profile-id");
  }, []);

  const isNetworking = networkingUntil !== null && networkingUntil > Date.now();

  const secondsLeft = networkingUntil
    ? Math.max(0, Math.floor((networkingUntil - Date.now()) / 1000))
    : 0;

  useEffect(() => {
    setMyAddress(wallets[0]?.address ?? "");

    if (typeof window !== "undefined") {
      const localName = window.localStorage.getItem("proof-go-display-name");
      if (localName) {
        setDisplayName(localName);
      }

      const email = user?.email?.address ?? window.localStorage.getItem("proof-go-email");
      if (email) {
        setEmailLabel(email);
      }

      const savedUntil = window.localStorage.getItem("proof-go-networking-until");
      if (savedUntil) {
        const parsed = Number(savedUntil);
        if (!Number.isNaN(parsed) && parsed > Date.now()) {
          setNetworkingUntil(parsed);
        }
      }
    }
  }, [user?.email?.address, wallets]);

  useEffect(() => {
    if (!isNetworking || !navigator.geolocation) {
      return;
    }

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const next: LatLngTuple = [position.coords.latitude, position.coords.longitude];
        setCurrentPos(next);
        setCenter(next);
      },
      (error) => {
        setMessage(`Location disabled: ${error.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watch);
    };
  }, [isNetworking]);

  useEffect(() => {
    const client = supabase;
    if (!client || !myAddress || !isNetworking) {
      return;
    }

    const loadLocations = async () => {
      const nowIso = new Date().toISOString();
      const { data } = await client
        .from("live_locations")
        .select("wallet_address, display_name, profile_id, latitude, longitude, avatar, updated_at, networking_until")
        .gt("networking_until", nowIso)
        .order("updated_at", { ascending: false })
        .limit(300);

      if (data) {
        setRows(data as LiveLocationRow[]);
      }
    };

    const loadWaves = async () => {
      const { data } = await client
        .from("encounter_waves")
        .select("id, from_wallet, to_wallet, from_name, profile_id, status, created_at")
        .eq("to_wallet", myAddress)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(30);

      if (data) {
        setIncomingWaves(data as EncounterWaveRow[]);
      }
    };

    loadLocations();
    loadWaves();

    const locationsChannel = client
      .channel("proof-go-live-locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_locations" }, () => {
        loadLocations();
      })
      .subscribe();

    const wavesChannel = client
      .channel("proof-go-waves")
      .on("postgres_changes", { event: "*", schema: "public", table: "encounter_waves" }, () => {
        loadWaves();
      })
      .subscribe();

    return () => {
      client.removeChannel(locationsChannel);
      client.removeChannel(wavesChannel);
    };
  }, [isNetworking, myAddress]);

  useEffect(() => {
    const client = supabase;
    if (!client || !myAddress || !isNetworking || !currentPos || !networkingUntil) {
      return;
    }

    const push = async () => {
      if (lastSentPos) {
        const moved = getDistanceMeters(lastSentPos, currentPos);
        if (moved < LOCATION_MIN_MOVE_METERS) {
          return;
        }
      }

      await client.from("live_locations").upsert(
        {
          wallet_address: myAddress,
          display_name: displayName,
          profile_id: myProfileId,
          latitude: currentPos[0],
          longitude: currentPos[1],
          avatar: hashToAvatar(myAddress),
          networking_until: new Date(networkingUntil).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" },
      );

      setLastSentPos(currentPos);
    };

    push();
    const interval = setInterval(push, LOCATION_PUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [currentPos, displayName, isNetworking, lastSentPos, myAddress, myProfileId, networkingUntil]);

  useEffect(() => {
    if (!isNetworking) {
      return;
    }

    const tick = setInterval(() => {
      setNetworkingUntil((prev) => {
        if (!prev) {
          return prev;
        }
        if (prev <= Date.now()) {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("proof-go-networking-until");
          }
          return null;
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [isNetworking]);

  useEffect(() => {
    const others = rows.filter((row) => row.wallet_address !== myAddress);
    const hit = others.find((row) => {
      const distance = getDistanceMeters(center, [row.latitude, row.longitude]);
      return distance <= ENCOUNTER_METERS;
    });

    setNearby(hit ?? null);
  }, [center, myAddress, rows]);

  const visibleRows = rows.filter((row) => row.wallet_address !== myAddress).slice(0, 200);
  const demoRows = useMemo(() => createDummyRows(center), [center]);
  const visibleWithDemo = [...visibleRows, ...demoRows].slice(0, 200);

  const startNetworking = () => {
    if (!authenticated) {
      setMessage("Login via email to start networking.");
      login();
      return;
    }

    if (!myAddress) {
      setMessage("Preparing your embedded wallet...");
      return;
    }

    const expires = Date.now() + NETWORKING_SESSION_MINUTES * 60 * 1000;
    setNetworkingUntil(expires);
    setMessage("Networking mode on. Radar warming up...");
    if (typeof window !== "undefined") {
      window.localStorage.setItem("proof-go-networking-until", String(expires));
    }
  };

  const stopNetworking = async () => {
    setNetworkingUntil(null);
    setMessage("Networking mode paused.");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("proof-go-networking-until");
    }

    const client = supabase;
    if (client && myAddress) {
      await client.from("live_locations").delete().eq("wallet_address", myAddress);
    }
  };

  const waveNearby = async () => {
    if (!nearby || !myAddress || !supabase) {
      return;
    }

    const { error } = await supabase.from("encounter_waves").insert({
      from_wallet: myAddress,
      to_wallet: nearby.wallet_address,
      from_name: displayName,
      profile_id: nearby.profile_id,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    if (error) {
      setMessage("Wave failed. Try again.");
      return;
    }

    setMessage(`👋 Wave sent to ${nearby.display_name}`);
  };

  const acceptWave = async (wave: EncounterWaveRow) => {
    if (!supabase) {
      return;
    }

    await supabase
      .from("encounter_waves")
      .update({ status: "accepted" })
      .eq("id", wave.id);

    if (wave.profile_id && myAddress) {
      const wallet = wallets[0];
      if (!wallet) {
        setMessage("Wallet not ready. Retry in a moment.");
        return;
      }

      try {
        setMessage(`Paying ${COLLECTION_FEE_MON} MON collection fee...`);
        const feeTx = await payCollectionFee(wallet);
        if (feeTx.txHash) {
          setFeeExplorerUrl(feeTx.explorerUrl ?? getTxExplorerUrl(feeTx.txHash));
        } else {
          setFeeExplorerUrl("");
        }
        setCollectExplorerUrl("");

        const response = await fetch("/api/collect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collectorAddress: myAddress,
            collectorName: displayName,
            profileId: wave.profile_id,
            feeTxHash: feeTx.txHash || undefined,
            assistedFeeMode: feeTx.assistedMode,
          }),
        });

        const payload = (await response.json()) as {
          error?: string;
          txExplorerUrl?: string;
          feeTxExplorerUrl?: string;
        };

        if (response.ok) {
          if (payload.feeTxExplorerUrl) {
            setFeeExplorerUrl(payload.feeTxExplorerUrl);
          }
          if (payload.txExplorerUrl) {
            setCollectExplorerUrl(payload.txExplorerUrl);
          }
          setMessage(
            feeTx.assistedMode
              ? `⚡ Encounter confirmed with ${wave.from_name}. Added on Monad (assisted fee mode)!`
              : `⚡ Encounter confirmed with ${wave.from_name}. Added on Monad!`,
          );
        } else {
          setMessage(payload.error ?? "Encounter confirmed but collect failed. Retry from profile.");
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? `Fee payment failed: ${error.message}`
            : "Fee payment failed. Fund wallet and retry.",
        );
      }
    }
  };

  if (!isNetworking) {
    return (
      <section className="rounded-[28px] border-4 border-black bg-white p-6 shadow-[10px_10px_0_0_#000]">
        <h3 className="text-3xl font-black text-black">Ambient Networking</h3>
        <p className="mt-2 max-w-2xl text-sm font-bold text-zinc-700">
          Keep it simple: tap networking mode when you are socially available. We open a 45-minute live session,
          show nearby builders as floating avatars, and trigger encounters only when in a realistic 8-12m zone.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={startNetworking}
            className="rounded-full border-2 border-black bg-[#00b96b] px-5 py-3 text-base font-black text-black shadow-[4px_4px_0_0_#000]"
          >
            I&apos;m Networking ⚡
          </button>
          <a
            href="/profile"
            className="rounded-full border-2 border-black bg-white px-5 py-3 text-base font-black text-black"
          >
            View My Card
          </a>
          <a
            href="/me"
            className="rounded-full border-2 border-black bg-[#fff4d6] px-5 py-3 text-base font-black text-black"
          >
            My Collection
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden rounded-[28px] border-4 border-black bg-white shadow-[10px_10px_0_0_#000]">
        <MapContainer center={center} zoom={18} scrollWheelZoom className="h-[500px] w-full">
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <RecenterOnMe center={center} />

          <Marker position={center} icon={markerIcon(hashToAvatar(myAddress || emailLabel || "me"))}>
            <Popup>
              <strong>{displayName}</strong>
              <div>Your Pokemon trainer is live.</div>
            </Popup>
          </Marker>

          {visibleWithDemo.map((row) => {
            const offset = seededOffset(row.wallet_address);
            const fogged = addMetersToLatLng([row.latitude, row.longitude], offset.radiusMeters, offset.angle);
            return (
              <Marker
                key={row.wallet_address}
                position={fogged}
                icon={markerIcon(row.avatar || hashToAvatar(row.wallet_address))}
              >
                <Popup>
                  <strong>{row.display_name}</strong>
                  <div>In your networking zone</div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      <aside className="space-y-4 rounded-[24px] border-4 border-black bg-[#fff4d6] p-4 shadow-[8px_8px_0_0_#000]">
        <h3 className="text-2xl font-black text-black">Networking Session</h3>
        <p className="text-sm font-bold text-zinc-700">
          Session active. We only sync your location every 6s or when you move more than 5m to stay battery friendly.
        </p>

        <div className="rounded-2xl border-2 border-black bg-white p-3 text-sm font-bold">
          <div>You: {displayName}</div>
          <div>Email: {emailLabel}</div>
          <div>Nearby builders: {visibleWithDemo.length}</div>
          <div>Time left: {Math.floor(secondsLeft / 60)}m {secondsLeft % 60}s</div>
        </div>

        {nearby ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border-2 border-black bg-[#b3ff66] p-3"
          >
            <div className="text-sm font-black">Encounter Zone</div>
            <div className="text-lg font-black text-black">{nearby.avatar} {nearby.display_name}</div>
            <div className="mb-2 text-sm font-bold">Inside ~8-12 meter range</div>
            <button
              type="button"
              onClick={waveNearby}
              className="rounded-full border-2 border-black bg-white px-3 py-2 text-sm font-black"
            >
              Wave 👋
            </button>
          </motion.div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-black bg-white p-3 text-sm font-bold text-zinc-700">
            No one in encounter zone yet. Keep moving.
          </div>
        )}

        {incomingWaves.length > 0 ? (
          <div className="space-y-2 rounded-2xl border-2 border-black bg-white p-3">
            <div className="text-sm font-black">Incoming Waves</div>
            {incomingWaves.slice(0, 3).map((wave) => (
              <div key={wave.id} className="rounded-xl border border-black p-2">
                <div className="text-sm font-bold">{wave.from_name} waved at you 👋</div>
                <button
                  type="button"
                  onClick={() => acceptWave(wave)}
                  className="mt-2 rounded-full border-2 border-black bg-[#ffbc42] px-3 py-1 text-xs font-black"
                >
                  Meet + Collect
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={stopNetworking}
          className="w-full rounded-full border-2 border-black bg-white px-3 py-2 text-sm font-black"
        >
          Stop Networking Mode
        </button>

        {message ? (
          <div className="rounded-xl border-2 border-black bg-[#7ee7ff] p-2 text-sm font-black">
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
          </div>
        ) : null}
      </aside>
    </section>
  );
}
