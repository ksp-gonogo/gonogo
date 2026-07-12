using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// Pure (SCANsat/KSP-type-free) builder for the <c>scansat.science</c> wire
    /// payload — one <c>Dictionary&lt;string, object?&gt;</c> per SCANsat
    /// map-scanner part on the active vessel, keyed with the EXACT camelCase
    /// field names the client decodes (JsonWriter emits a dict's keys verbatim;
    /// the client's ScienceOfficer augment / <c>Sitrep.Contract.ScanScienceEntry</c>
    /// mirror these). Kept SCANsat-type-free — the uplink's
    /// <see cref="ScansatUplink.CaptureScienceOnMain"/> reads the SCANsat
    /// <c>SCANexperiment</c> fields on the main thread and passes PLAIN scalars
    /// in here — so the whole shaping path is unit-testable headlessly with no
    /// SCANsat/KSP DLLs present, the same headless-test split as
    /// <see cref="ScanningVessels"/> / <see cref="GroundTrackFov"/> /
    /// <see cref="ScanGrids"/>.
    /// </summary>
    public static class ScanScience
    {
        /// <summary>
        /// Builds the wire dict for one map-scanner part.
        /// <paramref name="expId"/> is the raw R&amp;D experiment id
        /// (<c>SCANexperiment.experimentType</c>); <paramref name="hasData"/> is
        /// <c>GetScienceCount() &gt; 0</c>; <paramref name="rerunnable"/> mirrors
        /// <c>IsRerunnable()</c> (SCANsat hard-codes it to <c>true</c>).
        /// <c>deployed</c> and <c>inoperable</c> are always <c>false</c>:
        /// SCANsat map experiments have no deploy or inoperable lifecycle.
        /// </summary>
        public static Dictionary<string, object?> Build(
            string partId,
            string partTitle,
            string expId,
            bool hasData,
            bool rerunnable)
        {
            return new Dictionary<string, object?>
            {
                ["partId"] = partId,
                ["partTitle"] = partTitle,
                ["expId"] = expId,
                ["title"] = FriendlyTitle(expId),
                ["deployed"] = false,
                ["hasData"] = hasData,
                ["rerunnable"] = rerunnable,
                ["inoperable"] = false,
            };
        }

        /// <summary>
        /// The friendly experiment name SCANsat shows in its part-module event
        /// labels (<c>SCANexperiment.UpdateEventNames</c>), keyed off the raw
        /// R&amp;D id. Falls back to the raw id for an unknown type.
        /// </summary>
        public static string FriendlyTitle(string expId)
        {
            switch (expId)
            {
                case "SCANsatAltimetryLoRes":
                    return "RADAR";
                case "SCANsatAltimetryHiRes":
                    return "SAR";
                case "SCANsatBiomeAnomaly":
                    return "Multispectral";
                case "SCANsatResources":
                    return "Resources";
                case "SCANsatVisual":
                    return "Visual";
                default:
                    return expId;
            }
        }
    }
}
