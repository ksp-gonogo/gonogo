using System.Collections.Generic;
using Sitrep.Propagation;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// The live body hierarchy as a propagation provider wants it: a parent pointer
    /// and a set of elements per body, keyed on the same indices
    /// <c>FlightGlobals.Bodies</c> uses.
    ///
    /// <para>MAIN THREAD ONLY, and cached after the first successful read. The
    /// propagation capability is elected at bootstrap, well before the game has a
    /// body list to hand over, so the provider holds a callback to this rather than
    /// a list; caching is what keeps a 1440-sample sweep from rebuilding the table
    /// on every solve.</para>
    ///
    /// <para>Bodies do not change orbit during a save, so a snapshot is as good as a
    /// live read. What DOES change is whether there is a list at all, which is why
    /// an empty read is not cached.</para>
    /// </summary>
    public static class KspSystemTable
    {
        private static IReadOnlyList<SystemBody> _cached;

        /// <summary>The table, or an empty one before the game has bodies. Never null.</summary>
        public static IReadOnlyList<SystemBody> Current()
        {
            if (_cached != null)
            {
                return _cached;
            }

            var bodies = FlightGlobals.Bodies;
            if (bodies == null || bodies.Count == 0)
            {
                return new SystemBody[0];
            }

            var table = new List<SystemBody>(bodies.Count);
            foreach (var body in bodies)
            {
                if (body == null)
                {
                    table.Add(new SystemBody(-1, null));
                    continue;
                }
                var parent = body.orbit != null ? body.orbit.referenceBody : null;
                var parentIndex = parent != null ? bodies.IndexOf(parent) : -1;
                table.Add(new SystemBody(
                    parentIndex,
                    body.orbit != null && parentIndex >= 0 ? ElementsOf(body.orbit) : (OrbitElements?)null));
            }

            _cached = table;
            return table;
        }

        /// <summary>Drops the snapshot, for a scene change that rebuilds the body list.</summary>
        public static void Forget()
        {
            _cached = null;
        }

        private static OrbitElements ElementsOf(Orbit orbit) =>
            OrbitElements.FromKspDegrees(
                sma: orbit.semiMajorAxis,
                ecc: orbit.eccentricity,
                incDegrees: orbit.inclination,
                lanDegrees: orbit.LAN,
                argPeDegrees: orbit.argumentOfPeriapsis,
                meanAnomalyAtEpochRadians: orbit.meanAnomalyAtEpoch,
                epoch: orbit.epoch,
                mu: orbit.referenceBody.gravParameter);
    }
}
