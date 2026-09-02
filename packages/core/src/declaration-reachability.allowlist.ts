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
 * twenty are commands and three are Topics, which says the gap is overwhelmingly
 * on the CONTROL side: the mod will accept instructions the dashboard has no
 * button for. `principia.plan.*` is a whole five-command planning surface with
 * no caller, and `rp1.tech.research`, `rp1.facility.upgrade` and
 * `rp1.strategy.activate` are three of the four career spends CLAUDE.md's funds
 * rule names by hand.
 */

/**
 * Declarations with no client consumer, keyed `<uplink>: <kind> <id>` and
 * grouped by Uplink so a failure names the owner.
 */
export const UNREACHED_DECLARATION_DEBT: Record<string, readonly string[]> = {
  GonogoKerbalismUplink: [
    // Kerbalism's feature-flags payload. Nothing branches on it; the widgets
    // gate on `kerbalism.available` instead, which is coarser.
    "topic kerbalism.features",
  ],
  GonogoKosUplink: [
    // The dispatch-control trio behind the centralised script registry. The
    // registry itself was removed (`registerKosScript`, `useKosScriptStatus`
    // and `KosDataSource` have no definitions left), and these three outlived
    // it: nothing can pause, re-enable or force a run.
    "command kos.dispatchNow",
    "command kos.exec",
    "command kos.reEnable",
  ],
  GonogoPrincipiaUplink: [
    // A complete manoeuvre-planning control surface with no caller of any kind.
    // The read side is wired; every write is unreachable from the dashboard.
    "command principia.plan.create",
    "command principia.plan.delete",
    "command principia.plan.duplicate",
    "command principia.plan.horizon",
    "command principia.plan.send",
  ],
  GonogoRealAntennasUplink: [
    // Declared beside `comms.dataRate` and `comms.linkMargin`, which ARE read.
    // The odd one out of the three, so most likely an omission rather than a
    // decision.
    "topic comms.linkQuality",
  ],
  GonogoRp1Uplink: [
    "command rp1.complex.modify",
    // Three of the four career spends CLAUDE.md's funds rule names by hand
    // (upgrade a facility, unlock a tech, accept an advance). The mod will
    // perform them and no widget can ask.
    "command rp1.facility.upgrade",
    "command rp1.fundTarget.cancel",
    "command rp1.fundTarget.set",
    "command rp1.hireTarget.cancel",
    "command rp1.hireTarget.set",
    "command rp1.strategy.activate",
    "command rp1.tech.research",
    // The surviving half of the `rp1.tooling` fold that prompted this gate:
    // `rp1.tooling.toolAll` has since been wired to `VehicleAssembly/Tooling.tsx`
    // and `.refit` has not.
    "command rp1.tooling.refit",
    "topic rp1.careerEvents",
  ],
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
 * Live on 2026-09-02: 1,253 corpus files, 89 parsed, 101 declarations across 11
 * clients. Raise these when the tree grows; a drop below one is a broken walk,
 * not a smaller repo.
 */
export const SCAN_FLOORS = {
  /** Non-test, non-generated `.ts`/`.tsx` under `mod/` and `packages/`. */
  corpusFiles: 1000,
  /** Corpus files that mentioned a candidate token and were parsed. */
  filesParsed: 60,
  /** Topics plus commands found across every Uplink client. */
  declarations: 85,
  /** Uplink clients contributing at least one declaration. */
  uplinksWithDeclarations: 9,
} as const;
