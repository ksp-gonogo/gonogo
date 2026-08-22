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
    /// <para><b>Callable off the main thread, which it has to be.</b> The arc is
    /// computed inside the <c>vessel.orbit</c> channel mapper, and channel mappers
    /// run on the Courier thread rather than the Unity one. So every read below is a
    /// plain managed field on a game object (<c>Bodies</c>, <c>orbit</c>,
    /// <c>referenceBody</c>, <c>bodyName</c>) and never a native accessor:
    /// <c>UnityEngine.Object.name</c> in particular is a native call that a
    /// non-Unity thread is not entitled to make, and reaching for it here would
    /// throw inside the arc source, be swallowed as "nothing attempted", and put
    /// the whole feature back to looking dead with no complaint on the wire.</para>
    ///
    /// <para><c>bodyName</c> is also the key every other body table in this mod uses,
    /// <c>system.bodies</c> included, so a gravity model looked up by it agrees with
    /// the indices the rest of the payload speaks. Where a force model spells a body
    /// differently the arc says so: the term is dropped, the body is named in
    /// <c>missingTerm</c>, and the derivation degrades rather than the curve going
    /// quiet.</para>
    ///
    /// <para>Cached per primary under a lock: the hierarchy does not change during a
    /// save, so rebuilding the list per step would spend real time reaching the same
    /// answer, and the lock is what keeps a future main-thread caller from tearing
    /// the dictionary against the Courier one.</para>
    /// </summary>
    public static class KspPerturbers
    {
        private static readonly object Gate = new object();

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
            lock (Gate)
            {
                if (Cache.TryGetValue(primaryIndex, out var cached))
                {
                    return cached;
                }
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
                if (body == null || string.IsNullOrEmpty(body.bodyName)) continue;

                var bodyParent = body.orbit != null ? body.orbit.referenceBody : null;
                var isSatellite = bodyParent == primary;
                var isParent = parent != null && body == parent;
                var isSibling = parent != null && bodyParent == parent;
                if (!isSatellite && !isParent && !isSibling) continue;

                list.Add(new PerturbingBody(body.bodyName, i));
            }

            lock (Gate)
            {
                Cache[primaryIndex] = list;
            }
            return list;
        }
    }
}
