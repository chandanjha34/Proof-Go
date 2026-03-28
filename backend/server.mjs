import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { Contract, JsonRpcProvider } from "ethers";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvLocal = path.resolve(__dirname, "..", ".env.local");
const rootEnv = path.resolve(__dirname, "..", ".env");
dotenv.config({ path: rootEnvLocal, override: true });
dotenv.config({ path: rootEnv, override: false });

const PORT = Number(process.env.INDEXER_PORT ?? 4001);
const RPC_URL = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const IDENTITY_NFT_ADDRESS = process.env.NEXT_PUBLIC_IDENTITY_NFT_ADDRESS ?? "";
const COLLECTION_REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_COLLECTION_REGISTRY_ADDRESS ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.SUPABASE_PRIVATE_KEY
  ?? process.env.SUPABASE_SECRET_KEY
  ?? "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

const identityAbi = [
  "event IdentityMinted(uint256 indexed tokenId, address indexed user, string metadataURI)",
];
const collectionAbi = [
  "event CollectionAdded(address indexed collector, uint256 indexed profileId)",
];

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use((req, _res, next) => {
  if (req.path !== "/health") {
    console.log(`[indexer] ${req.method} ${req.path}`);
  }
  next();
});

const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLISHABLE_KEY;
const supabaseEnabled = Boolean(SUPABASE_URL && supabaseKey);
const supabase = supabaseEnabled
  ? createClient(SUPABASE_URL, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const localState = {
  profiles: new Map(),
  collections: [],
  stats: {
    minted: 0,
    collections: 0,
    liveTx: 0,
    lastIdentityBlock: 0,
    lastCollectionBlock: 0,
  },
};

async function getStats() {
  if (!supabase) {
    return localState.stats;
  }

  const { data, error } = await supabase
    .from("app_stats")
    .select("minted, collections, live_tx, last_identity_block, last_collection_block")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return {
      minted: 0,
      collections: 0,
      liveTx: 0,
      lastIdentityBlock: 0,
      lastCollectionBlock: 0,
    };
  }

  return {
    minted: data.minted,
    collections: data.collections,
    liveTx: data.live_tx,
    lastIdentityBlock: data.last_identity_block,
    lastCollectionBlock: data.last_collection_block,
  };
}

async function setStats(stats) {
  if (!supabase) {
    localState.stats = stats;
    return;
  }

  await supabase.from("app_stats").upsert(
    {
      id: 1,
      minted: stats.minted,
      collections: stats.collections,
      live_tx: stats.liveTx,
      last_identity_block: stats.lastIdentityBlock,
      last_collection_block: stats.lastCollectionBlock,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "proof-of-meet-indexer" });
});

app.get("/stats", (_req, res) => {
  getStats()
    .then((stats) => {
      res.json({
        minted: stats.minted,
        collections: stats.collections,
        liveTx: stats.liveTx,
      });
    })
    .catch(() => {
      res.json({ minted: 0, collections: 0, liveTx: 0 });
    });
});

app.post("/profiles", async (req, res) => {
  const profile = req.body;
  if (!profile?.tokenId) {
    return res.status(400).json({ error: "tokenId is required" });
  }

  if (supabase) {
    await supabase.from("profiles").upsert(
      {
        token_id: profile.tokenId,
        payload: profile,
        created_at: new Date().toISOString(),
      },
      { onConflict: "token_id" },
    );
  } else {
    localState.profiles.set(profile.tokenId, profile);
  }

  const stats = await getStats();
  await setStats({
    ...stats,
    minted: stats.minted + 1,
    liveTx: stats.liveTx + 1,
  });

  return res.status(201).json({ ok: true });
});

app.get("/profiles/:tokenId", async (req, res) => {
  if (!supabase) {
    const profile = localState.profiles.get(req.params.tokenId);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    return res.json(profile);
  }

  const { data } = await supabase
    .from("profiles")
    .select("payload")
    .eq("token_id", req.params.tokenId)
    .maybeSingle();

  if (!data?.payload) {
    return res.status(404).json({ error: "Profile not found" });
  }

  return res.json(data.payload);
});

app.get("/profiles/by-owner/:ownerAddress", async (req, res) => {
  const ownerAddress = req.params.ownerAddress?.toLowerCase();
  if (!ownerAddress) {
    return res.status(400).json({ error: "ownerAddress is required" });
  }

  if (!supabase) {
    const values = Array.from(localState.profiles.values())
      .filter((profile) => (profile?.ownerAddress ?? "").toLowerCase() === ownerAddress)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    if (values.length === 0) {
      return res.status(404).json({ error: "Profile not found for owner" });
    }

    return res.json(values[0]);
  }

  const { data } = await supabase
    .from("profiles")
    .select("payload, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  const profile = (data ?? []).find((row) =>
    (row?.payload?.ownerAddress ?? "").toLowerCase() === ownerAddress,
  )?.payload;
  if (!profile) {
    return res.status(404).json({ error: "Profile not found for owner" });
  }

  return res.json(profile);
});

app.post("/collect", async (req, res) => {
  const { collectorAddress, collectorName, profileId, txHash } = req.body;
  if (!collectorAddress || !collectorName || !profileId || !txHash) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const normalizedCollectorAddress = String(collectorAddress).toLowerCase();

  if (supabase) {
    await supabase.from("collections").insert({
      collector_address: normalizedCollectorAddress,
      collector_name: collectorName,
      profile_id: profileId,
      tx_hash: txHash,
      created_at: new Date().toISOString(),
    });
  } else {
    localState.collections.push({
      collectorAddress: normalizedCollectorAddress,
      collectorName,
      profileId,
      txHash,
      createdAt: Date.now(),
    });
  }

  const stats = await getStats();
  await setStats({
    ...stats,
    collections: stats.collections + 1,
    liveTx: stats.liveTx + 1,
  });

  return res.status(201).json({ ok: true });
});

app.get("/collections/:collectorAddress", async (req, res) => {
  const normalizedCollectorAddress = String(req.params.collectorAddress ?? "").toLowerCase();

  if (!supabase) {
    const rows = localState.collections
      .filter((entry) => String(entry.collectorAddress).toLowerCase() === normalizedCollectorAddress)
      .sort((a, b) => b.createdAt - a.createdAt);
    return res.json(rows);
  }

  const { data } = await supabase
    .from("collections")
    .select("collector_address, collector_name, profile_id, tx_hash, created_at")
    .eq("collector_address", normalizedCollectorAddress)
    .order("created_at", { ascending: false });

  const rows = (data ?? []).map((row) => ({
    collectorAddress: row.collector_address,
    collectorName: row.collector_name,
    profileId: row.profile_id,
    txHash: row.tx_hash,
    createdAt: new Date(row.created_at).getTime(),
  }));

  return res.json(rows);
});

app.get("/leaderboard", async (_req, res) => {
  if (!supabase) {
    const grouped = new Map();
    for (const row of localState.collections) {
      const key = `${row.collectorAddress}:${row.collectorName}`;
      const prev = grouped.get(key) ?? {
        username: row.collectorName,
        address: row.collectorAddress,
        totalCollected: 0,
      };
      prev.totalCollected += 1;
      grouped.set(key, prev);
    }

    const leaderboard = Array.from(grouped.values())
      .sort((a, b) => b.totalCollected - a.totalCollected)
      .slice(0, 20);
    return res.json(leaderboard);
  }

  const { data } = await supabase.rpc("leaderboard_top_collectors", { top_n: 20 });
  return res.json(data ?? []);
});

async function startChainSync() {
  if (!IDENTITY_NFT_ADDRESS || !COLLECTION_REGISTRY_ADDRESS) {
    console.log("Indexer running in local mode: contract addresses not configured.");
    return;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const identity = new Contract(IDENTITY_NFT_ADDRESS, identityAbi, provider);
  const collection = new Contract(COLLECTION_REGISTRY_ADDRESS, collectionAbi, provider);
  let lastTimeoutLogAt = 0;

  setInterval(async () => {
    try {
      const stats = await getStats();
      const currentBlock = await provider.getBlockNumber();

      // Monad public RPC limits eth_getLogs query range; scan in small windows.
      const windowSize = 100;
      const fallbackStart = Math.max(currentBlock - windowSize + 1, 1);
      const idFrom = Math.max(Number(stats.lastIdentityBlock || fallbackStart), 1);
      const colFrom = Math.max(Number(stats.lastCollectionBlock || fallbackStart), 1);

      const idTo = Math.min(idFrom + windowSize - 1, currentBlock);
      const colTo = Math.min(colFrom + windowSize - 1, currentBlock);

      const mintEvents = await identity.queryFilter(identity.filters.IdentityMinted(), idFrom, idTo);
      const collectEvents = await collection.queryFilter(collection.filters.CollectionAdded(), colFrom, colTo);

      if (mintEvents.length === 0 && collectEvents.length === 0) {
        if (idTo === currentBlock && colTo === currentBlock) {
          return;
        }

        await setStats({
          ...stats,
          lastIdentityBlock: idTo + 1,
          lastCollectionBlock: colTo + 1,
        });
        return;
      }

      await setStats({
        ...stats,
        minted: stats.minted + mintEvents.length,
        collections: stats.collections + collectEvents.length,
        liveTx: stats.liveTx + mintEvents.length + collectEvents.length,
        lastIdentityBlock: idTo + 1,
        lastCollectionBlock: colTo + 1,
      });
    } catch (error) {
      const isTimeout =
        (error?.code ?? "") === "TIMEOUT"
        || String(error?.shortMessage ?? "").toLowerCase().includes("timeout");

      if (isTimeout) {
        const now = Date.now();
        if (now - lastTimeoutLogAt > 30_000) {
          console.warn("Indexer poll timeout from RPC, continuing retries...");
          lastTimeoutLogAt = now;
        }
        return;
      }

      console.error("Indexer poll error", error);
    }
  }, 2500);
}

app.listen(PORT, async () => {
  console.log(`Proof Go indexer listening on ${PORT}`);
  if (supabase) {
    if (SUPABASE_SERVICE_ROLE_KEY) {
      console.log("Using Supabase backend mode (service role).");
    } else {
      console.log("Using Supabase backend mode (publishable key fallback).");
    }
  } else {
    console.log("Using local fallback backend mode (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable Supabase).");
  }
  await startChainSync();
});
