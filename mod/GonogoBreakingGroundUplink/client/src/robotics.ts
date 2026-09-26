/**
 * The empty-state sentence both robotics widgets show when they have no joint to draw.
 * The DLC answer comes off `game.dlc.breakingGround`; the craft answer off a definite `robotics.available === false` or a list that has been read (observed or stale) and filtered to nothing; anything else is still waiting.
 */
export function emptyStateText(
  breakingGround: boolean | undefined,
  // `null` is "the backend could not tell", which waits rather than making a claim about the craft.
  available: boolean | null | undefined,
  listRead: boolean,
  parts: "rotors" | "robotic parts",
): string {
  if (breakingGround === false) return "Breaking Ground not installed";
  if (listRead || available === false) {
    return `No ${parts} on this vessel`;
  }
  return `Waiting for the ${parts} list`;
}
