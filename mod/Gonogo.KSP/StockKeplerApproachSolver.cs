using Sitrep.Contract;
using Sitrep.Host.Targeting;

namespace Gonogo.KSP
{
    /// <summary>
    /// The stock two-body closest-approach backend — the always-present vanilla
    /// for the <c>targetApproach</c> capability (see
    /// <see cref="TargetApproachElection"/>). Reads the live active vessel + its
    /// current target and uses KSP's OWN Kepler solver
    /// (<c>Orbit.NextCloseApproachTime</c>) so the value matches exactly what
    /// the stock map view draws. A Principia backend, elected over this when
    /// Principia is loaded, replaces the Kepler solve with an n-body one; this
    /// backend is what runs on every stock install.
    ///
    /// <para>Main-thread only (reads live KSP) — see
    /// <see cref="ITargetApproachSolver"/>'s threading note.</para>
    /// </summary>
    public sealed class StockKeplerApproachSolver : ITargetApproachSolver
    {
        public string BackendId => "stock-kepler";

        public ClosestApproach? Solve(double fromUt)
        {
            var fetch = FlightGlobals.fetch;
            var active = FlightGlobals.ActiveVessel;
            var target = fetch != null ? fetch.VesselTarget : null;
            if (active == null || target == null)
            {
                return null;
            }

            var selfOrbit = active.orbit;
            var targetOrbit = target.GetOrbit();
            if (selfOrbit == null || targetOrbit == null)
            {
                return null;
            }

            // Same reference body only -- a cross-SOI approach is not a single
            // two-body problem (the same gate the former SDK-side solve used).
            if (selfOrbit.referenceBody != targetOrbit.referenceBody)
            {
                return null;
            }

            var ut = Orbit.NextCloseApproachTime(selfOrbit, targetOrbit, fromUt);
            if (double.IsNaN(ut) || double.IsInfinity(ut))
            {
                return null;
            }

            // Both positions are relative to the SAME reference body, so their
            // difference is the true separation.
            var separation = (selfOrbit.getRelativePositionAtUT(ut) - targetOrbit.getRelativePositionAtUT(ut)).magnitude;
            if (double.IsNaN(separation) || double.IsInfinity(separation))
            {
                return null;
            }

            return new ClosestApproach { Time = ut, Distance = separation };
        }
    }
}
