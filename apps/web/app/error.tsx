"use client";

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

function shouldReloadForChunkError(error: Error & { digest?: string }) {
  if (typeof window === "undefined") return false;
  if (!isChunkLoadError(error)) return false;
  const lastReloadAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0");
  if (Date.now() - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) return false;
  return true;
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!shouldReloadForChunkError(error)) return;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }, [error]);

  const reloading = shouldReloadForChunkError(error);

  return (
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
  );
}
