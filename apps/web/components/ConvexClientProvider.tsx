"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

type WindowWithEnv = Window & { env?: { NEXT_PUBLIC_CONVEX_URL?: string } };

let convexClient: ConvexReactClient | null = null;

function getConvexUrl() {
  if (typeof window !== "undefined") {
    return (
      (window as WindowWithEnv).env?.NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL
    );
  }
  return process.env.NEXT_PUBLIC_CONVEX_URL;
}

function getConvexClient(url: string) {
  if (!convexClient) {
    convexClient = new ConvexReactClient(url);
  }
  return convexClient;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = getConvexUrl();

  if (!convexUrl) {
    console.error("NEXT_PUBLIC_CONVEX_URL is missing. Unable to initialize Hop.");
    return (
      <div className="auth-page">
        <div className="auth-body">
          <div className="card stack" style={{ textAlign: "center", padding: 32 }}>
            <h2>Something went wrong</h2>
            <p className="text-muted">
              An error has occurred while starting Hop. Please refresh and try again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ConvexAuthNextjsProvider client={getConvexClient(convexUrl)}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
