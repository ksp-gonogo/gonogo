using System.Collections.Generic;
using Sitrep.Propagation;

namespace Gonogo.KSP
{
    /// <summary>
    /// Which bodies an n-body integration about a given primary actually sums.
    ///
    /// <para><b>The primary's gravitational neighbourhood, not the whole system, and
    /// that is a narrowing with a reason.</b> Every acceleration evaluation asks the
    /// elected propagation provider where each perturber is, and the provider
    /// reaches a frame it does not own by walking the body tree, so a body several
    /// links away costs several conic solves per step. Summing all thirty-odd for a
    /// low orbit spends that on terms smaller than the integrator's own truncation:
    /// the perturbation ratio scales as the cube of the distance ratio, so the
    /// primary's parent, its siblings and its own satellites carry essentially all
    /// of it and the rest carries the cost.</para>
    ///
    /// <para>What the narrowing costs is stated rather than hidden: a published arc
    /// carries the count of bodies actually summed, and the largest third-body term
    /// as a fraction of the central one, so a regime where the neighbourhood is not
    /// enough shows on the payload rather than being inferred.</para>
    ///
    /// <para>MAIN THREAD ONLY, and cached per primary: the hierarchy does not change
    /// during a save, so rebuilding the list per step would spend real time reaching
    /// the same answer.</para>
    /// </summary>
    public static class KspPerturbers
    {
        private static readonly Dictionary<int, IReadOnlyList<PerturbingBody>> Cache =
            new Dictionary<int, IReadOnlyList<PerturbingBody>>();

        /// <summary>
        /// The neighbourhood of <paramref name="primaryIndex"/>, or an empty list
        /// when the game has no bodies yet.
        ///
        /// <para>Empty is a real answer and it degrades rather than fails: the
        /// integration runs against the primary alone, and the arc says it summed
        /// nothing.</para>
        /// </summary>
        public static IReadOnlyList<PerturbingBody> Around(int primaryIndex)
        {
            if (Cache.TryGetValue(primaryIndex, out var cached))
            {
                return cached;
            }

            var bodies = FlightGlobals.Bodies;
            if (bodies == null || primaryIndex < 0 || primaryIndex >= bodies.Count)
            {
                return new PerturbingBody[0];
            }

            var primary = bodies[primaryIndex];
            var parent = primary != null && primary.orbit != null ? primary.orbit.referenceBody : null;

            var list = new List<PerturbingBody>();
            for (var i = 0; i < bodies.Count; i++)
            {
                if (i == primaryIndex) continue;
                var body = bodies[i];
                // `name`, the Unity object name, and NOT `bodyName`. A gravity
                // model is looked up by the key its publisher wrote, and an n-body
                // physics mod keys its own model on the object name; the two fields
                // are free to differ, and a planet pack that renames one and not
                // the other turns every perturber into a term the model cannot
                // name. The arc then publishes a missing term and a degraded
                // derivation for a system whose masses are all present.
                if (body == null || string.IsNullOrEmpty(body.name)) continue;

                var bodyParent = body.orbit != null ? body.orbit.referenceBody : null;
                var isSatellite = bodyParent == primary;
                var isParent = parent != null && body == parent;
                var isSibling = parent != null && bodyParent == parent;
                if (!isSatellite && !isParent && !isSibling) continue;

                list.Add(new PerturbingBody(body.name, i));
            }

            Cache[primaryIndex] = list;
            return list;
        }
    }
}
