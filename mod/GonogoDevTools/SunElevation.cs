using System;

namespace Gonogo.DevTools
{
    /// <summary>
    /// How high the sun stands above the local horizon at a point on a body, in
    /// degrees: 90 with the sun straight overhead, 0 on the horizon, negative at night.
    /// </summary>
    internal static class SunElevation
    {
        /// <summary>
        /// The elevation from the local up direction and the direction towards the sun, both
        /// expressed in the same frame. Neither needs to be a unit vector. Because the
        /// caller measures both at one instant, a rotating body is already accounted for:
        /// the up vector of a point is wherever the body's rotation has carried it by then.
        /// </summary>
        /// <returns>Degrees from -90 to 90, or NaN when either direction has no length.</returns>
        public static double Degrees(
            double upX, double upY, double upZ, double sunX, double sunY, double sunZ)
        {
            var upLength = Math.Sqrt(upX * upX + upY * upY + upZ * upZ);
            var sunLength = Math.Sqrt(sunX * sunX + sunY * sunY + sunZ * sunZ);
            if (!(upLength > 0) || !(sunLength > 0) || double.IsInfinity(upLength) || double.IsInfinity(sunLength))
            {
                return double.NaN;
            }

            var sine = (upX * sunX + upY * sunY + upZ * sunZ) / (upLength * sunLength);
            return Math.Asin(Math.Max(-1.0, Math.Min(1.0, sine))) * 180.0 / Math.PI;
        }

        /// <summary>
        /// The local up direction at a latitude and longitude on a body whose polar axis is
        /// +Z, whose longitude zero lies along +X when its rotation angle is zero, and which
        /// has turned <paramref name="rotationDegrees"/> about the axis since then.
        /// </summary>
        public static (double X, double Y, double Z) Up(double latitudeDegrees, double longitudeDegrees, double rotationDegrees)
        {
            var lat = latitudeDegrees * Math.PI / 180.0;
            var turn = (longitudeDegrees + rotationDegrees) * Math.PI / 180.0;
            return (Math.Cos(lat) * Math.Cos(turn), Math.Cos(lat) * Math.Sin(turn), Math.Sin(lat));
        }
    }
}
