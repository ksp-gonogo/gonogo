/**
 * The empty-state sentence both robotics widgets show when they have no joint
 * to draw, and the three separate answers it has to tell apart.
 *
 * It used to be one ternary on `robotics.available`, and it read BACKWARDS in
 * both directions it existed to distinguish:
 *
 * - Breaking Ground installed, craft simply carrying no robotic part:
 *   `robotics.available` is a definite `false`, and the panel said
 *   "Breaking Ground not installed"
 * - Breaking Ground NOT installed: the Uplink goes Unavailable, so
 *   `robotics.available` never emits at all, the reading stays `pending`, and
 *   the panel said "No rotors on this vessel"
 *
 * `available === false` was being read as "the expansion is missing" when it
 * means "this craft has none of them". They are separate facts on separate
 * channels, with separate delay roles: `game.dlc` is ground-side and TrueNow,
 * `robotics.available` is a per-vessel reading behind the delay. So the DLC
 * sentence comes off `game.dlc.breakingGround`, exactly as `DeployedScience`
 * already reads it, and `robotics.available` keeps the craft sentence.
 *
 * The third rung is the one neither answer covers: before either channel has
 * landed, both claims are false, and the honest sentence is that we are still
 * waiting. Picking either of the other two there is how the inversion above
 * stayed invisible, since each wrong sentence looked like the other case.
 *
 * `listObserved` earns the craft sentence as well, and is the stronger evidence
 * for it. `robotics.available` means the vessel carries SOME robotic part, so a
 * craft with hinges and no rotor reports `true`, and the Rotor Tachometer must
 * still be able to say there are no rotors on it. An observed `robotics.servos`
 * that filtered down to nothing says exactly that: we looked, and this craft
 * carries none of this kind.
 */
export function emptyStateText(
  breakingGround: boolean | undefined,
  // `null` as well as absent: `RoboticsAvailable.Available` is a `bool?` and the
  // wire keeps the key, so "the backend could not tell" arrives as a null here.
  // It falls through to the waiting rung on purpose, which is the same rung
  // "nothing has landed yet" takes: neither is a claim about the craft.
  available: boolean | null | undefined,
  listObserved: boolean,
  parts: "rotors" | "robotic parts",
): string {
  if (breakingGround === false) return "Breaking Ground not installed";
  if (listObserved || available === false) {
    return `No ${parts} on this vessel`;
  }
  return `Waiting for the ${parts} list`;
}
