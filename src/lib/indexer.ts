const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4001";
const INDEXER_TIMEOUT_MS = 4500;

async function postIndexer(path: string, payload: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);

  try {
    const res = await fetch(`${INDEXER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });

    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveProfile(profile: Record<string, unknown>) {
  return postIndexer("/profiles", profile);
}

export async function saveCollection(payload: {
  collectorAddress: string;
  collectorName: string;
  profileId: string;
  txHash: string;
  feeTxHash?: string;
}) {
  return postIndexer("/collect", payload);
}
