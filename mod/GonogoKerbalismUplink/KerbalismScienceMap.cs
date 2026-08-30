using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Pure mappers from the reflected <see cref="ScienceRaw"/> to the four elected
    /// <c>science.*</c> payload shapes, plus this Uplink's own namespace of each
    /// one's provider extension bag. KSP-free (Sitrep.Contract only) so it is
    /// headless-testable, the same split as
    /// <see cref="KerbalismReliabilityMap"/>/<see cref="KerbalismReflection"/>.
    ///
    /// <para><b>The placement rule this file implements, once, so it is not
    /// re-argued per field.</b> A field goes in the SHARED core payload only if
    /// every science model can fill it and it means the same thing in each. It goes
    /// in <c>extensions["kerbalism"]</c> if it is Kerbalism's own concept, or
    /// Kerbalism's richer version of something core carries lossily. And a core
    /// field whose UNIT or MODEL does not match Kerbalism's is left NULL rather than
    /// filled with a number that would be read wrong: a field's unit is
    /// compile-time-baked in core and cannot vary by elected provider, so the only
    /// honest options were absence or a lie.</para>
    ///
    /// <para>Concretely, three core fields Kerbalism deliberately leaves null:
    /// <c>ExperimentEntry.DataAmount</c> (mits, Kerbalism has megabytes),
    /// <c>ExperimentEntry.BaseTransmitValue</c>/<c>TransmitBonus</c> (Kerbalism's
    /// stock-interop bridge hardcodes 1.0/0.0, which is a placeholder rather than
    /// data; the real per-megabyte value rides the bag), and
    /// <c>LabEntry.ScienceRate</c> (Kerbalism's lab makes files, not science). Each
    /// is paired with the real figure in the bag, and the entry's
    /// <c>valueModel</c> tag is what tells a reader the nulls are structural
    /// rather than "nothing yet".</para>
    ///
    /// <para>Wire keys are camelCase, hand-written to match the generated
    /// TypeScript, the same producer-owns-the-flatten rule every hand-built value
    /// tree in the mod already follows.</para>
    /// </summary>
    public static class KerbalismScienceMap
    {
        /// <summary>
        /// The provider id this backend registers with the Kernel, and therefore the
        /// key its extension namespaces live under. Matches
        /// <c>KerbalismScienceBackend.ProviderId</c>; the client's
        /// <c>registerProviderExtensionShape</c> calls name the same string.
        /// </summary>
        public const string ProviderId = "kerbalism";

        /// <summary>
        /// The <c>valueModel</c> tag every value-bearing entry this map produces
        /// carries: Kerbalism's science value is a flat rate per megabyte with no
        /// diminishing-returns curve, so a consumer must not compare these numbers
        /// with a stock backend's. See <see cref="ScienceValueModels"/>.
        /// </summary>
        public const string ValueModel = "kerbalism-linear";

        /// <summary>
        /// <c>science.experiments</c>: one entry per stored file/sample, the same
        /// "one row per stored result" contract stock's channel has. Returns null
        /// (never an empty list) when Kerbalism is not modelling science, so the
        /// channel stays unborn and silent rather than publishing an empty array
        /// (see <c>Sitrep.Contract.IScienceBackend</c> on why that matters).
        /// </summary>
        public static List<object?>? Experiments(ScienceRaw raw)
        {
            if (!raw.Modeled) return null;
            var list = new List<object?>();
            foreach (var s in raw.Stored)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["partName"] = s.PartName,
                    // Kerbalism stores results on drives, never in the experiment
                    // module, so every row is stock's "container" case. Saying
                    // "experiment" would claim the result is still in the instrument
                    // and collectable from it, which it never is here.
                    ["location"] = "container",
                    ["experimentId"] = Text(s.ExperimentId),
                    ["subjectId"] = Text(s.SubjectId),
                    ["title"] = Text(s.Title),
                    // NULL on purpose: mits, and Kerbalism has megabytes. Real
                    // figure in the bag as dataSizeMB.
                    ["dataAmount"] = null,
                    // The fraction of this subject's science still to come, which is
                    // the closest thing to stock's "value of the next report" ratio
                    // that means anything under a linear model.
                    ["scienceValueRatio"] = s.ScienceMaxValue > 0
                        ? (object?)(s.ScienceRemainingTotal / s.ScienceMaxValue)
                        : null,
                    // NULL on purpose: Kerbalism's stock bridge hardcodes these
                    // (1.0/1.0 for a file, 0.0/0.0 for a sample). Real per-megabyte
                    // value in the bag as sciencePerMB.
                    ["baseTransmitValue"] = null,
                    ["transmitBonus"] = null,
                    // A Kerbalism lab converts samples to files; it never turns a
                    // result into science, so there is no per-result lab value.
                    ["labValue"] = null,
                    ["deployed"] = null,
                    ["inoperable"] = null,
                    ["situation"] = Text(s.Situation),
                    ["valueModel"] = ValueModel,
                    ["extensions"] = new Dictionary<string, object?>
                    {
                        [ProviderId] = new Dictionary<string, object?>
                        {
                            ["dataSizeMB"] = s.SizeMB,
                            ["sciencePerMB"] = s.SciencePerMB,
                            ["kind"] = s.Kind,
                            ["sampleMass"] = s.SampleMass,
                            ["analyze"] = s.Analyze,
                            ["storageCapacityMB"] = s.DriveCapacityMB,
                            ["storageUsedMB"] = s.DriveUsedMB,
                            ["sampleSlotsTotal"] = s.SampleSlotsTotal,
                            ["sampleSlotsUsed"] = s.SampleSlotsUsed,
                            ["transmitRateMBps"] = s.TransmitRate,
                            ["transmitting"] = s.Transmitting,
                            ["sendFlagged"] = s.SendFlagged,
                        },
                    },
                });
            }
            return list;
        }

        /// <summary>
        /// <c>science.instruments</c>: one entry per <c>Experiment</c> module and one
        /// per SCANsat map scanner, regardless of whether either currently holds
        /// data, which is stock's contract for this channel too.
        ///
        /// <para>The projection worth naming: Kerbalism's four-state machine folds
        /// onto stock's two bools. <c>deployed</c> is "actually producing" (Running
        /// or Forced with no issue), <c>inoperable</c> is Broken or a depleted
        /// sample. Both are honest as far as they go, and the state and its reason
        /// ride the bag for a reader that wants the truth rather than the
        /// projection.</para>
        ///
        /// <para>The scanners are here because Kerbalism's SCANsat patch deletes the
        /// part's <c>SCANexperiment</c> module and fits <c>KerbalismScansat</c> in its
        /// place. Whoever owns the module owns reporting it, so this provider does:
        /// left out, a map scanner would be the one instrument on the vessel that
        /// appears in no list at all while quietly filling the drives.</para>
        /// </summary>
        public static List<object?>? Instruments(ScienceRaw raw)
        {
            if (!raw.Modeled) return null;
            var list = new List<object?>();
            foreach (var e in raw.Experiments)
            {
                var depleted = e.TakesSample && e.RemainingSampleMass.HasValue && e.RemainingSampleMass.Value <= 0;
                var broken = Same(e.RunningState, "Broken") || Same(e.ExpStatus, "Broken");
                var producing = (Same(e.ExpStatus, "Running") || Same(e.ExpStatus, "Forced"))
                    && string.IsNullOrEmpty(e.Issue);

                list.Add(new Dictionary<string, object?>
                {
                    ["partId"] = Text(e.PartId),
                    ["partName"] = e.PartName,
                    ["experimentId"] = Text(e.ExperimentId),
                    ["title"] = Text(e.Title),
                    ["deployed"] = producing,
                    ["inoperable"] = broken || depleted,
                    // NULL, not false: repeat-running falls out of Kerbalism's state
                    // machine rather than being a cfg flag, so there is no fact here
                    // to report. False would say "this cannot be re-run", which is
                    // usually the opposite of the truth.
                    ["rerunnable"] = null,
                    ["resettable"] = null,
                    // Results live on drives, never in the module, so there is never
                    // anything to collect FROM the instrument.
                    ["dataIsCollectable"] = false,
                    ["extensions"] = new Dictionary<string, object?>
                    {
                        [ProviderId] = new Dictionary<string, object?>
                        {
                            ["kind"] = "experiment",
                            ["issue"] = e.Issue,
                            ["runningState"] = e.RunningState,
                            ["expStatus"] = e.ExpStatus,
                            ["dataRateMBps"] = e.DataRate,
                            ["prodFactor"] = e.ProdFactor,
                            ["remainingSampleMass"] = e.RemainingSampleMass,
                        },
                    },
                });
            }

            foreach (var s in raw.Scanners)
            {
                // Scanning with nothing in the way is the scanner's whole "producing"
                // condition: it has no run to start, coverage growth writes the file.
                // Older Kerbalism builds keep no scanning flag, and a false there
                // would report every healthy scanner as stopped, so an unknown stays
                // unknown unless the vessel-level cut-out settles it.
                bool? producing;
                if (s.Scanning.HasValue) producing = s.Scanning.Value && string.IsNullOrEmpty(s.Issue);
                else if (s.PowerDisabled == true) producing = false;
                else producing = null;

                list.Add(new Dictionary<string, object?>
                {
                    ["partId"] = Text(s.PartId),
                    ["partName"] = s.PartName,
                    ["experimentId"] = Text(s.ExperimentId),
                    // No title: Kerbalism copies the raw experiment id off the deleted
                    // SCANexperiment and never carries SCANsat's friendly name, and
                    // inventing one here would put a second vocabulary on the wire.
                    ["title"] = null,
                    ["deployed"] = producing,
                    // A map scanner is never spent and Kerbalism gives it no broken
                    // state, so there is a fact here and it is false.
                    ["inoperable"] = false,
                    // Scanning resumes by itself whenever coverage can grow again, so
                    // "can this be re-run" is not a question the module answers.
                    ["rerunnable"] = null,
                    ["resettable"] = null,
                    ["dataIsCollectable"] = false,
                    ["extensions"] = new Dictionary<string, object?>
                    {
                        [ProviderId] = new Dictionary<string, object?>
                        {
                            ["kind"] = "scanner",
                            ["issue"] = s.Issue,
                            ["scanning"] = s.Scanning,
                            ["powerDisabled"] = s.PowerDisabled,
                            ["bodyCoveragePercent"] = s.BodyCoveragePercent,
                            ["ecRate"] = s.EcRate,
                        },
                    },
                });
            }
            return list;
        }

        /// <summary>
        /// <c>science.sensors</c>: the one science payload that needs no extension
        /// bag at all. Kerbalism's <c>Sensor</c> and stock's
        /// <c>ModuleEnviroSensor</c> are the same shape (a type key, a formatted
        /// readout, an active flag); only the vocabulary of type values differs, and
        /// a free string already tolerates that.
        /// </summary>
        public static List<object?>? Sensors(ScienceRaw raw)
        {
            if (!raw.Modeled) return null;
            var list = new List<object?>();
            foreach (var s in raw.Sensors)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["partId"] = Text(s.PartId),
                    ["partName"] = s.PartName,
                    ["type"] = Text(s.Type),
                    ["readout"] = Text(s.Readout),
                    ["active"] = s.Active,
                });
            }
            return list;
        }

        /// <summary>
        /// <c>science.lab</c>. Kerbalism's lab is an intermediate stage, not a
        /// science producer, so the two science-valued core fields
        /// (<c>storedScience</c>, <c>scienceRate</c>) are null and the entry is
        /// tagged so a widget can tell that apart from an idle stock lab. Its
        /// data figures are megabytes, so the mits-typed <c>dataStored</c>/
        /// <c>dataStorage</c> pair is null too, with the rates in the bag.
        /// </summary>
        public static List<object?>? Lab(ScienceRaw raw)
        {
            if (!raw.Modeled) return null;
            var list = new List<object?>();
            foreach (var l in raw.Labs)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["partName"] = l.PartName,
                    ["dataStored"] = null,
                    ["dataStorage"] = null,
                    ["storedScience"] = null,
                    ["processingData"] = Same(l.Status, "RUNNING") || l.Running,
                    // Kerbalism's status IS the status text a stock lab would show,
                    // just typed: forwarded to both, so a widget that only reads the
                    // shared field still says something true.
                    ["statusText"] = Text(l.Status),
                    // Kerbalism bakes the researcher's level into the rate rather
                    // than exposing a headcount, so there is no count to report.
                    ["scientistCount"] = null,
                    ["scienceRate"] = null,
                    ["isOperational"] = !Same(l.Status, "DISABLED"),
                    ["valueModel"] = ValueModel,
                    ["extensions"] = new Dictionary<string, object?>
                    {
                        [ProviderId] = new Dictionary<string, object?>
                        {
                            ["analysisRateMBps"] = l.AnalysisRate,
                            ["effectiveRateMBps"] = l.EffectiveRate,
                            ["status"] = l.Status,
                        },
                    },
                });
            }
            return list;
        }

        /// <summary>
        /// <c>science.experimentBreakdown</c>: one entry per DISTINCT subject, with
        /// data summed across the stored blobs for it, exactly stock's contract.
        /// Kerbalism's per-subject ledger is far richer than the two fields core
        /// carries, so those two are the lossy view and the ledger rides the bag.
        /// </summary>
        public static List<object?>? ExperimentBreakdown(ScienceRaw raw)
        {
            if (!raw.Modeled) return null;

            // Insertion-ordered so the output is stable frame to frame: the
            // change-gate compares a list in order, so a reordering one would
            // read as a change on every tick and never be suppressed.
            var order = new List<string>();
            var bySubject = new Dictionary<string, ScienceStoredRaw>();
            var sizes = new Dictionary<string, double>();
            foreach (var s in raw.Stored)
            {
                var key = s.SubjectId ?? "";
                if (!bySubject.ContainsKey(key))
                {
                    order.Add(key);
                    bySubject[key] = s;
                    sizes[key] = 0;
                }
                sizes[key] += s.SizeMB;
            }

            var list = new List<object?>();
            foreach (var key in order)
            {
                var s = bySubject[key];
                list.Add(new Dictionary<string, object?>
                {
                    ["subjectId"] = Text(key),
                    ["biome"] = Text(s.Biome),
                    ["situation"] = Text(s.Situation),
                    ["expTitle"] = Text(s.Title),
                    // NULL on purpose: mits. The summed megabyte figure is in the
                    // per-entry bag on science.experiments, where the sizes it sums
                    // also live.
                    ["dataMits"] = null,
                    ["remainingPotential"] = s.ScienceRemainingTotal,
                    ["valueModel"] = ValueModel,
                    ["extensions"] = new Dictionary<string, object?>
                    {
                        [ProviderId] = new Dictionary<string, object?>
                        {
                            ["scienceRemainingTotal"] = s.ScienceRemainingTotal,
                            ["percentCollectedTotal"] = s.PercentCollectedTotal,
                            ["scienceCollectedInFlight"] = s.ScienceCollectedInFlight,
                            ["timesCompleted"] = s.TimesCompleted,
                        },
                    },
                });
            }
            return list;
        }

        /// <summary>
        /// Empty string to null, matching <c>SnapshotDict</c>'s rule on the stock
        /// path: an absent string is null on this wire, never "". A widget checking
        /// truthiness would otherwise see a present-but-blank field.
        /// </summary>
        private static object? Text(string? value) => string.IsNullOrEmpty(value) ? null : value;

        private static bool Same(string? a, string b) =>
            !string.IsNullOrEmpty(a) && string.Equals(a, b, System.StringComparison.OrdinalIgnoreCase);
    }
}
