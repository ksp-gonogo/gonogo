using System.Collections.Generic;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// The offset, in degrees, between KSP's <c>rotationAngle</c> reference and
    /// the propagation frame's zero longitude, MEASURED per body rather than
    /// asserted.
    ///
    /// <para><b>Why measured.</b> A station's inertial longitude ought to be
    /// <c>GetLongitude(world) + rotationAngle</c>, and it is not: on Kerbin
    /// that is wrong by about 40 degrees, which put the station 357 km from
    /// where it belongs and made every prediction unpublishable. KSP defines
    /// orbital LAN against <c>Planetarium.right</c> while <c>rotationAngle</c>
    /// is measured from its own reference, so a constant offset between the two
    /// is expected — but reasoning about which constant produced three wrong
    /// answers in a row, and a fourth guess is worth less than one
    /// measurement.</para>
    ///
    /// <para>So the offset is solved for against the live scene, once per body,
    /// by minimising exactly the residual the frame self-check already reports:
    /// the difference between the geometry's own vessel-to-station separation
    /// and the world-space one. At the right offset that residual falls to a
    /// few hundred metres out of thousands of kilometres, which is the geometry
    /// agreeing with the game rather than a fit.</para>
    ///
    /// <para>This also survives what an asserted constant would not: a KSP
    /// version that changes the convention, a planet pack with a different
    /// <c>initialRotation</c>, or a body whose rotation is defined by another
    /// mod. Each is simply measured.</para>
    /// </summary>
    internal static class StationLongitudeCalibration
    {
        private static readonly Dictionary<int, double> OffsetsByBodyIndex = new Dictionary<int, double>();

        internal static bool TryGet(int bodyIndex, out double offsetDegrees) =>
            OffsetsByBodyIndex.TryGetValue(bodyIndex, out offsetDegrees);

        internal static void Set(int bodyIndex, double offsetDegrees) =>
            OffsetsByBodyIndex[bodyIndex] = offsetDegrees;

        /// <summary>Cleared with the scene: a reload can re-measure rather than trust a stale solve.</summary>
        internal static void Clear() => OffsetsByBodyIndex.Clear();
    }
}
