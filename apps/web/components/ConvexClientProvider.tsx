"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

type WindowWithEnv = Window & { env?: { NEXT_PUBLIC_CONVEX_URL?: string } };

const convex = new ConvexReactClient(
  typeof window !== "undefined"
    ? (window as WindowWithEnv).env?.NEXT_PUBLIC_CONVEX_URL ||
        process.env.NEXT_PUBLIC_CONVEX_URL ||
        "https://placeholder.convex.cloud"
    : "https://placeholder.convex.cloud",
);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
