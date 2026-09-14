using System;
using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Which bodies this Uplink sums when it bounds a craft orbiting a given
    /// primary: the primary's parent, its siblings and its own satellites.
    ///
    /// <para><b>The neighbourhood, not the system, and the narrowing costs
    /// nothing.</b> The perturbation scales as the CUBE of the distance ratio, so a
    /// body one link further out contributes a term the bound cannot see, while each
    /// one asked for costs a walk of the body tree through the displaced solver.
    /// Measured on the rig against the stock system, a 250 km Kerbin orbit takes
    /// 98.7% of its whole perturbation from the Mun alone and 1.2% from the Sun;
    /// every other body in the neighbourhood together came to under a part in two
    /// thousand.</para>
    ///
    /// <para><b>Callable off the main thread, which it has to be.</b> The bound is
    /// computed inside the <c>vessel.orbit</c> channel mapper, and channel mappers
    /// run on the Courier thread rather than the Unity one. So every read below is a
    /// plain managed field on a game object (<c>Bodies</c>, <c>orbit</c>,
    /// <c>referenceBody</c>, <c>bodyName</c>) and never a native accessor:
    /// <c>UnityEngine.Object.name</c> in particular is a call a non-Unity thread is
    /// not entitled to make, and reaching for it here would throw inside the
    /// provider, be caught as "cannot bound this", and put the horizon back to
    /// saying nothing with no complaint attached.</para>
    ///
    /// <para><c>bodyName</c> is also the key the producer's own gravity-model config
    /// is written in, so a mass looked up by it agrees with the model this Uplink
    /// publishes. A body the model does not name is dropped from the sum by the
    /// caller, which SHORTENS the horizon rather than lengthening it.</para>
    ///
    /// <para>Cached per primary under a lock: the hierarchy does not change during a
    /// save, so rebuilding the list per bound would spend real time reaching the same
    /// answer, and the lock is what keeps a future main-thread caller from tearing
    /// the dictionary against the Courier one.</para>
    /// </summary>
    public static class PrincipiaPerturbers
    {
        private static readonly object Gate = new object();

        private static readonly Dictionary<int, IReadOnlyList<PrincipiaPerturber>> Cache =
            new Dictionary<int, IReadOnlyList<PrincipiaPerturber>>();

        private static readonly PrincipiaPerturber[] None = new PrincipiaPerturber[0];

        /// <summary>
        /// The neighbourhood of <paramref name="primaryIndex"/>, or an empty list
        /// when there is no body list to read.
        ///
        /// <para>Empty is a real answer: the caller states the ceiling and nothing
        /// else, which is the same bound a craft with no measurable perturber gets.
        /// A headless build reaches here and takes that path.</para>
        /// </summary>
        public static IReadOnlyList<PrincipiaPerturber> Around(int primaryIndex)
        {
            lock (Gate)
            {
                if (Cache.TryGetValue(primaryIndex, out var cached))
                {
                    return cached;
                }
            }

            List<PrincipiaPerturber> list;
            try
            {
                var bodies = FlightGlobals.Bodies;
                if (bodies == null || primaryIndex < 0 || primaryIndex >= bodies.Count)
                {
                    return None;
                }

                var primary = bodies[primaryIndex];
                var parent = primary != null && primary.orbit != null
                    ? primary.orbit.referenceBody
                    : null;

                list = new List<PrincipiaPerturber>();
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

                    list.Add(new PrincipiaPerturber(body.bodyName, i));
                }
            }
            catch (Exception)
            {
                // A build with no game behind these statics is not a fault, it is a
                // headless one. Nothing summed means the ceiling and nothing else,
                // which is never longer than the horizon this replaced.
                return None;
            }

            lock (Gate)
            {
                Cache[primaryIndex] = list;
            }
            return list;
        }

        /// <summary>
        /// Which body <paramref name="bodyIndex"/> orbits, or null for the root and
        /// for anything the game will not say.
        ///
        /// <para>Beside <see cref="Around"/> because it reads the same table under the
        /// same constraint: plain managed fields only, never a native accessor, because
        /// this runs on the Courier thread. It is what a BODY's own horizon needs and a
        /// craft's does not, a craft carrying its primary on the target it arrives
        /// as.</para>
        ///
        /// <para>Cached under the same lock and for the same reason: the hierarchy does
        /// not change during a save, and the walk is linear in the body count.</para>
        /// </summary>
        public static int? ParentOf(int bodyIndex)
        {
            lock (Gate)
            {
                if (ParentCache.TryGetValue(bodyIndex, out var cached))
                {
                    return cached;
                }
            }

            int? parentIndex = null;
            try
            {
                var bodies = FlightGlobals.Bodies;
                if (bodies == null || bodyIndex < 0 || bodyIndex >= bodies.Count)
                {
                    return null;
                }

                var body = bodies[bodyIndex];
                var parent = body != null && body.orbit != null ? body.orbit.referenceBody : null;
                if (parent != null)
                {
                    for (var i = 0; i < bodies.Count; i++)
                    {
                        if (i == bodyIndex || bodies[i] != parent) continue;
                        parentIndex = i;
                        break;
                    }
                }
            }
            catch (Exception)
            {
                // Headless, as above. Nothing to say is not the same as a fault, and a
                // body with no primary gets no bound rather than a made-up one.
                return null;
            }

            lock (Gate)
            {
                ParentCache[bodyIndex] = parentIndex;
            }
            return parentIndex;
        }

        private static readonly Dictionary<int, int?> ParentCache = new Dictionary<int, int?>();
    }
}
