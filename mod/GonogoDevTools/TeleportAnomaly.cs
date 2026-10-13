using System;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The mean anomaly at epoch a teleport request places the craft at, in the
    /// radians <c>Orbit.SetOrbit</c> takes. A request names it in degrees, with 0
    /// at periapsis and 180 at apoapsis, so a craft can be put at the high point
    /// of an orbit that dips below the surface at its low point.
    /// </summary>
    internal static class TeleportAnomaly
    {
        /// <summary><paramref name="degrees"/> as radians in [0, 2π), so 360 and -180 land where 0 and 180 do.</summary>
        public static double ToRadians(double degrees)
        {
            var wrapped = degrees % 360.0;
            if (wrapped < 0.0)
            {
                wrapped += 360.0;
            }
            return wrapped * Math.PI / 180.0;
        }
    }
}
