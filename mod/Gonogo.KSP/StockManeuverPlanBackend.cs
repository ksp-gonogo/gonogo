using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Maneuver;

namespace Gonogo.KSP
{
    /// <summary>
    /// The vanilla maneuver-plan provider: KSP's own patched-conic solver,
    /// read off <see cref="ActiveVesselScope.Current"/>.
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
            var vessel = ActiveVesselScope.Current;
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
        ///
        /// <para><b>A kerbal stepping out is neither of those and used to read as
        /// the first.</b> <c>Vessel.MakeInactive</c> runs
        /// <c>DetachPatchedConicsSolver</c> on the craft they left, which SAVES
        /// the plan into <c>flightPlanNode</c> and then destroys the solver. So
        /// a craft with a queued burn reported as unable to hold a plan at all,
        /// for as long as the EVA lasted. The saved plan is read instead: stock
        /// falls back to the same node for the same reason in
        /// <c>Vessel.GetNextManeuverTime</c>, whose second half is exactly this
        /// read.</para>
        /// </summary>
        public IList<Sitrep.Contract.ManeuverNode>? Plan()
        {
            var vessel = ActiveVesselScope.Current;
            var solver = vessel != null ? vessel.patchedConicSolver : null;
            if (solver == null || solver.maneuverNodes == null)
            {
                // Only for the EVA substitution, never as a general fallback: an
                // un-upgraded Tracking Station leaves flightPlanNode empty too,
                // and answering [] there would tell an operator their plan is
                // empty when the truth is that they cannot make one.
                return ActiveVesselScope.SubstitutedForEva ? SavedPlan(vessel) : null;
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

        /// <summary>
        /// The plan KSP saved into <c>flightPlanNode</c> when it took the solver
        /// away, or null when the craft never had one to save.
        ///
        /// <para><c>ManeuverNode.Save</c> writes two values, <c>UT</c> and
        /// <c>dV</c>, so that is honestly all that comes back: no post-burn
        /// patch, because the solver that would have drawn it is gone, and
        /// <see cref="StageBudgets"/> still answers because the craft is loaded,
        /// so the burn window survives.</para>
        ///
        /// <para><b>The ids are the plan's own ordinals rather than registry
        /// ones</b>, because a registry id names a live <c>ManeuverNode</c>
        /// object and there is none here. Nothing can act on them and nothing
        /// pretends otherwise: all three write commands refuse this state before
        /// they ever look at an id (see <see cref="ManeuverWriteAuthority"/>).
        /// They stop being the ids the moment the kerbal boards, which is the
        /// same moment a live solver comes back.</para>
        /// </summary>
        private List<Sitrep.Contract.ManeuverNode>? SavedPlan(Vessel? vessel)
        {
            var saved = vessel != null ? vessel.flightPlanNode : null;
            if (saved == null)
            {
                return null;
            }

            var maneuvers = saved.GetNodes("MANEUVER");
            if (maneuvers == null)
            {
                return null;
            }

            var uts = new List<double>(maneuvers.Length);
            var deltaVs = new List<global::Vector3d>(maneuvers.Length);
            foreach (var node in maneuvers)
            {
                if (node == null || !node.HasValue("UT") || !node.HasValue("dV"))
                {
                    continue;
                }
                if (!double.TryParse(node.GetValue("UT"), out var ut))
                {
                    continue;
                }
                uts.Add(ut);
                deltaVs.Add(KSPUtil.ParseVector3d(node.GetValue("dV")));
            }

            var magnitudes = new List<double>(deltaVs.Count);
            foreach (var dv in deltaVs)
            {
                magnitudes.Add(dv.magnitude);
            }
            var windows = BurnTiming.WindowsFor(StageBudgets(), magnitudes);

            var plan = new List<Sitrep.Contract.ManeuverNode>(uts.Count);
            for (var i = 0; i < uts.Count; i++)
            {
                var dv = deltaVs[i];
                var window = i < windows.Count ? windows[i] : null;
                plan.Add(new Sitrep.Contract.ManeuverNode
                {
                    Id = "saved-" + i.ToString(CultureInfo.InvariantCulture),
                    Ut = uts[i],
                    DvRadial = dv.x,
                    DvNormal = dv.y,
                    DvPrograde = dv.z,
                    DvTotal = dv.magnitude,
                    Frame = ManeuverFrame.RadialNormalPrograde,
                    IgnitionUt = window == null ? (double?)null : uts[i] - window.LeadToHalfSeconds,
                    CutoffUt = window == null
                        ? (double?)null
                        : uts[i] - window.LeadToHalfSeconds + window.TotalSeconds,
                    // Empty rather than absent: the solver that draws a post-burn
                    // conic is the thing KSP took away, so there is genuinely no
                    // patch to report, and that is the same state a just-added
                    // node is in mid-tick.
                    Patches = new List<OrbitPatch>(),
                });
            }

            return plan;
        }

        /// <summary>
        /// Stock does not take a whole plan.
        ///
        /// <para>It can be given nodes one at a time through the maneuver add and
        /// update commands, and those are what a stock plan is edited with. What
        /// it has no way to do is apply a composed plan atomically: there is no
        /// stock operation that swaps one node list for another, so a "send" here
        /// would be a loop that can fail halfway and leave the craft holding half
        /// of two different plans. That is the exact outcome sending a whole plan
        /// exists to prevent, so it is refused rather than approximated.</para>
        /// </summary>
        public CommandResult SendPlan(SendManeuverPlanArgs plan) =>
            CommandResult.Fail(
                CommandErrorCode.ModeUnavailable,
                "Stock has no way to install a composed plan in one step. Its nodes are "
                    + "edited one at a time, and applying a plan as a sequence of edits "
                    + "can leave the craft holding half of two plans.");
    }
}
