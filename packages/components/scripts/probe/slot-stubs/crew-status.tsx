import { plantSlot } from "./stub";

const OUTLINE = "1px dashed var(--color-status-info-fg)";

plantSlot("crew-status.row-badges", ({ crewName }) => (
  <span
    data-slot-stub="crew-status.row-badges"
    style={{
      border: OUTLINE,
      borderRadius: 4,
      padding: "0 6px",
      color: "var(--color-status-info-fg)",
      fontSize: 11,
      whiteSpace: "nowrap",
    }}
  >
    row-badges: {crewName.split(" ")[0]}
  </span>
));

/** Fills the framed avatar square the host reserves, with the kerbal's initials. */
plantSlot("crew-status.avatar", ({ crewName }) => (
  <div
    data-slot-stub="crew-status.avatar"
    style={{
      boxSizing: "border-box",
      width: "100%",
      height: "100%",
      border: OUTLINE,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--color-status-info-fg)",
      fontSize: 10,
    }}
  >
    <strong style={{ fontSize: 14 }}>
      {crewName.slice(0, 2).toUpperCase()}
    </strong>
    avatar
  </div>
));

plantSlot("crew-status.summary");
