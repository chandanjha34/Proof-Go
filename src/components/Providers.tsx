"use client";

import { useEffect, useRef } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth";
import { MONAD_TESTNET } from "@/lib/contracts";
import { ensureMonadEmbeddedWalletNetwork } from "@/lib/walletFee";

const monadPrivyChain = {
  id: MONAD_TESTNET.chainId,
  name: MONAD_TESTNET.name,
  network: "monad-testnet",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: [MONAD_TESTNET.rpcUrl],
    },
    public: {
      http: [MONAD_TESTNET.rpcUrl],
    },
  },
};

function EnsureMonadTestnetDefault() {
  const { wallets } = useWallets();
  const lastSyncedAddressRef = useRef("");
  const inFlightRef = useRef(false);

  useEffect(() => {
    const wallet = wallets[0];
    const address = wallet?.address?.toLowerCase() ?? "";
    if (!wallet || !address || inFlightRef.current) {
      return;
    }

    if (lastSyncedAddressRef.current === address) {
      return;
    }

    inFlightRef.current = true;
    ensureMonadEmbeddedWalletNetwork(wallet)
      .catch(() => {
        // Ignore auto-sync failures; fee flow and wallet panel provide actionable prompts.
      })
      .finally(() => {
        lastSyncedAddressRef.current = address;
        inFlightRef.current = false;
      });
  }, [wallets]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        supportedChains: [monadPrivyChain],
        defaultChain: monadPrivyChain,
        appearance: {
          theme: "light",
          accentColor: "#00b96b",
          showWalletLoginFirst: false,
        },
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "all-users",
          },
        },
      }}
    >
      <EnsureMonadTestnetDefault />
      {children}
    </PrivyProvider>
  );
}
