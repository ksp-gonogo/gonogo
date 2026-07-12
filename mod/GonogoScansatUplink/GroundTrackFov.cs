using System;
using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// One sensor's public inputs to <see cref="GroundTrackFov.Compute"/> —
    /// mirrors <c>SCANsensor.{fov,min_alt,max_alt,best_alt}</c>
    /// (SCANcontroller.cs:2359-2374, all public fields).
    /// </summary>
    public readonly struct SensorFovInputs
    {
        public double Fov { get; }
        public double MinAlt { get; }
        public double MaxAlt { get; }
        public double BestAlt { get; }

        public SensorFovInputs(double fov, double minAlt, double maxAlt, double bestAlt)
        {
            Fov = fov;
            MinAlt = minAlt;
            MaxAlt = maxAlt;
            BestAlt = bestAlt;
        }
    }

    /// <summary>
    /// Replicates SCANsat's PRIVATE <c>SCANcontroller.getFOV(SCANvessel,
    /// CelestialBody)</c> (SCANcontroller.cs:1916-1963) faithfully from its
    /// public inputs, per scansat-migration-spec.md §0D. This is
    /// deliberately NOT the <c>doScanPass</c> FOV block (SCANcontroller.cs
    /// :2970-3007), which additionally applies a latitude-inflation term
    /// (<c>fovW = fov * (1/cosLookUp[lat])</c>) that <c>getFOV</c> does not
    /// have — copying that block would produce a wrong, pole-inflated
    /// footprint. See NOTICE-SCANSAT.txt for the BSD attribution this
    /// replication carries.
    ///
    /// Pure function — no SCANsat or KSP types — unit-testable headlessly
    /// against known SCANsat values.
    /// </summary>
    public static class GroundTrackFov
    {
        /// <param name="sensors">This vessel's sensors (SCANvessel.sensors, public).</param>
        /// <param name="altitude">v.vessel.altitude (public).</param>
        /// <param name="bodyRadius">b.Radius (public).</param>
        /// <param name="bodySoiRadius">b.sphereOfInfluence (public).</param>
        /// <param name="homeRadius">Planetarium.fetch.Home.Radius (public).</param>
        public static double Compute(
            IReadOnlyList<SensorFovInputs> sensors,
            double altitude,
            double bodyRadius,
            double bodySoiRadius,
            double homeRadius)
        {
            if (sensors == null) throw new ArgumentNullException(nameof(sensors));

            double maxFov = 0;
            double soiRadius = bodySoiRadius - bodyRadius;
            double surfScale = homeRadius / bodyRadius;
            if (surfScale < 1) surfScale = 1;
            surfScale = Math.Sqrt(surfScale);

            for (int j = sensors.Count - 1; j >= 0; j--)
            {
                SensorFovInputs s = sensors[j];

                if (altitude < s.MinAlt) continue;
                if (altitude > Math.Min(s.MaxAlt, soiRadius)) continue;

                double fov = s.Fov;
                double bestAlt = Math.Min(s.BestAlt, soiRadius);
                if (altitude < bestAlt)
                {
                    fov = (altitude / bestAlt) * fov;
                }

                fov *= surfScale;
                if (fov > 20) fov = 20;

                if (fov > maxFov) maxFov = fov;
            }

            return maxFov;
        }
    }
}
