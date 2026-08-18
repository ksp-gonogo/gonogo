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

            var plan = new List<Sitrep.Contract.ManeuverNode>(solver.maneuverNodes.Count);
            foreach (var node in solver.maneuverNodes)
            {
                if (node == null)
                {
                    continue;
                }

                var dv = node.DeltaV;
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
                    // IgnitionUt/CutoffUt deliberately absent: stock supplies no
                    // per-node burn duration, and substituting one from Ut would
                    // assert a convention rather than report a fact. See
                    // ManeuverNode.IgnitionUt.
                });
            }

            return plan;
        }
    }
}
