import { Contract, JsonRpcProvider, Wallet, parseEther, parseUnits } from "ethers";
import {
  COLLECTION_FEE_MON,
  COLLECTION_FEE_RECIPIENT,
  COLLECTION_REGISTRY_ADDRESS,
  collectionAbi,
  IDENTITY_NFT_ADDRESS,
  identityAbi,
  MONAD_TESTNET,
} from "@/lib/contracts";

const RPC_URL = process.env.MONAD_RPC_URL ?? MONAD_TESTNET.rpcUrl;

function getSigner() {
  const privateKey = (process.env.MINTER_PRIVATE_KEY ?? "").trim();
  if (!privateKey) {
    return null;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    return null;
  }

  const provider = new JsonRpcProvider(RPC_URL, MONAD_TESTNET.chainId);
  try {
    return new Wallet(privateKey, provider);
  } catch {
    return null;
  }
}

function randomHash(prefix: string) {
  const nonce = Math.random().toString(16).slice(2);
  return `0x${prefix}${nonce.padEnd(64 - prefix.length, "0")}`;
}

export async function mintIdentityOnMonad(userAddress: string, metadataUri: string) {
  const signer = getSigner();
  if (!signer || !IDENTITY_NFT_ADDRESS) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      tokenId: Date.now().toString(),
      txHash: randomHash("a11ce"),
      simulated: true,
    };
  }

  const contract = new Contract(IDENTITY_NFT_ADDRESS, identityAbi, signer);
  const tx = await contract.mintIdentity(userAddress, metadataUri, {
    gasPrice: parseUnits("1", "gwei"),
  });
  const receipt = await tx.wait();

  const tokenId = receipt?.logs?.[0]?.topics?.[1]
    ? BigInt(receipt.logs[0].topics[1]).toString()
    : Date.now().toString();

  return {
    tokenId,
    txHash: tx.hash as string,
    simulated: false,
  };
}

export async function collectOnMonad(collectorAddress: string, profileId: string) {
  const signer = getSigner();
  if (!signer || !COLLECTION_REGISTRY_ADDRESS) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { txHash: randomHash("c011ec7"), simulated: true };
  }

  const contract = new Contract(COLLECTION_REGISTRY_ADDRESS, collectionAbi, signer);
  const tx = await contract.addToCollection(collectorAddress, BigInt(profileId), {
    gasPrice: parseUnits("1", "gwei"),
  });
  await tx.wait();
  return { txHash: tx.hash as string, simulated: false };
}

export async function chargeCollectionFeeAssistedOnMonad() {
  const signer = getSigner();
  if (!signer) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { txHash: randomHash("feeas57"), simulated: true };
  }

  const tx = await signer.sendTransaction({
    to: COLLECTION_FEE_RECIPIENT,
    value: parseEther(COLLECTION_FEE_MON.toFixed(6)),
    gasPrice: parseUnits("1", "gwei"),
  });

  await tx.wait();
  return { txHash: tx.hash as string, simulated: false };
}
