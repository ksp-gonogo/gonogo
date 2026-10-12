using System;
using Sitrep.Contract;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>Why <see cref="FrameYaw.TryMeasure"/> declined to produce a rotation.</summary>
    public enum FrameYawRefusal
    {
        /// <summary>A rotation was produced.</summary>
        None = 0,

        /// <summary>One of the vectors was zero or not a real number.</summary>
        NotFinite,

        /// <summary>The reference lies too close to the spin axis for its heading to be read.</summary>
        NearAxis,

        /// <summary>The two vectors differ along the spin axis, so the frames are not related by a turn about it.</summary>
        OffAxisMismatch,

        /// <summary>The two vectors have different distances from the spin axis, so they are not the same vector.</summary>
        LengthMismatch,
    }

    /// <summary>
    /// The turn about the spin axis that carries a vector measured in the
    /// game's world axes onto the same vector in the propagation frame, read
    /// directly from one reference vector known in both.
    ///
    /// <para>Both frames are +Z up, so the only difference this measures is a
    /// heading. The heading of the reference is a single unambiguous angle: unlike
    /// a separation, which fixes a heading only up to a mirror and is nearly flat
    /// where the station faces away from the reference, a vector carries its
    /// direction. The vector must agree between the frames along the axis and in its
    /// distance from it, which is what tells a pure turn from a frame that
    /// differs in some other way, and a pair that disagrees is refused rather than
    /// fitted.</para>
    ///
    /// <para>Used by the silence predictor to place ground stations in the
    /// propagation frame from where the game says they are.</para>
    /// </summary>
    public static class FrameYaw
    {
        /// <summary>The smallest share of the reference's length that must lie off the spin axis.</summary>
        public const double MinimumOffAxisFraction = 0.05;

        /// <summary>How far the two vectors may differ along the axis and in distance from it, as a share of the reference's length.</summary>
        public const double AgreementFraction = 1e-3;

        /// <summary>
        /// The turn in radians about +Z that takes <paramref name="inWorld"/> onto
        /// <paramref name="inPropagation"/>, or the reason there is none.
        /// <paramref name="mismatchMeters"/> is the larger of the two disagreements
        /// the vectors showed, metres.
        /// </summary>
        public static bool TryMeasure(
            Vector3d inWorld,
            Vector3d inPropagation,
            out double yawRadians,
            out FrameYawRefusal refusal,
            out double mismatchMeters)
        {
            yawRadians = 0.0;
            mismatchMeters = 0.0;

            var length = inPropagation.Magnitude();
            if (!IsReal(inWorld) || !IsReal(inPropagation) || !(length > 0.0) || !(inWorld.Magnitude() > 0.0))
            {
                refusal = FrameYawRefusal.NotFinite;
                return false;
            }

            var worldOff = Math.Sqrt(inWorld.X * inWorld.X + inWorld.Y * inWorld.Y);
            var propOff = Math.Sqrt(inPropagation.X * inPropagation.X + inPropagation.Y * inPropagation.Y);
            if (worldOff < MinimumOffAxisFraction * length || propOff < MinimumOffAxisFraction * length)
            {
                refusal = FrameYawRefusal.NearAxis;
                return false;
            }

            var alongAxis = Math.Abs(inWorld.Z - inPropagation.Z);
            var distance = Math.Abs(worldOff - propOff);
            mismatchMeters = Math.Max(alongAxis, distance);
            if (alongAxis > AgreementFraction * length)
            {
                refusal = FrameYawRefusal.OffAxisMismatch;
                return false;
            }
            if (distance > AgreementFraction * length)
            {
                refusal = FrameYawRefusal.LengthMismatch;
                return false;
            }

            yawRadians = Math.Atan2(inPropagation.Y, inPropagation.X) - Math.Atan2(inWorld.Y, inWorld.X);
            refusal = FrameYawRefusal.None;
            return true;
        }

        /// <summary>The vector turned by <paramref name="yawRadians"/> about +Z.</summary>
        public static Vector3d Rotate(Vector3d vector, double yawRadians)
        {
            var cos = Math.Cos(yawRadians);
            var sin = Math.Sin(yawRadians);
            return new Vector3d(vector.X * cos - vector.Y * sin, vector.X * sin + vector.Y * cos, vector.Z);
        }

        private static bool IsReal(Vector3d v) =>
            !(double.IsNaN(v.X) || double.IsNaN(v.Y) || double.IsNaN(v.Z)
              || double.IsInfinity(v.X) || double.IsInfinity(v.Y) || double.IsInfinity(v.Z));
    }
}
