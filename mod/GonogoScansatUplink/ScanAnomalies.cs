using System;
using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Pure (SCANsat/KSP-type-free) builder for the <c>scansat.anomalies.&lt;body&gt;</c>
    /// wire payload — one <c>Dictionary&lt;string, object?&gt;</c> per SCANsat
    /// "anomaly" (an easter-egg surface feature — a monolith, a UFO, etc.) known
    /// for the body, keyed with the EXACT camelCase field names the client
    /// decodes (JsonWriter emits a dict's keys verbatim; the client's
    /// <c>SCANAnomalyEntry</c> — <c>packages/core/src/schemas/scansat.ts</c> —
    /// mirrors these). Kept SCANsat-type-free — the uplink's
    /// <see cref="ScansatUplink.CaptureOnMain"/> reads SCANsat's
    /// <c>SCANdata.Anomalies</c> (<c>SCANanomaly[]</c>) on the main thread and
    /// passes PLAIN scalars in here — so the whole shaping path is
    /// unit-testable headlessly with no SCANsat/KSP DLLs present, the same
    /// headless-test split as <see cref="ScanningVessels"/>/<see cref="ScanScience"/>.
    /// </summary>
    public static class ScanAnomalies
    {
        /// <summary>
        /// One SCANsat anomaly's public fields, as plain scalars (mirrors
        /// <c>SCANsat.SCAN_Data.SCANanomaly.{Name,Longitude,Latitude,Known,Detail}</c>).
        /// <paramref name="Known"/> is true once the player has discovered the
        /// anomaly's position (an Anomaly-type scan); <paramref name="Detail"/>
        /// is true once they have its name (an AnomalyDetail-type scan) — both
        /// are re-derived by SCANsat itself from the body's coverage grid on
        /// every <c>Anomalies</c> read, so the uplink only ever mirrors current
        /// state, never computes discovery itself.
        /// </summary>
        public readonly struct AnomalyInput
        {
            public string Name { get; }
            public double Longitude { get; }
            public double Latitude { get; }
            public bool Known { get; }
            public bool Detail { get; }

            public AnomalyInput(string name, double longitude, double latitude, bool known, bool detail)
            {
                Name = name;
                Longitude = longitude;
                Latitude = latitude;
                Known = known;
                Detail = detail;
            }
        }

        /// <summary>
        /// Builds the wire array for one body's anomaly set. Field names match
        /// <c>SCANAnomalyEntry</c> (client) 1:1 — no shaping beyond the
        /// dictionary wrap, since SCANsat's own fields are already exactly the
        /// shape the client wants (name/lat/lon/known/detail).
        /// </summary>
        public static List<object?> Build(IReadOnlyList<AnomalyInput> anomalies)
        {
            if (anomalies == null) throw new ArgumentNullException(nameof(anomalies));

            var list = new List<object?>(anomalies.Count);
            foreach (var a in anomalies)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["name"] = a.Name,
                    ["latitude"] = a.Latitude,
                    ["longitude"] = a.Longitude,
                    ["known"] = a.Known,
                    ["detail"] = a.Detail,
                });
            }
            return list;
        }
    }
}
