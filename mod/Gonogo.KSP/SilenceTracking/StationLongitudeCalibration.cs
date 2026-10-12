using System;
using System.Collections.Generic;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// The offset, in degrees, between KSP's <c>rotationAngle</c> reference and
    /// the propagation frame's zero longitude, measured per body rather than
    /// asserted.
    ///
    /// <para><b>Why measured.</b> A station's inertial longitude ought to be
    /// <c>GetLongitude(world) + rotationAngle</c>, and it is not: on Kerbin
    /// that is wrong by about 40 degrees, which put the station 357 km from
    /// where it belongs and made every prediction unpublishable. KSP defines
    /// orbital LAN against <c>Planetarium.right</c> while <c>rotationAngle</c>
    /// is measured from its own reference, so a constant offset between the two
    /// is expected, but reasoning about which constant produced three wrong
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
    /// <para><b>Per frame regime.</b> A body whose frame is rotating
    /// (<c>CelestialBody.inverseRotation</c>: low orbit, atmosphere, landed) and
    /// the same body in the inertial regime need different offsets, and in the
    /// rotating one the offset moves with <c>Planetarium.InverseRotAngle</c>. An
    /// offset measured in one is wrong in the other by an arbitrary angle, so
    /// each regime keeps its own entry, and a rotating-regime entry is reused
    /// only while that angle has not moved.</para>
    ///
    /// <para><b>Possibly more than one offset.</b> One separation measurement
    /// fixes the offset only up to a mirror, so an entry holds every offset that
    /// reconciled and is usable only once a later measurement, after the body
    /// has turned, has left one.</para>
    ///
    /// <para>This also survives what an asserted constant would not: a KSP
    /// version that changes the convention, a planet pack with a different
    /// <c>initialRotation</c>, or a body whose rotation is defined by another
    /// mod. Each is simply measured.</para>
    /// </summary>
    internal static class StationLongitudeCalibration
    {
        /// <summary>How far the rotating frame's angle may move before a rotating-regime offset is measured again, degrees.</summary>
        private const double RotatingReuseDegrees = 0.05;

        private sealed class Entry
        {
            public List<double> Offsets = new List<double>();
            public double InverseRotAngle;
        }

        private static readonly Dictionary<long, Entry> Entries = new Dictionary<long, Entry>();

        private static long Key(int bodyIndex, bool rotating) => ((long)bodyIndex << 1) | (rotating ? 1L : 0L);

        /// <summary>
        /// The offset, when exactly one is left and, for the rotating regime,
        /// the frame has not turned since it was measured.
        /// </summary>
        internal static bool TryGet(int bodyIndex, bool rotating, double inverseRotAngleDeg, out double offsetDegrees)
        {
            offsetDegrees = 0.0;
            Entry entry;
            if (!Entries.TryGetValue(Key(bodyIndex, rotating), out entry) || entry.Offsets.Count != 1)
            {
                return false;
            }
            if (rotating && Math.Abs(AngleGap(entry.InverseRotAngle, inverseRotAngleDeg)) > RotatingReuseDegrees)
            {
                return false;
            }
            offsetDegrees = entry.Offsets[0];
            return true;
        }

        /// <summary>The offsets still in play for the regime, more than one while the mirror solution has not dropped out. Empty when there are none.</summary>
        internal static IReadOnlyList<double> Pending(int bodyIndex, bool rotating, double inverseRotAngleDeg)
        {
            Entry entry;
            if (!Entries.TryGetValue(Key(bodyIndex, rotating), out entry))
            {
                return new double[0];
            }
            if (rotating && Math.Abs(AngleGap(entry.InverseRotAngle, inverseRotAngleDeg)) > RotatingReuseDegrees)
            {
                return new double[0];
            }
            return entry.Offsets;
        }

        internal static void Set(int bodyIndex, bool rotating, double inverseRotAngleDeg, IEnumerable<double> offsets)
        {
            var entry = new Entry { InverseRotAngle = inverseRotAngleDeg };
            entry.Offsets.AddRange(offsets);
            Entries[Key(bodyIndex, rotating)] = entry;
        }

        /// <summary>Cleared with the scene: a reload can re-measure rather than trust a stale solve.</summary>
        internal static void Clear() => Entries.Clear();

        private static double AngleGap(double a, double b)
        {
            var gap = (a - b) % 360.0;
            if (gap > 180.0) gap -= 360.0;
            if (gap < -180.0) gap += 360.0;
            return gap;
        }
    }
}
