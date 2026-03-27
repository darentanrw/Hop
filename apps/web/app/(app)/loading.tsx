function LoadingBar({ width, height = 14 }: { width: number | string; height?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: 999,
        background: "var(--surface-hover)",
        animation: "softPulse 1.6s ease-in-out infinite",
      }}
    />
  );
}

export default function AppLoading() {
  return (
    <div className="stack-lg" aria-busy="true" aria-live="polite">
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        Loading your Hop dashboard and ride details.
      </span>
      <div className="stack-sm" style={{ paddingTop: 4 }}>
        <LoadingBar width={180} height={28} />
        <LoadingBar width="68%" height={14} />
      </div>

      <div className="card stack-sm">
        <LoadingBar width="34%" height={12} />
        <LoadingBar width="78%" height={18} />
        <LoadingBar width="62%" height={14} />
      </div>

      <div className="card stack-sm">
        <LoadingBar width="28%" height={12} />
        <LoadingBar width="100%" height={72} />
        <LoadingBar width="100%" height={72} />
      </div>

      <div className="card stack-sm">
        <LoadingBar width="42%" height={12} />
        <LoadingBar width="100%" height={48} />
      </div>
    </div>
  );
}
