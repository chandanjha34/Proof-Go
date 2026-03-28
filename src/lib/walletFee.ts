import { parseEther } from "ethers";
import {
  COLLECTION_FEE_MON,
  COLLECTION_FEE_RECIPIENT,
  MONAD_TESTNET,
} from "@/lib/contracts";
import { getTxExplorerUrl } from "@/lib/explorer";

type PrivyWalletLike = {
  address?: string;
  getEthereumProvider?: () => Promise<unknown>;
};

type Eip1193Like = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

export async function ensureMonadEmbeddedWalletNetwork(wallet: PrivyWalletLike) {
  void wallet;
}

export async function payCollectionFee(wallet: PrivyWalletLike) {
  if (!wallet?.getEthereumProvider) {
    throw new Error("Embedded wallet provider is unavailable.");
  }

  const eip1193 = (await wallet.getEthereumProvider()) as Eip1193Like;
  const chainIdHex = toHexChainId(MONAD_TESTNET.chainId);
  const valueHex = `0x${parseEther(COLLECTION_FEE_MON.toFixed(6)).toString(16)}`;

  let fromAddress = wallet.address ?? "";
  if (!fromAddress) {
    const accounts = (await eip1193.request({ method: "eth_accounts" })) as string[];
    fromAddress = accounts?.[0] ?? "";
  }

  if (!fromAddress) {
    throw new Error("Embedded wallet address unavailable. Please re-login and retry.");
  }

  let txHash = "";
  try {
    txHash = (await eip1193.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: fromAddress,
          to: COLLECTION_FEE_RECIPIENT,
          value: valueHex,
          chainId: chainIdHex,
        },
      ],
    })) as string;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.toLowerCase().includes("not supported")
      || message.toLowerCase().includes("unsupported")
      || message.toLowerCase().includes("chain id")
      || message.toLowerCase().includes("unsupported chain")
    ) {
      return {
        txHash: "",
        amountMon: COLLECTION_FEE_MON,
        to: COLLECTION_FEE_RECIPIENT,
        explorerUrl: "",
        assistedMode: true,
      };
    }

    throw new Error(`Fee transfer rejected: ${message}`);
  }

  return {
    txHash,
    amountMon: COLLECTION_FEE_MON,
    to: COLLECTION_FEE_RECIPIENT,
    explorerUrl: getTxExplorerUrl(txHash),
    assistedMode: false,
  };
}
