using System;
using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Pure (SCANsat/KSP-type-free) builder for the
    /// <c>scansat.scanningVessels</c> wire payload — one
    /// <c>Dictionary&lt;string, object?&gt;</c> per tracked vessel, keyed with
    /// the EXACT camelCase field names the client decodes (JsonWriter emits a
    /// dict's keys verbatim; the client's <c>SCANScanningVessel</c> /
    /// <c>Sitrep.Contract.ScanningVesselEntry</c> mirror these). Kept SCANsat-
    /// type-free — the uplink's <see cref="ScansatUplink.BuildScanningVessels"/>
    /// reads the SCANsat <c>SCANvessel</c>/<c>SCANsensor</c> fields and passes
    /// PLAIN scalars in here — so the whole shaping path (including the
    /// per-side FoV widths via <see cref="GroundTrackFov"/>) is unit-testable
    /// headlessly with no SCANsat/KSP DLLs present, the same headless-test
    /// split as <see cref="GroundTrackFov"/> and <see cref="ScanGrids"/>.
    /// </summary>
    public static class ScanningVessels
    {
        /// <summary>
        /// One vessel's public SCANsat sensor inputs (mirrors
        /// <c>SCANsensor.{sensor,fov,min_alt,max_alt,best_alt,inRange,bestRange}</c>,
        /// <c>SCANcontroller.cs:32-53</c>), as plain scalars.
        /// </summary>
        public readonly struct SensorInput
        {
            /// <summary>Numeric <c>SCANtype</c> bit value ((int)SCANsensor.sensor).</summary>
            public int Type { get; }
            public double Fov { get; }
            public double MinAlt { get; }
            public double MaxAlt { get; }
            public double BestAlt { get; }
            public bool InRange { get; }
            public bool BestRange { get; }

            public SensorInput(int type, double fov, double minAlt, double maxAlt, double bestAlt, bool inRange, bool bestRange)
            {
                Type = type;
                Fov = fov;
                MinAlt = minAlt;
                MaxAlt = maxAlt;
                BestAlt = bestAlt;
                InRange = inRange;
                BestRange = bestRange;
            }
        }

        /// <summary>The longitude-half-width cap SCANsat applies inside its coverage-paint loop.</summary>
        public const double LonHalfWidthCapDeg = 120.0;

        /// <summary>
        /// Builds the wire dict for one tracked vessel. <paramref name="sensors"/>
        /// feeds both the emitted <c>sensors</c> array and the
        /// <c>groundTrackWidthDeg</c> FoV replication. When no sensor is
        /// in-range the FoV is 0, and BOTH <c>groundTrackWidthDeg</c> and
        /// <c>groundTrackLonHalfDeg</c> emit <c>null</c> (nothing to paint) —
        /// matching the client contract.
        /// </summary>
        /// <param name="bodyRadius">b.Radius (public).</param>
        /// <param name="bodySoiRadius">b.sphereOfInfluence (public).</param>
        /// <param name="homeRadius">Planetarium.fetch.Home.Radius (public).</param>
        public static Dictionary<string, object?> Build(
            string vesselId,
            string vesselName,
            string bodyName,
            double subLatitude,
            double subLongitude,
            double altitude,
            IReadOnlyList<SensorInput> sensors,
            double bodyRadius,
            double bodySoiRadius,
            double homeRadius,
            int trackColorR,
            int trackColorG,
            int trackColorB,
            int trackColorA)
        {
            if (sensors == null) throw new ArgumentNullException(nameof(sensors));

            var sensorDicts = new List<object?>(sensors.Count);
            var fovInputs = new List<SensorFovInputs>(sensors.Count);
            for (int i = 0; i < sensors.Count; i++)
            {
                var s = sensors[i];
                sensorDicts.Add(new Dictionary<string, object?>
                {
                    ["type"] = s.Type,
                    ["fov"] = s.Fov,
                    ["minAlt"] = s.MinAlt,
                    ["maxAlt"] = s.MaxAlt,
                    ["bestAlt"] = s.BestAlt,
                    ["inRange"] = s.InRange,
                    ["bestRange"] = s.BestRange,
                });
                fovInputs.Add(new SensorFovInputs(s.Fov, s.MinAlt, s.MaxAlt, s.BestAlt));
            }

            double widthDeg = GroundTrackFov.Compute(fovInputs, altitude, bodyRadius, bodySoiRadius, homeRadius);
            object? groundTrackWidthDeg = widthDeg > 0 ? widthDeg : null;
            object? groundTrackLonHalfDeg = widthDeg > 0 ? LonHalfWidth(widthDeg, subLatitude) : null;

            return new Dictionary<string, object?>
            {
                ["vesselId"] = vesselId,
                ["vesselName"] = vesselName,
                ["body"] = bodyName,
                ["subLatitude"] = subLatitude,
                ["subLongitude"] = subLongitude,
                ["altitude"] = altitude,
                ["sensors"] = sensorDicts,
                ["groundTrackWidthDeg"] = groundTrackWidthDeg,
                ["groundTrackLonHalfDeg"] = groundTrackLonHalfDeg,
                ["trackColor"] = new Dictionary<string, object?>
                {
                    ["r"] = trackColorR,
                    ["g"] = trackColorG,
                    ["b"] = trackColorB,
                    ["a"] = trackColorA,
                },
            };
        }

        /// <summary>
        /// Per-side LONGITUDE half-width in degrees:
        /// <c>widthDeg / cos(|subLat|)</c>, capped at
        /// <see cref="LonHalfWidthCapDeg"/> — the 1/cos widening SCANsat
        /// applies inside its coverage-paint loop (near the poles cos → 0, so
        /// the cap is what keeps the band finite). Pure.
        /// </summary>
        public static double LonHalfWidth(double widthDeg, double subLatitude)
        {
            double cos = Math.Cos(Math.Abs(subLatitude) * Math.PI / 180.0);
            if (cos <= 0) return LonHalfWidthCapDeg;
            double lon = widthDeg / cos;
            return lon > LonHalfWidthCapDeg ? LonHalfWidthCapDeg : lon;
        }
    }
}
