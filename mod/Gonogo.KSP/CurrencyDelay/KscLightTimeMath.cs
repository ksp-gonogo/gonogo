using System;
using Sitrep.Host.Comms;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// A minimal 3D point in whatever coordinate frame the caller already
    /// resolved (KSP world space, in practice), carrying no dependency on
    /// that frame's own type. Kept separate from UnityEngine/KSP's Vector3d
    /// so this file, and everything in it, compiles and is unit-tested with
    /// no KspManaged reference DLLs at all; the KSP-glue half of this
    /// subsystem (KscLightTime.cs) converts a live Vector3d into one of
    /// these before calling in.
    /// </summary>
    internal readonly struct DelayPosition
    {
        public double X { get; }
        public double Y { get; }
        public double Z { get; }

        public DelayPosition(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }
    }

    /// <summary>
    /// Pure light-time math for KSC-anchored currency delay: the
    /// distance/light-speed arithmetic and the routed-vs-straight-line
    /// decision, given already-resolved geometry. No KSP/Unity types
    /// anywhere in this file (only <see cref="SignalDelayConfig"/>, a plain
    /// POCO from the KSP-free Sitrep.Host.Comms assembly), so it compiles
    /// and is unit-tested unconditionally, unlike the KSP-glue half of this
    /// subsystem in KscLightTime.cs, which reads a live Vessel/ProtoVessel/
    /// CommNet position and is only verifiable at the full-sln fold.
    /// </summary>
    internal static class KscLightTimeMath
    {
        internal static double DistanceMeters(DelayPosition a, DelayPosition b)
        {
            var dx = a.X - b.X;
            var dy = a.Y - b.Y;
            var dz = a.Z - b.Z;
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }

        /// <summary>
        /// One-way seconds for a straight-line distance under
        /// <see cref="SignalDelayConfig"/>. Two distinct "not a real
        /// light-time" outcomes, kept apart deliberately: <c>!Enabled</c>
        /// means the delay feature is off but the link is live, a genuine
        /// zero (0.0), matching SignalDelay.Compute's Disabled case;
        /// <c>LightSpeedScale &lt;= 0</c> means the scale makes light-time
        /// uncomputable, nothing honest to report (null), matching
        /// SignalDelay.Compute's NoPath case. Zero distance (at KSC) falls
        /// straight out of the division, no special case needed.
        /// </summary>
        internal static double? FromDistance(double distanceMeters, SignalDelayConfig? config)
        {
            if (config == null)
            {
                return null;
            }

            if (!config.Enabled)
            {
                return 0.0;
            }

            if (config.LightSpeedScale <= 0.0)
            {
                return null;
            }

            return distanceMeters / (SignalDelay.SpeedOfLightMetersPerSecond * config.LightSpeedScale);
        }

        /// <summary>
        /// KSC-anchored one-way light-time given already-resolved geometry.
        /// Prefers the ROUTED vessel&lt;-&gt;KSC light-time (computed by the
        /// caller via FleetCommsReader.ReadVessel, which has no straight-line
        /// equivalent to recompute here) when available; falls back to
        /// straight-line from subjectPosition to kscPosition. Null when
        /// neither a routed delay nor both positions are available - nothing
        /// to compute.
        /// </summary>
        internal static double? Resolve(
            double? routedOneWaySeconds,
            DelayPosition? subjectPosition,
            DelayPosition? kscPosition,
            SignalDelayConfig? config)
        {
            if (routedOneWaySeconds.HasValue)
            {
                return routedOneWaySeconds.Value;
            }

            if (subjectPosition.HasValue && kscPosition.HasValue)
            {
                return FromDistance(DistanceMeters(subjectPosition.Value, kscPosition.Value), config);
            }

            return null;
        }
    }
}
