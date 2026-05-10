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
            "sci.deploy",
            "sci.transmit",
            "sci.dump",
            "sci.reset",
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
                case "sci.deploy":
                    return (v, args) => DeployInstrument(v, args);
                case "sci.transmit":
                    return (v, args) => TransmitInstrument(v, args);
                case "sci.dump":
                    return (v, args) => DumpInstrument(v, args);
                case "sci.reset":
                    return (v, args) => ResetInstrument(v, args);
                default:
                    return null;
            }
        }

        private static ModuleScienceExperiment FindExperimentByPartId(
            Vessel vessel, string[] args)
        {
            if (vessel == null || vessel.parts == null) return null;
            if (args == null || args.Length == 0) return null;
            if (!uint.TryParse(args[0], out var partId)) return null;

            foreach (var part in vessel.parts)
            {
                if (part == null || part.flightID != partId) continue;
                foreach (var module in part.Modules)
                {
                    if (module is ModuleScienceExperiment exp) return exp;
                }
                return null;
            }
            return null;
        }

        private static object DeployInstrument(Vessel vessel, string[] args)
        {
            var exp = FindExperimentByPartId(vessel, args);
            if (exp == null) return "instrument not found";
            if (exp.Inoperable) return "instrument inoperable";
            if (exp.Deployed) return 0; // already deployed — idempotent

            // KSP's public DeployExperiment() calls the private coroutine
            // gatherData(showDialog: true) — the dialog is a player-at-
            // keyboard affordance and adds friction for headless / station
            // automation. The same code path also exists with
            // showDialog: false (used internally by EVA "deploy" + by the
            // module's own no-dialog branch); we reach it via reflection
            // because gatherData itself is private. Capture goes straight
            // into the experiment's container — `Deployed` and `hasData`
            // flip true the same way as the dialog path, just without
            // the UI step.
            //
            // Fallback to DeployExperiment() if reflection fails (e.g. KSP
            // renames gatherData on a future version) — better a dialog
            // than no data capture.
            var captured = exp;
            GonogoTelemetryAddon.Defer(() =>
            {
                try
                {
                    var method = typeof(ModuleScienceExperiment).GetMethod(
                        "gatherData",
                        System.Reflection.BindingFlags.NonPublic |
                        System.Reflection.BindingFlags.Instance);
                    if (method == null)
                    {
                        captured.DeployExperiment();
                        return;
                    }
                    var coroutine = method.Invoke(captured, new object[] { false })
                        as System.Collections.IEnumerator;
                    if (coroutine != null)
                    {
                        captured.StartCoroutine(coroutine);
                    }
                    else
                    {
                        captured.DeployExperiment();
                    }
                }
                catch (Exception ex)
                {
                    UnityEngine.Debug.LogError(
                        "[GonogoTelemetry] sci.deploy non-dialog path failed: " + ex);
                    try { captured.DeployExperiment(); } catch { /* best-effort */ }
                }
            });
            return 0;
        }

        private static object DumpInstrument(Vessel vessel, string[] args)
        {
            var exp = FindExperimentByPartId(vessel, args);
            if (exp == null) return "instrument not found";

            var data = exp.GetData();
            if (data == null || data.Length == 0) return 0; // already empty

            // DumpData removes a specific ScienceData entry without
            // transmitting (no science gain). Equivalent to the
            // "Discard" button in KSP's result dialog. Defer onto the
            // main thread — the experiment's container fires events on
            // remove that some mods listen for, and the SR animation
            // tear-down is Unity-coupled.
            var capturedExp = exp;
            var capturedData = data;
            GonogoTelemetryAddon.Defer(() =>
            {
                foreach (var d in capturedData)
                {
                    if (d != null) capturedExp.DumpData(d);
                }
            });
            return 0;
        }

        private static object ResetInstrument(Vessel vessel, string[] args)
        {
            var exp = FindExperimentByPartId(vessel, args);
            if (exp == null) return "instrument not found";

            // ResetExperiment clears Deployed + drops all stored data,
            // making rerunnable instruments ready to run again. For
            // non-rerunnable ones, this typically doesn't clear the
            // Inoperable flag — only an Engineer's repair / recovery
            // back to KSC can do that.
            var captured = exp;
            GonogoTelemetryAddon.Defer(() => captured.ResetExperiment());
            return 0;
        }

        private static object TransmitInstrument(Vessel vessel, string[] args)
        {
            var exp = FindExperimentByPartId(vessel, args);
            if (exp == null) return "instrument not found";

            var data = exp.GetData();
            if (data == null || data.Length == 0) return "no data to transmit";

            // ModuleScienceExperiment doesn't expose a public TransmitData;
            // its internal Transmit flow asks ScienceUtil.GetBestTransmitter
            // for the vessel's active transmitter and pushes the data list.
            // Mirror that path. Then DumpData on each entry so the source
            // module reflects "transmitted, no longer holding it".
            //
            // The transmitter resolution can read on this thread, but
            // TransmitData spawns transmit visuals (antenna animations,
            // scaled-particle FX) and DumpData mutates module state — all
            // Unity-coupled. Defer the whole side-effecting block.
            var transmitter = ScienceUtil.GetBestTransmitter(vessel);
            if (transmitter == null) return "no transmitter available";

            var list = new System.Collections.Generic.List<ScienceData>(data);
            var capturedExp = exp;
            var capturedData = data;
            GonogoTelemetryAddon.Defer(() =>
            {
                transmitter.TransmitData(list);
                foreach (var d in capturedData)
                {
                    if (d != null) capturedExp.DumpData(d);
                }
            });
            return 0;
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
                            ["dataMits"] = Util.R4(d.dataAmount),
                            ["baseTransmitValue"] = Util.R4(d.baseTransmitValue),
                            ["transmitBonus"] = Util.R4(d.transmitBonus),
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
                        entry["subjectScience"] = Util.R4(subjectScience);
                        entry["subjectScienceCap"] = Util.R4(subjectCap);
                        entry["remainingPotential"] =
                            Util.R4(Math.Max(0f, subjectCap - subjectScience));
                        result.Add(entry);
                    }
                }
            }
            return result;
        }

        private static object DataAmountTotal(Vessel vessel)
        {
            if (vessel == null || vessel.parts == null) return 0d;
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
            return Util.R4(total);
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
