using System;
using System.Collections.Generic;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// Which bodies lie between a station's body and a vessel's parent, and so which
    /// ones can block the path.
    ///
    /// <para>The walk goes UP from the station's body to the common ancestor, then
    /// DOWN to the vessel's parent, and every body it passes through is an occluder.
    /// Both directions occur constantly: a craft at a moon of the station's planet
    /// only descends, while anything interplanetary must first climb to the
    /// star.</para>
    ///
    /// <para><b>This no longer says where any of them IS.</b> It used to hand the
    /// geometry a conic per link, which is what left the two-body assumption sitting
    /// in a caller. It now names the bodies and leaves their positions to whichever
    /// propagation provider is elected, which is the only thing that can answer that
    /// question for a physics other than two-body.</para>
    /// </summary>
    public static class PatchedConicChain
    {
        /// <summary>
        /// The bodies that can come between <paramref name="stationBodyIndex"/> and
        /// <paramref name="vesselParentIndex"/>, nearest the station first, or null
        /// when no path exists (different systems, or a malformed hierarchy). An
        /// empty list means the two are the same body.
        /// </summary>
        /// <param name="occludingRadiusOf">
        /// The occluding radius of a body by index, from the elected comms occlusion
        /// model. Supplied by the caller rather than read off the body table,
        /// because how big a body is to a radio wave is the model's answer and not
        /// the body's: stock CommNet shrinks it and a network-replacing backend need not.
        /// </param>
        public static List<OccludingBody>? OccludersBetween(
            int stationBodyIndex,
            int vesselParentIndex,
            IReadOnlyList<SystemBody>? bodies,
            Func<int, double> occludingRadiusOf)
        {
            if (occludingRadiusOf == null) throw new ArgumentNullException(nameof(occludingRadiusOf));

            List<int> climb, descend;
            if (!BodyHierarchy.TryPathBetween(stationBodyIndex, vesselParentIndex, bodies, out climb, out descend))
            {
                return null;
            }

            var occluders = new List<OccludingBody>(climb.Count + descend.Count);

            // Climbing past a body arrives at the one ABOVE it, and that is the body
            // then sitting between the two endpoints. The body being left behind is
            // the frame's own centre, whose occlusion the geometry handles
            // separately.
            foreach (var index in climb)
            {
                var parent = bodies[index].ParentIndex;
                if (parent < 0 || parent >= bodies.Count)
                {
                    return null;
                }
                occluders.Add(new OccludingBody(parent, occludingRadiusOf(parent)));
            }

            foreach (var index in descend)
            {
                occluders.Add(new OccludingBody(index, occludingRadiusOf(index)));
            }

            return occluders;
        }
    }
}
