// mod/GonogoKerbalismUplink/KerbalismRepairScope.cs
// Which KERBALISM.Reliability modules a repair request acts on, and what it
// costs, carved out of KerbalismReflection.AttemptRepair so a headless test can
// enter it: the walk around it reaches a live Part, Vessel and ProtoCrewMember
// and cannot run outside a scene, but the RULE takes two booleans.
//
// Read off Kerbalism's own Reliability.Repair() KSPEvent (Kerbalism.dll,
// decompiled 2026-09-03), which is one event handling two conditions:
//
//     if (!crewSpecs.Check(activeVessel)) { ...; return; }
//     needMaintenance = false;                     // ALWAYS, and free
//     ...
//     if (broken) { ConsumeRepairKits(...); broken = false; ... }
//
// so a service-due part is cleared by the same call as a malfunction and costs
// nothing, and only the broken branch charges kits.
namespace Gonogo.KerbalismUplink
{
    public static class KerbalismRepairScope
    {
        /// <summary>
        /// Whether Kerbalism's <c>Repair()</c> would do anything to a module in
        /// this state.
        ///
        /// <para>This used to be <c>broken</c> alone, which is why every
        /// <c>service-due</c> row on the fleet-reliability panel offered a
        /// "Service" button that could not work: a part needing maintenance is
        /// not broken, so the walk collected nothing and the command came back
        /// <c>no-such-part</c> every time. The client had grown the verb, the
        /// backend had never grown the scope, and the refusal was invisible
        /// because refusals were arriving as successes.</para>
        /// </summary>
        public static bool IsActionable(bool broken, bool needsMaintenance) =>
            broken || needsMaintenance;

        /// <summary>
        /// How many repair kits the attempt consumes: Kerbalism charges only in
        /// the broken branch, two for a critical failure and one otherwise, and
        /// a service costs none.
        ///
        /// <para>Delegates the two-for-critical arithmetic to
        /// <see cref="KerbalismReliabilityMap.KitsForRepair"/> rather than
        /// repeating it, so the number CHARGED here cannot drift from the number
        /// STATED on <c>ReliabilityPartEntry.RepairCost</c>.</para>
        /// </summary>
        public static int KitsFor(bool broken, bool critical) =>
            broken ? KerbalismReliabilityMap.KitsForRepair(critical) : 0;

        /// <summary>
        /// How many of the kits come out of the kerbal's own inventory, and how
        /// many have to be fetched from a part store.
        ///
        /// <para><b>Both halves have to be REMOVED by us.</b> The repair invoke is
        /// wrapped in a suspension of Kerbalism's <c>requireRepairKits</c>
        /// preference, because its own <c>ConsumeRepairKits</c> reads kits only
        /// from an EVA kerbal's inventory when the active vessel IS that kerbal,
        /// which a remote repair never satisfies. With the preference off,
        /// <c>ConsumeRepairKits</c> returns true immediately and removes NOTHING,
        /// so anything we do not take ourselves is never charged at all.</para>
        ///
        /// <para>That is what made the common case free: the carried branch
        /// returned "enough, carry on" without removing them, and the store branch
        /// fetched only the SHORTFALL, leaving whatever the kerbal already held
        /// uncharged. The outcome reported <c>KitsUsed</c> either way, so the
        /// console said two kits were spent while the inventory kept both.</para>
        /// </summary>
        public static int FromCarried(int needed, int carried) =>
            carried < needed ? carried : needed;

        /// <summary>What the carried kits do not cover, and must come from a store.</summary>
        public static int Shortfall(int needed, int carried)
        {
            var short_ = needed - carried;
            return short_ > 0 ? short_ : 0;
        }

        /// <summary>
        /// Whether the attempt actually cleared what it was asked to clear,
        /// OBSERVED from the module's own flags afterwards rather than predicted.
        ///
        /// <para>Kerbalism's crew check gates both halves of <c>Repair()</c> and
        /// returns before either flag moves, so a flag that did not move is a
        /// crew that did not qualify. Re-implementing <c>CrewSpecs</c> here would
        /// be a second authority that can disagree with the one that acts.</para>
        /// </summary>
        public static bool Cleared(bool wasBroken, bool brokenAfter, bool needsMaintenanceAfter) =>
            wasBroken ? !brokenAfter : !needsMaintenanceAfter;
    }
}
