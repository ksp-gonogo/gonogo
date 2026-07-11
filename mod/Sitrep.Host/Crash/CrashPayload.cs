using System.Collections.Generic;

namespace Sitrep.Host.Crash
{
    /// <summary>
    /// Channel topic ids for the crash event stream — the single "last
    /// notable crash" record plus its boolean "have we ever recorded one"
    /// companion. Both ride <c>Delivery.ReliableOrdered</c> (the event lane:
    /// every value delivered, in order, replayed to a late subscriber via the
    /// emitter's keyframe-on-subscribe), which is what makes <c>lastCrash</c>
    /// sticky across a station reconnect.
    /// </summary>
    public static class CrashTopics
    {
        public const string LastCrash = "crash.lastCrash";
        public const string HasRecent = "crash.hasRecent";
    }

    /// <summary>
    /// One part lost in a crash — the plain, KSP-free counterpart to
    /// <c>Sitrep.Contract.CrashPartLost</c>, filled by the KSP-facing producer
    /// and flattened to a dictionary by <see cref="CrashPayload.Build"/>.
    /// Named distinctly from the contract POCO so a file importing both
    /// namespaces has no ambiguity.
    /// </summary>
    public sealed class LostPart
    {
        public long PartId;
        public string PartName = "";
        public string PartTitle = "";
        public string Msg = "";
    }

    /// <summary>
    /// Per-flight statistics accumulated up to the crash — the plain value
    /// bundle <see cref="FlightStatsTracker.Snapshot"/> produces and
    /// <see cref="CrashPayload.Build"/> flattens. Field-for-field the
    /// <c>flightStats</c> object in the wire fixtures.
    /// </summary>
    public struct FlightStats
    {
        public int KerbalsKilled;
        public int PartsLost;
        public string FlightEndMode;
        public double HighestSpeedOverLand;
        public bool MissionEnd;
        public double HighestGee;
        public double HighestAltitude;
        public double TotalDistance;
        public double MissionTime;
        public double HighestSpeed;
        public double GroundDistance;
        public bool LiftOff;
    }

    /// <summary>
    /// The plain, KSP-free crash record the producer assembles from live KSP
    /// on the main thread, then hands to <see cref="CrashPayload.Build"/> off
    /// the main thread. Holds no live KSP object references, so it is safe to
    /// carry across threads.
    /// </summary>
    public sealed class CrashCapture
    {
        public string VesselId = "";
        public string EventKind = "";
        public string What = "";
        public string VesselType = "";
        public string Msg = "";
        public double Latitude;
        public double Longitude;
        public List<LostPart> PartsLost = new List<LostPart>();
        public string Body = "";
        public FlightStats FlightStats;
        public string VesselName = "";
        public List<string> Events = new List<string>();
        public List<string> KerbalsKilled = new List<string>();
        public string Situation = "";
        public List<string> CrewAboard = new List<string>();
        public double Altitude;
        public double Ut;
    }

    /// <summary>
    /// Pure crash-record logic, factored out of the KSP-facing
    /// <c>Gonogo.KSP.CrashUplink</c> exactly as <c>Sitrep.Host.Comms.SignalDelay</c>
    /// is factored out of <c>CommsCoreUplink</c> — no KSP/Unity references, so
    /// it is headless-testable. Owns the source-side relevance filter and the
    /// wire-dictionary assembly.
    /// </summary>
    public static class CrashPayload
    {
        /// <summary>
        /// Source-side relevance gate (the <c>crash.lastCrash filters debris
        /// at source</c> rule): a crash record is published only for a real
        /// craft. Debris destruction, a discarded flag, and an Unknown
        /// vessel type would otherwise clobber the single "last notable crash"
        /// slot, so they are dropped here, in the producer, before publish —
        /// the consumers deliberately trust whatever arrives. The wire carries
        /// the <c>VesselType</c> enum's string name.
        /// </summary>
        public static bool ShouldPublish(string? vesselType) =>
            vesselType != "Debris" && vesselType != "Flag" && vesselType != "Unknown";

        /// <summary>
        /// Flattens a <see cref="CrashCapture"/> to the nested
        /// <c>Dictionary&lt;string, object?&gt;</c> / <c>List&lt;object?&gt;</c>
        /// graph <see cref="Sitrep.Core.Serialization.JsonWriter"/> serializes.
        /// Key order mirrors the wire fixtures so the produced shape reads
        /// identically to the captured payloads.
        /// </summary>
        public static Dictionary<string, object?> Build(CrashCapture c)
        {
            var partsLost = new List<object?>(c.PartsLost.Count);
            foreach (var p in c.PartsLost)
            {
                partsLost.Add(new Dictionary<string, object?>
                {
                    ["partId"] = p.PartId,
                    ["partName"] = p.PartName,
                    ["partTitle"] = p.PartTitle,
                    ["msg"] = p.Msg,
                });
            }

            var stats = c.FlightStats;
            var flightStats = new Dictionary<string, object?>
            {
                ["kerbalsKilled"] = stats.KerbalsKilled,
                ["partsLost"] = stats.PartsLost,
                ["flightEndMode"] = stats.FlightEndMode ?? "",
                ["highestSpeedOverLand"] = stats.HighestSpeedOverLand,
                ["missionEnd"] = stats.MissionEnd,
                ["highestGee"] = stats.HighestGee,
                ["highestAltitude"] = stats.HighestAltitude,
                ["totalDistance"] = stats.TotalDistance,
                ["missionTime"] = stats.MissionTime,
                ["highestSpeed"] = stats.HighestSpeed,
                ["groundDistance"] = stats.GroundDistance,
                ["liftOff"] = stats.LiftOff,
            };

            return new Dictionary<string, object?>
            {
                ["vesselId"] = c.VesselId,
                ["eventKind"] = c.EventKind,
                ["what"] = c.What,
                ["vesselType"] = c.VesselType,
                ["msg"] = c.Msg,
                ["latitude"] = c.Latitude,
                ["longitude"] = c.Longitude,
                ["partsLost"] = partsLost,
                ["body"] = c.Body,
                ["flightStats"] = flightStats,
                ["vesselName"] = c.VesselName,
                ["events"] = new List<object?>(c.Events),
                ["kerbalsKilled"] = new List<object?>(c.KerbalsKilled),
                ["situation"] = c.Situation,
                ["crewAboard"] = new List<object?>(c.CrewAboard),
                ["altitude"] = c.Altitude,
                ["ut"] = c.Ut,
            };
        }
    }
}
