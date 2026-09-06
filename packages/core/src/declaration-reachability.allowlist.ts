/**
 * Data for the declaration-reachability ratchet
 * (`declaration-reachability.test.ts`). Pure data module, no test logic, so the
 * shrink-only check can load this file's content at an arbitrary git ref without
 * pulling in vitest or the scan machinery. Same split-module shape as
 * `uplink-isolation.allowlist.ts`.
 *
 * A DECLARATION NOBODY READS IS NOT A FEATURE. `rp1.tooling` was folded as the
 * mod half only: a Topic, two commands and 159 lines of payload contract with no
 * client consumer at all. The isolation ratchets passed, the extraction probe
 * passed, the docs gate passed, and the queue recorded it built for days when it
 * was built only on the wire. Every gate in the tree asked whether what exists is
 * CORRECT; none asked whether it is REACHED.
 *
 * Seeded 2026-09-02 from a full scan: 101 declarations (44 Topics, 57 commands)
 * across 11 Uplink clients, 20 of them unreached. Every entry here is DEBT and
 * the list is SHRINK-ONLY. Fix one by writing the widget or control that reads
 * it, then delete the line. Never add one: a new declaration lands with its
 * consumer or it does not land.
 *
 * WHAT IS NOT HERE, and why the count is not larger. Two exclusions are correct
 * rather than generous:
 *
 *   • `*.available` Domain presence gates. `AugmentAvailabilityFeeder` reads
 *     them generically through a computed id, so none appears as a literal
 *     anywhere. Listing them would be false, not lenient. See
 *     `hasGenericConsumer` for the bound.
 *   • Re-exports. `index.ts` re-exports every Topic constant its Uplink
 *     declares, and the scan skips `ExportDeclaration` so plumbing is not
 *     mistaken for use.
 *
 * THE SHAPE OF THE DEBT is worth reading before clearing it. Seventeen of the
 * twenty as seeded were commands and three were Topics, which says the gap is
 * overwhelmingly on the CONTROL side: the mod will accept instructions the
 * dashboard has no button for.
 *
 * CLEARED SO FAR, 11 of the 20, all on 2026-09-02.
 *
 * Eight were cleared by BUILDING the surface that reaches them; three by
 * DELETING them, which is the other honest answer and the one to reach for when
 * the mechanism behind a command is already gone. `kos.dispatchNow`, `kos.exec`
 * and `kos.reEnable` were the dispatch controls of the centralised kOS script
 * registry: `registerKosScript`, `getKosScripts`, `shared/scriptRegistry.ts`,
 * `KosComputeManager`, `useKosScriptStatus` and the feed widgets that consumed
 * them have no definitions left anywhere in the tree, nothing ships a
 * `0:/widget_scripts/<id>.ks` for `kos.exec` to RUNPATH, and the breaker
 * `kos.reEnable` re-armed was never built (its handler was a no-op ack).
 * Wiring them would have meant rebuilding a subsystem that was deliberately
 * removed. `kos.run` is the surviving way to run anything on a CPU.
 *
 * The three career spends CLAUDE.md's funds rule names by hand,
 * `rp1.tech.research`, `rp1.facility.upgrade` and `rp1.strategy.activate`. Each
 * landed in the surface the operator was already looking at rather than in one
 * RP-1 screen: research in `StartResearch` on the tech tree, the facility tier
 * in `FacilityUpgrades` on the Space Center, and the Program accept in
 * `ProgramDetail` on the Administration building. Note the LEADER half of
 * `rp1.strategy.activate` has no control: RP-1 publishes no availability fact
 * for a leader and the command asks RP-1's own `IsUnlocked` predicate for none,
 * so a picker would offer appointments RP-1's own building forbids.
 *
 * And the whole Principia planning write path: `principia.plan.create`,
 * `.delete`, `.duplicate`, `.horizon` and `.send`. What that exercise taught,
 * for whoever takes the next entry: five unreached commands were not five
 * missing buttons. Create, duplicate, delete and send are the transitions of ONE
 * state machine over `planExists` and `planCount`, and the mod already refuses
 * the illegal one by name, so the surface that reaches them is a single section
 * that renders the slot state and offers whichever transition it permits.
 * `horizon` went somewhere else entirely, next to the shortfall it is the remedy
 * for. A debt entry names a command; it does not tell you the surface, and
 * grouping by wire prefix would have got this one wrong.
 */

/**
 * Declarations with no client consumer, keyed `<uplink>: <kind> <id>` and
 * grouped by Uplink so a failure names the owner.
 */
export const UNREACHED_DECLARATION_DEBT: Record<string, readonly string[]> = {
  GonogoKerbalismUplink: [
    /*
     * Kerbalism's feature-flags payload. Nothing branches on it; the widgets
     * gate on `kerbalism.available` instead, which is coarser.
     */
    "topic kerbalism.features",
  ],
  GonogoRealAntennasUplink: [
    /*
     * Declared beside `comms.dataRate` and `comms.linkMargin`, which ARE read.
     * The odd one out of the three, so most likely an omission rather than a
     * decision.
     */
    "topic comms.linkQuality",
  ],
  GonogoRp1Uplink: ["topic rp1.careerEvents"],
};

/**
 * Floors that make a silent zero fail instead of pass.
 *
 * A reachability gate that resolves nothing reports every declaration reached,
 * which converts exactly the failure it exists to catch into a green. These are
 * deliberately close to the live measurement rather than round numbers: a floor
 * of 300 against a live count of 882 lets two thirds of a walk stop resolving
 * before it bites, which is how the AsyncAPI unit check came to have a floor it
 * cannot reach.
 *
 * Measured 2026-09-02, after the three dead kOS dispatch commands were deleted:
 * 1,231 corpus files, 85 parsed, 94 declarations across 8 clients, 9 unreached.
 * The seeding note above records 1,253 / 89 / 101 / 11 from earlier the same
 * day; the walk itself has not changed, the tree has (an Uplink departed and
 * took its declarations with it, see `uplinksWithDeclarations`). Raise these
 * when the tree grows; a drop below one is a broken walk, not a smaller repo.
 */
export const SCAN_FLOORS = {
  /** Non-test, non-generated `.ts`/`.tsx` under `mod/` and `packages/`. */
  corpusFiles: 1000,
  /** Corpus files that mentioned a candidate token and were parsed. */
  filesParsed: 60,
  /** Topics plus commands found across every Uplink client. */
  declarations: 85,
  /**
   * Uplink clients contributing at least one declaration. Was 9 when this gate
   * was written; two Uplinks have since departed this repo and taken their
   * declarations with them, one on 2026-09-02 and RealFuels after it. Lowered
   * each time to the count the gate itself measured, not to a number chosen to
   * make it pass: raise it again the moment an Uplink arrives, because the
   * point of this floor is to catch a per-client walk that has started failing
   * silently.
   */
  uplinksWithDeclarations: 7,
} as const;
