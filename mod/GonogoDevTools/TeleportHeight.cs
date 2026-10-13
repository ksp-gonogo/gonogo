using System;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The height a teleport request asks the craft to stand above the terrain
    /// under the point it is placed at, and the one correction that gets it
    /// there. A point on an orbit has a fixed latitude and longitude for a given
    /// instant, so the terrain height under it is not the request's to choose;
    /// the orbit is raised instead.
    /// </summary>
    internal static class TeleportHeight
    {
        /// <summary>Within this many metres of the request is close enough not to place again.</summary>
        public const double ToleranceM = 0.5;

        /// <summary>
        /// The apsides, in km above the surface, to place again with, or null when
        /// the craft already stands within <see cref="ToleranceM"/> of the
        /// requested height above terrain. Both apsides move by the same amount,
        /// up or down, so the point's radius changes by about that much whichever
        /// point of the orbit it is.
        /// </summary>
        /// <param name="periapsisKm">The apsis placed with, in km above the surface.</param>
        /// <param name="apoapsisKm">The apsis placed with, in km above the surface.</param>
        /// <param name="altitudeM">Where the craft stands, in metres above sea level.</param>
        /// <param name="terrainM">The terrain height under it, in metres above sea level.</param>
        /// <param name="requestedAboveTerrainM">The height above terrain the request asked for.</param>
        public static (double PeriapsisKm, double ApoapsisKm)? Correction(
            double periapsisKm, double apoapsisKm, double altitudeM, double terrainM, double requestedAboveTerrainM)
        {
            var offM = requestedAboveTerrainM - (altitudeM - terrainM);
            if (double.IsNaN(offM) || Math.Abs(offM) <= ToleranceM)
            {
                return null;
            }
            var shiftKm = offM / 1000.0;
            return (periapsisKm + shiftKm, apoapsisKm + shiftKm);
        }
    }
}
