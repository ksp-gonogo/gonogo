using System.Collections.Generic;
using Sitrep.Propagation;
using Sitrep.Contract;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// The live body hierarchy as a propagation provider wants it: a parent pointer
    /// and a set of elements per body, keyed on the same indices
    /// <c>FlightGlobals.Bodies</c> uses.
    ///
    /// <para>Main thread only. The propagation capability is elected at bootstrap,
    /// well before the game has a body list to hand over, so the provider holds a
    /// callback to this rather than a list.</para>
    ///
    /// <para>The elements are the ones each body carries at the current game
    /// instant, read again whenever that instant moves on. They are not constant:
    /// an n-body physics mod rewrites every body's orbit to its osculating
    /// elements on each physics step, so elements read once and kept describe the
    /// bodies at the time of that read, and a scene the mod is not running in yet
    /// (the main menu) still carries the config's elements. Within one instant the
    /// read is shared, which keeps a 1440-sample sweep from rebuilding the table
    /// on every solve. An empty read is never kept.</para>
    /// </summary>
    public static class KspSystemTable
    {
        private static readonly InstantSnapshot<IReadOnlyList<SystemBody>> Snapshot =
            new InstantSnapshot<IReadOnlyList<SystemBody>>(Read, table => table.Count > 0);

        /// <summary>The table, or an empty one before the game has bodies. Never null.</summary>
        public static IReadOnlyList<SystemBody> Current() => Snapshot.At(GameTime());

        /// <summary>The universal time, or null in a scene with neither a planetarium nor a game to read it from.</summary>
        private static double? GameTime()
        {
            if (Planetarium.fetch != null)
            {
                return Planetarium.fetch.time;
            }
            var game = HighLogic.CurrentGame;
            return game != null ? game.UniversalTime : (double?)null;
        }

        private static IReadOnlyList<SystemBody> Read()
        {
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
            return table;
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
