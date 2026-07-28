using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free predicted-touchdown search: the algorithm half of the
    /// mod-side impact predictor (option 1). Walks a caller-supplied sampler
    /// forward in time and returns the last above-surface lat/lon before the
    /// altitude crosses below the surface, mirroring the client's proven
    /// <c>findImpactPoint</c> patch-walk. The KSP-frame glue (orbit position →
    /// lat/lon/altitude, with the body-rotation correction) lives in the KSP
    /// capture and is injected as the <paramref name="sampler"/>, so this search
    /// stays unit-testable while the un-testable frame maths is isolated.
    /// </summary>
    public static class LandingPredictor
    {
        /// <summary>A sampled point along the predicted trajectory.</summary>
        public struct GeoPoint
        {
            /// <summary>Latitude, degrees.</summary>
            public double Lat;
            /// <summary>Longitude, degrees (body-fixed).</summary>
            public double Lon;
            /// <summary>Altitude above the surface, metres.</summary>
            public double Altitude;

            public GeoPoint(double lat, double lon, double altitude)
            {
                Lat = lat;
                Lon = lon;
                Altitude = altitude;
            }
        }

        /// <summary>
        /// Step from <paramref name="nowUt"/> over <paramref name="horizonSec"/>
        /// at <paramref name="stepSec"/>; the first step whose altitude drops
        /// below <paramref name="minImpactAltMeters"/> ends the walk, returning
        /// the PREVIOUS (last above-surface) point's lat/lon. Returns null when
        /// the parameters are degenerate, or the trajectory never reaches the
        /// surface within the horizon (still airborne: no touchdown to assess).
        /// </summary>
        public static (double lat, double lon)? FindImpact(
            Func<double, GeoPoint> sampler,
            double nowUt,
            double horizonSec,
            double stepSec,
            double minImpactAltMeters = -100.0)
        {
            if (sampler == null || !(stepSec > 0) || !(horizonSec > 0))
                return null;

            (double lat, double lon)? last = null;
            double endUt = nowUt + horizonSec;
            for (double ut = nowUt; ut <= endUt; ut += stepSec)
            {
                var g = sampler(ut);
                if (g.Altitude < minImpactAltMeters)
                    return last;
                last = (g.Lat, g.Lon);
            }
            return null;
        }
    }
}
