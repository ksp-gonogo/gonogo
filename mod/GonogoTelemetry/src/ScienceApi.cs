using System;
using System.Collections.Generic;
using Telemachus;

namespace GonogoTelemetry
{
    /// <summary>
    /// Per-instrument science detail beyond Telemachus's existing
    /// `sci.experiments` aggregate. Drives the Science Officer widget
    /// and the upgraded ScienceBench breakdown.
    ///
    /// Keys (all per-vessel — `Vessel` argument is read):
    ///
    /// - `sci.instruments` — `[{ partId, partTitle, expId, deployed,
    ///   hasData, rerunnable, inoperable }]`. One entry per
    ///   ModuleScienceExperiment on the active vessel. `partId` is the
    ///   `Part.flightID` (stable for the lifetime of the part); `expId`
    ///   is the experiment id (`crewReport`, `temperatureScan`, …).
    ///
    /// - `sci.experimentBreakdown` — `[{ subjectId, biome, situation,
    ///   expTitle, dataMits, baseTransmitValue, transmitBonus,
    ///   subjectScience, subjectScienceCap, remainingPotential }]`.
    ///   One entry per stored ScienceData. `subjectScience` /
    ///   `subjectScienceCap` come from
    ///   `ResearchAndDevelopment.GetSubjectByID(subjectId)`;
    ///   `remainingPotential = subjectScienceCap - subjectScience`.
    ///   Phase 2 emits the raw KSP fields rather than computed
    ///   "transmitMits / recoverMits" — the actual formula involves
    ///   scienceValueRatio + transmissibility and is fiddly enough to
    ///   defer until we have a live save to verify against. The widget
    ///   sorts by `remainingPotential` desc.
    ///
    /// - `sci.canTransmitTotal` — sum of `dataAmount` across all stored
    ///   data (a coarse "how much is sitting in the antenna queue"
    ///   number; useful as a banner stat without the per-subject walk).
    ///
    /// - `sci.canRecoverTotal` — same sum. We keep a separate key in
    ///   case Phase 4's transmit/recover formulas diverge — for now
    ///   they're aliases.
    /// </summary>
    public class ScienceApi : IMinimalTelemachusPlugin
    {
        public string[] Commands => new[]
        {
            "sci.instruments",
            "sci.experimentBreakdown",
            "sci.canTransmitTotal",
            "sci.canRecoverTotal",
        };

        public Func<Vessel, string[], object> GetAPIHandler(string api)
        {
            switch (api)
            {
                case "sci.instruments":
                    return (v, _) => Instruments(v);
                case "sci.experimentBreakdown":
                    return (v, _) => ExperimentBreakdown(v);
                case "sci.canTransmitTotal":
                    return (v, _) => DataAmountTotal(v);
                case "sci.canRecoverTotal":
                    return (v, _) => DataAmountTotal(v);
                default:
                    return null;
            }
        }

        private static object Instruments(Vessel vessel)
        {
            var result = new List<Dictionary<string, object>>();
            if (vessel == null || vessel.parts == null) return result;

            foreach (var part in vessel.parts)
            {
                if (part == null || part.Modules == null) continue;
                foreach (var module in part.Modules)
                {
                    if (!(module is ModuleScienceExperiment exp)) continue;

                    var data = exp.GetData();
                    var hasData = data != null && data.Length > 0;

                    result.Add(new Dictionary<string, object>
                    {
                        ["partId"] = part.flightID,
                        ["partTitle"] = part.partInfo != null
                            ? part.partInfo.title
                            : part.name,
                        ["expId"] = exp.experimentID ?? string.Empty,
                        ["deployed"] = exp.Deployed,
                        ["hasData"] = hasData,
                        ["rerunnable"] = exp.rerunnable,
                        ["inoperable"] = exp.Inoperable,
                    });
                }
            }
            return result;
        }

        private static object ExperimentBreakdown(Vessel vessel)
        {
            var result = new List<Dictionary<string, object>>();
            if (vessel == null || vessel.parts == null) return result;

            foreach (var part in vessel.parts)
            {
                if (part == null || part.Modules == null) continue;
                foreach (var module in part.Modules)
                {
                    if (!(module is IScienceDataContainer container)) continue;
                    var data = container.GetData();
                    if (data == null) continue;

                    foreach (var d in data)
                    {
                        if (d == null) continue;
                        var entry = new Dictionary<string, object>
                        {
                            ["subjectId"] = d.subjectID ?? string.Empty,
                            ["expTitle"] = d.title ?? string.Empty,
                            ["dataMits"] = d.dataAmount,
                            ["baseTransmitValue"] = d.baseTransmitValue,
                            ["transmitBonus"] = d.transmitBonus,
                        };

                        // Resolve biome / situation / remaining from the
                        // subject. ResearchAndDevelopment is null in
                        // sandbox; emit zeros + empty strings so the
                        // widget can render a degenerate-but-stable row.
                        string biome = string.Empty;
                        string situation = string.Empty;
                        float subjectScience = 0f;
                        float subjectCap = 0f;

                        if (ResearchAndDevelopment.Instance != null &&
                            !string.IsNullOrEmpty(d.subjectID))
                        {
                            var subject = ResearchAndDevelopment
                                .GetSubjectByID(d.subjectID);
                            if (subject != null)
                            {
                                subjectScience = subject.science;
                                subjectCap = subject.scienceCap;
                            }
                            ParseSubjectId(d.subjectID, out situation, out biome);
                        }

                        entry["biome"] = biome;
                        entry["situation"] = situation;
                        entry["subjectScience"] = subjectScience;
                        entry["subjectScienceCap"] = subjectCap;
                        entry["remainingPotential"] =
                            Math.Max(0f, subjectCap - subjectScience);
                        result.Add(entry);
                    }
                }
            }
            return result;
        }

        private static object DataAmountTotal(Vessel vessel)
        {
            if (vessel == null || vessel.parts == null) return 0f;
            float total = 0f;
            foreach (var part in vessel.parts)
            {
                if (part == null || part.Modules == null) continue;
                foreach (var module in part.Modules)
                {
                    if (!(module is IScienceDataContainer container)) continue;
                    var data = container.GetData();
                    if (data == null) continue;
                    foreach (var d in data)
                    {
                        if (d != null) total += d.dataAmount;
                    }
                }
            }
            return total;
        }

        // SubjectIDs are conventionally `<expId>@<body><situation><biome>`,
        // e.g. `crewReport@KerbinSrfLandedKSC`. There's no guarantee mods
        // honour the format — fall back to empty strings when we can't
        // segment cleanly. The biome+situation split is heuristic
        // (capital-letter boundaries), and the situation set is the
        // ExperimentSituations enum names; unknown segments stay in the
        // biome bucket so we don't drop information.
        private static readonly string[] KnownSituations = {
            "InSpaceLow", "InSpaceHigh",
            "FlyingLow", "FlyingHigh",
            "SrfLanded", "SrfSplashed",
        };

        private static void ParseSubjectId(string subjectId,
            out string situation, out string biome)
        {
            situation = string.Empty;
            biome = string.Empty;
            if (string.IsNullOrEmpty(subjectId)) return;
            var atIdx = subjectId.IndexOf('@');
            if (atIdx < 0 || atIdx >= subjectId.Length - 1) return;

            // Tail = "<body><situation><biome>" with no separators. Find the
            // body by trimming until a recognised situation token starts.
            var tail = subjectId.Substring(atIdx + 1);
            foreach (var sit in KnownSituations)
            {
                var sitIdx = tail.IndexOf(sit, StringComparison.Ordinal);
                if (sitIdx <= 0) continue;
                situation = sit;
                if (sitIdx + sit.Length < tail.Length)
                    biome = tail.Substring(sitIdx + sit.Length);
                return;
            }
        }
    }
}
