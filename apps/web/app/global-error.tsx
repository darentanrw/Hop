"use client";

import "./globals.css";
import { useEffect } from "react";

const CHUNK_RELOAD_KEY = "hop:chunk-load-reloaded";
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

function isChunkLoadError(error: Error & { digest?: string }) {
  const message = `${error.message} ${error.digest ?? ""}`.toLowerCase();
  return (
    message.includes("chunkloaderror") ||
    message.includes("failed to load chunk") ||
    message.includes("loading chunk") ||
    message.includes("failed to fetch dynamically imported module")
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const lastReloadAt =
    typeof window === "undefined"
      ? 0
      : Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0");
  const reloading =
    typeof window !== "undefined" &&
    isChunkLoadError(error) &&
    Date.now() - lastReloadAt >= CHUNK_RELOAD_COOLDOWN_MS;

  useEffect(() => {
    if (!reloading) return;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }, [reloading]);

  return (
    <html lang="en">
      <body>
        <div className="auth-page">
          <div className="auth-body">
            <div className="card stack" style={{ textAlign: "center", padding: 32 }}>
              <h2>{reloading ? "Updating Hop" : "Something went wrong"}</h2>
              <p className="text-muted">
                {reloading
                  ? "A new version was just deployed. Refreshing now..."
                  : "An unexpected error occurred. Please try again."}
              </p>
              {!reloading && (
                <button type="button" className="btn btn-primary btn-block" onClick={() => reset()}>
                  Try again
                </button>
              )}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
