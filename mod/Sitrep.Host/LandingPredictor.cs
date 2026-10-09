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
        /// Bisection halvings spent on the step that crosses the surface. The
        /// search interval shrinks to <c>stepSec / 2^RefinementSteps</c>, which
        /// is well under a millisecond for any sane step, and it is also the
        /// ceiling on the extra samples one search takes.
        /// </summary>
        public const int RefinementSteps = 24;

        /// <summary>
        /// The most terrain reads one search may take, refinement included. Each
        /// is a PQS evaluation, so this bounds the per-tick cost; a search that
        /// spends the allowance on its coarse walk stops reading terrain and
        /// falls back to the sea-level crossing.
        /// </summary>
        public const int MaxTerrainReads = 96;

        /// <summary>
        /// Step from <paramref name="nowUt"/> over <paramref name="horizonSec"/>
        /// at <paramref name="stepSec"/>; the first step that is below the
        /// surface ends the coarse walk. The surface is the larger of
        /// <paramref name="minImpactAltMeters"/> and the terrain height from
        /// <paramref name="terrainAt"/> (lat, lon degrees; metres above sea level),
        /// which is only asked for while the trajectory is under
        /// <paramref name="terrainCeilingMeters"/>, the highest ground the body has.
        /// The crossing is then bisected between that step and the one before it
        /// (<see cref="RefinementSteps"/> halvings), and the last above-surface
        /// lat/lon found is returned, so the site neither moves with where the
        /// coarse grid happens to start nor stops at sea level over high ground.
        /// Returns null when the parameters are degenerate, the very first sample
        /// is already below the surface, or the trajectory never reaches the
        /// surface within the horizon (still airborne: no touchdown to assess).
        /// </summary>
        public static (double lat, double lon)? FindImpact(
            Func<double, GeoPoint> sampler,
            double nowUt,
            double horizonSec,
            double stepSec,
            double minImpactAltMeters = -100.0,
            Func<double, double, double>? terrainAt = null,
            double terrainCeilingMeters = double.PositiveInfinity)
        {
            if (sampler == null || !(stepSec > 0) || !(horizonSec > 0))
                return null;

            int terrainReads = 0;
            bool Below(GeoPoint g)
            {
                if (g.Altitude < minImpactAltMeters)
                    return true;
                if (terrainAt == null
                    || g.Altitude >= terrainCeilingMeters
                    || terrainReads >= MaxTerrainReads - RefinementSteps)
                    return false;
                terrainReads++;
                return g.Altitude < terrainAt(g.Lat, g.Lon);
            }

            (double lat, double lon)? last = null;
            double lastUt = nowUt;
            double endUt = nowUt + horizonSec;
            for (double ut = nowUt; ut <= endUt; ut += stepSec)
            {
                var g = sampler(ut);
                if (Below(g))
                    return last.HasValue ? Refine(sampler, Below, lastUt, ut, last.Value) : null;
                last = (g.Lat, g.Lon);
                lastUt = ut;
            }
            return null;
        }

        private static (double lat, double lon) Refine(
            Func<double, GeoPoint> sampler,
            Func<GeoPoint, bool> below,
            double aboveUt,
            double belowUt,
            (double lat, double lon) above)
        {
            for (int i = 0; i < RefinementSteps; i++)
            {
                double mid = 0.5 * (aboveUt + belowUt);
                var g = sampler(mid);
                if (below(g))
                {
                    belowUt = mid;
                }
                else
                {
                    aboveUt = mid;
                    above = (g.Lat, g.Lon);
                }
            }
            return above;
        }
    }
}
