using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Maneuver;

namespace Gonogo.KSP
{
    /// <summary>
    /// The vanilla maneuver-plan provider: KSP's own patched-conic solver,
    /// read off <c>FlightGlobals.ActiveVessel</c>.
    ///
    /// <para>Lives here rather than in <c>Sitrep.Host</c> because it touches
    /// live KSP types, exactly as <c>StockActionGroupsBackend</c> and
    /// <c>CommNetBackend</c> do for their own capabilities.</para>
    /// </summary>
    internal sealed class StockManeuverPlanBackend : IManeuverPlanSource
    {
        private readonly ReferenceIdRegistry<global::ManeuverNode> _ids;

        /// <param name="ids">
        /// Shared with <c>KspVesselActuator</c>, which is what makes a burn's
        /// id resolve back to a live node in <c>vessel.maneuver.update</c>/
        /// <c>.remove</c>. See <see cref="ReferenceIdRegistry{T}"/>.
        /// </param>
        internal StockManeuverPlanBackend(ReferenceIdRegistry<global::ManeuverNode> ids)
        {
            _ids = ids;
        }

        public string ProviderId => "stock-patched-conic";

        /// <summary>
        /// Stock's own vacuum stage simulation, or an empty list when it has
        /// nothing to say. Vacuum figures because a queued burn is an orbital
        /// one; <c>startMass</c>/<c>endMass</c> come along because BurnTiming
        /// needs the stage's own mass ratio, and taking it from the same
        /// <c>DeltaVStageInfo</c> the delta-v came from is what stops the two
        /// disagreeing.
        ///
        /// <para>Empty when the sim is dormant or the craft is unloaded, which
        /// is not an error: <c>VesselDeltaV.CheckDirtyAndRun</c> early-returns
        /// on an unloaded vessel, so an unloaded craft's burns honestly have no
        /// duration. Unlike the stage-delta-v capture, this does NOT wake the
        /// sim: that capture already asks, and asking twice per tick from two
        /// places is how one of them ends up fighting the other.</para>
        /// </summary>
        private static List<BurnTiming.StageBudget> StageBudgets()
        {
            var budgets = new List<BurnTiming.StageBudget>();
            var vessel = FlightGlobals.ActiveVessel;
            var dv = vessel != null ? vessel.VesselDeltaV : null;
            if (dv == null || !dv.IsReady)
            {
                return budgets;
            }

            var stages = dv.OperatingStageInfo;
            if (stages == null)
            {
                return budgets;
            }

            foreach (var stage in stages)
            {
                if (stage == null)
                {
                    continue;
                }
                budgets.Add(new BurnTiming.StageBudget
                {
                    DeltaV = stage.deltaVinVac,
                    BurnTime = stage.stageBurnTime,
                    StartMass = stage.startMass,
                    EndMass = stage.endMass,
                });
            }

            return budgets;
        }

        /// <summary>
        /// Null when there is no solver, which is a real state stock reaches on
        /// its own: an un-upgraded Tracking Station leaves
        /// <c>patchedConicSolver</c> null, so the craft cannot hold a plan
        /// rather than merely not holding one. An empty list is the ordinary
        /// "solver present, nothing queued".
        /// </summary>
        public IList<Sitrep.Contract.ManeuverNode>? Plan()
        {
            var vessel = FlightGlobals.ActiveVessel;
            var solver = vessel != null ? vessel.patchedConicSolver : null;
            if (solver == null || solver.maneuverNodes == null)
            {
                return null;
            }

            var live = new List<global::ManeuverNode>();
            foreach (var node in solver.maneuverNodes)
            {
                if (node != null)
                {
                    live.Add(node);
                }
            }

            // The burns in the order they will be flown, so each one's duration
            // reflects what the ones before it spent. Null windows throughout
            // when the craft has no stage data, which is the unloaded case.
            var deltaVs = new List<double>(live.Count);
            foreach (var node in live)
            {
                deltaVs.Add(node.DeltaV.magnitude);
            }
            var windows = BurnTiming.WindowsFor(StageBudgets(), deltaVs);

            var plan = new List<Sitrep.Contract.ManeuverNode>(live.Count);
            for (var i = 0; i < live.Count; i++)
            {
                var node = live[i];
                var dv = node.DeltaV;
                var window = i < windows.Count ? windows[i] : null;
                plan.Add(new Sitrep.Contract.ManeuverNode
                {
                    Id = _ids.GetOrAssign(node),
                    Ut = node.UT,
                    DvRadial = dv.x,
                    DvNormal = dv.y,
                    DvPrograde = dv.z,
                    DvTotal = dv.magnitude,
                    // Stock's own node basis, stated rather than assumed.
                    Frame = ManeuverFrame.RadialNormalPrograde,
                    // Absent together whenever there is no burn-duration model,
                    // never substituted from Ut. Ut is the HALF-delta-v instant,
                    // so ignition sits a lead ahead of it rather than half a
                    // duration: see BurnTiming for why those differ.
                    IgnitionUt = window == null ? (double?)null : node.UT - window.LeadToHalfSeconds,
                    CutoffUt = window == null
                        ? (double?)null
                        : node.UT - window.LeadToHalfSeconds + window.TotalSeconds,
                    // Element 0 is KSP's own post-burn conic (nextPatch), which
                    // is the planner's statement of what the burn produces, not
                    // ours. That distinction is the whole point of reading it:
                    // recomputing the post-burn orbit from the node's delta-v
                    // would compare the vessel against a two-body model we
                    // wrote, and would be wrong by construction for a planner
                    // that integrates.
                    //
                    // Empty while the solver has not produced a patch yet (a
                    // just-added node mid-tick), which ManeuverNode.Patches
                    // documents as a legitimate state rather than a malformed
                    // node.
                    Patches = KspHost.WalkPatchChain(node.nextPatch),
                });
            }

            return plan;
        }
    }
}
