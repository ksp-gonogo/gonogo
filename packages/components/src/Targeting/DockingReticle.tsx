/** Fixed crosshair through the HUD centre: two hairline rules, no pseudo-elements. */
export function Crosshair() {
  const line = {
    position: "absolute" as const,
    background: "rgba(0, 255, 136, 0.75)",
  };
  return (
    <div
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <div
        style={{
          ...line,
          left: 0,
          right: 0,
          top: "50%",
          height: 1,
          transform: "translateY(-0.5px)",
        }}
      />
      <div
        style={{
          ...line,
          top: 0,
          bottom: 0,
          left: "50%",
          width: 1,
          transform: "translateX(-0.5px)",
        }}
      />
    </div>
  );
}

/** Target reticle drifting in proportion to the docking alignment angles. */
export function Reticle({
  aligned,
  left,
  top,
}: {
  aligned: boolean;
  left: string;
  top: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        width: 22,
        height: 22,
        border: `2px solid ${aligned ? "var(--color-accent-fg)" : "var(--color-status-warning-bg)"}`,
        borderRadius: "var(--radius-circle)",
        transform: "translate(-50%, -50%)",
        // An instant telemetry chase for left/top; only the border colour eases.
        transition:
          "left var(--duration-instant) var(--ease-linear), top var(--duration-instant) var(--ease-linear), border-color var(--duration-base) var(--ease-linear)",
        // Ring only, so the crosshair stays visible.
        boxShadow: `0 0 6px ${aligned ? "rgba(0,255,136,0.6)" : "rgba(255,152,0,0.5)"}`,
        left,
        top,
      }}
    />
  );
}

// Derived tick geometry, off the spacing scale: a hairline rule and half-length translates centring the tick.
export function HorizTick({ left }: { left: string }) {
  return (
    <div
      style={{
        position: "absolute",
        background: "rgba(0, 255, 136, 0.35)",
        pointerEvents: "none",
        top: "50%",
        width: 1,
        height: 8,
        transform: "translateY(-4px)",
        left,
      }}
    />
  );
}

export function VertTick({ top }: { top: string }) {
  return (
    <div
      style={{
        position: "absolute",
        background: "rgba(0, 255, 136, 0.35)",
        pointerEvents: "none",
        left: "50%",
        height: 1,
        width: 8,
        transform: "translateX(-4px)",
        top,
      }}
    />
  );
}
