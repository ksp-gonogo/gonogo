using System.Collections.Generic;

namespace Gonogo.KerbalismUplink
{
    // Plain cross-thread / cross-layer data carriers produced by KerbalismReflection
    // (the KSP-referencing shell) and consumed by KerbalismCapture (the pure mappers).
    // KSP-FREE by design so the headless Tests project can compile the mappers + these
    // together without any KSP/Unity/Kerbalism reference (same split as RA's
    // RaLinkBudget/RaLinkDown vs RaReflection).

    public sealed class KerbalRulesRaw
    {
        public string Name = "";
        public string Trait = "";
        public Dictionary<string, double> Rules = new();   // rule name -> accumulator value
    }

    public struct RuleConstants
    {
        public double DegenPerSec;      // Profile.rules[].degeneration
        public double FatalThreshold;   // Profile.rules[].fatal_threshold
    }

    public sealed class ProcessRaw
    {
        public string Resource = "";
        public string Title = "";
        public double Capacity;
        public bool Running;
        public bool Broken;
        /// <summary>Host part's KSP flightID. 0 when the part could not be read.</summary>
        public double FlightId;
        /// <summary>ProcessController.valve_i: which dump-valve combination is active.</summary>
        public int ValveIndex;
        /// <summary>
        /// Live Modifiers.Evaluate product over the matched profile Process's
        /// modifiers minus the capacity join token (this.Resource). Filled by
        /// KerbalismUplink.CaptureOnMain after joining against Profile().Processes
        /// (KerbalismReflection.Processes itself has no profile in scope). Null
        /// until then / when the join or the reflection call failed.
        /// </summary>
        public double? EnvModifier;
    }

    /// <summary>
    /// One Kerbalism <c>Harvester</c> module: the drill half of ISRU, which has no
    /// overlap at all with <see cref="ProcessRaw"/> (Kerbalism models extraction and
    /// conversion with two unrelated modules, the same split stock draws).
    /// </summary>
    public sealed class HarvesterRaw
    {
        /// <summary>Host part's KSP flightID. 0 when the part could not be read.</summary>
        public double FlightId;
        public string Resource = "";
        public bool Deployed;
        public bool Running;
        /// <summary>The live blocking-reason string. Empty when nothing is wrong, which is the normal case.</summary>
        public string Issue = "";
        /// <summary>0-3 are the stock-equivalent harvest situations, 4 is asteroid/comet.</summary>
        public int Type;
        /// <summary>Static config rate, calibrated against <see cref="AbundanceRate"/>. Not what is actually being extracted.</summary>
        public double Rate;
        /// <summary>The abundance level <see cref="Rate"/> is calibrated against.</summary>
        public double AbundanceRate;
        /// <summary>EC drawn per second, independent of abundance.</summary>
        public double EcRate;
        /// <summary>Live sampled abundance at the drill's position, 0..1. Null when unreadable.</summary>
        public double? Abundance;
        /// <summary>Rate after the abundance and crew adjustments: what is actually being extracted.</summary>
        public double? AdjustedRate;
        /// <summary>Asteroid/comet mining only: remaining rock mass. Null for every other harvest type.</summary>
        public double? SourceMassRemaining;
        /// <summary>Asteroid/comet mining only: the depletion threshold below which the source is exhausted.</summary>
        public double? SourceMassThreshold;
    }

    // ── Profile (static config) ──────────────────────────────────────────────
    // Kerbalism's own Profile.rules / .processes / .supplies, read once at load.
    // KSP-free like everything else here so the headless Tests project can
    // compile the mappers against captured fixtures.

    public sealed class RuleDefRaw
    {
        public string Name = "";
        public string Input = "";
        public string Output = "";
        public double Rate;
        /// <summary>Seconds. The rule fires ONCE PER INTERVAL; 0 means continuous.</summary>
        public double Interval;
        public double Degeneration;
        public double FatalThreshold;
        public bool Breakdown;
        public List<string> Modifiers = new();
    }

    public sealed class ProcessDefRaw
    {
        public string Name = "";
        public Dictionary<string, double> Inputs = new();
        public Dictionary<string, double> Outputs = new();
        /// <summary>Contains the pseudo-resource that joins to ProcessRaw.Resource.</summary>
        public List<string> Modifiers = new();
        public List<string> DumpValves = new();
    }

    public sealed class SupplyDefRaw
    {
        public string Resource = "";
        public double LowThreshold;
    }

    /// <summary>One KSP resource definition, for the resources the profile touches.</summary>
    public sealed class ResourceDefRaw
    {
        public string Name = "";
        public string DisplayName = "";
        public string FlowMode = "";
        public double Density;
    }

    public sealed class ProfileRaw
    {
        public string Name = "";
        public List<RuleDefRaw> Rules = new();
        public List<ProcessDefRaw> Processes = new();
        public List<SupplyDefRaw> Supplies = new();
        /// <summary>Keyed by resource name. Only the resources the profile mentions.</summary>
        public Dictionary<string, ResourceDefRaw> Resources = new();
    }

    // ── Solar vantage / storms (star-agnostic) ───────────────────────────────
    // KSP-free by design (Vector3d components carried as plain doubles, not the
    // UnityEngine type), same split as everything else in this file.

    /// <summary>One VesselData.EnvSunsInfo entry: this vessel's vantage on one star.</summary>
    public sealed class StarInfoRaw
    {
        /// <summary>Star body name (Sim.SunData.body.bodyName).</summary>
        public string Star = "";
        /// <summary>Normalized vessel-to-sun direction components (VesselData.SunInfo.Direction).</summary>
        public double DirX, DirY, DirZ;
        /// <summary>Vessel-to-sun-surface distance, metres (VesselData.SunInfo.Distance).</summary>
        public double Distance;
    }

    /// <summary>
    /// One (this vessel's current SOI body, star) CME slot. StormTime/StormDuration/Dist
    /// are only meaningful when StormState != 0; KerbalismReflection.Solar only
    /// fills them in that case, matching the contract's fair-vs-cheating rule.
    /// </summary>
    public sealed class StormEntryRaw
    {
        public string Star = "";
        /// <summary>StormData.storm_state: 0 none, 1 inbound, 2 in progress.</summary>
        public int StormState;
        public double? StormTime;
        public double? StormDuration;
        public double? Dist;
    }

    /// <summary>KerbalismReflection.Solar's return bundle: every star's vantage + every affected storm slot, for one vessel.</summary>
    public sealed class SolarRaw
    {
        public List<StarInfoRaw> Stars = new();
        public List<StormEntryRaw> Storms = new();
    }

    public sealed class ReliabilityRaw
    {
        public bool Malfunction;
        public bool Critical;
        public List<ReliabilityPartRaw> Parts = new();
    }

    public sealed class ReliabilityPartRaw
    {
        public string PartId = "";
        public string Title = "";
        public string Group = "";
        public bool Broken;
        public bool Critical;
        public double Mtbf;
        public double IgnitionsConsumed;
        public double DurationConsumed;
        public bool NeedsRepair;
    }

    // ── science (the elected "science" capability's Kerbalism provider) ───────
    // One capture per tick on the MAIN thread (KerbalismReflection.Science), mapped
    // off it on the Courier thread by KerbalismScienceMap. Nothing here holds a live
    // KSP/Kerbalism reference, which is what makes that hand-off legal.

    /// <summary>KerbalismReflection.Science's return bundle for one vessel.</summary>
    public sealed class ScienceRaw
    {
        /// <summary>True when the Kerbalism assembly is loaded AND the science feature is on. False makes the whole capture a no-op.</summary>
        public bool Modeled;
        public List<ScienceExperimentRaw> Experiments = new();
        public List<ScienceStoredRaw> Stored = new();
        public List<ScienceLabRaw> Labs = new();
        public List<ScienceSensorRaw> Sensors = new();
    }

    /// <summary>One Kerbalism <c>Experiment</c> PartModule: the instrument, running or not, data or not.</summary>
    public sealed class ScienceExperimentRaw
    {
        public string PartId = "";
        public string PartName = "";
        public string ExperimentId = "";
        public string Title = "";
        /// <summary>Kerbalism's own free-text reason production is blocked; empty when nothing is wrong.</summary>
        public string Issue = "";
        /// <summary>Stopped | Running | Forced | Broken (the simulated state).</summary>
        public string RunningState = "";
        /// <summary>Stopped | Running | Forced | Waiting | Issue | Broken (the derived display state).</summary>
        public string ExpStatus = "";
        public double DataRate;
        public double ProdFactor;
        public double? RemainingSampleMass;
        /// <summary>Whether the module takes a finite sample at all (drives whether RemainingSampleMass means anything).</summary>
        public bool TakesSample;
    }

    /// <summary>
    /// One file or sample sitting on a Kerbalism drive, plus that drive's capacity:
    /// the stored-result row core's <c>science.experiments</c> is a list of. The
    /// drive figures are repeated per entry rather than hoisted, because the topic
    /// has no per-part storage payload to hang them on and an operator reads
    /// "this result, on this drive, this full".
    /// </summary>
    public sealed class ScienceStoredRaw
    {
        public string PartId = "";
        public string PartName = "";
        public string SubjectId = "";
        public string ExperimentId = "";
        public string Title = "";
        public string Situation = "";
        public string Biome = "";
        /// <summary>"file" or "sample".</summary>
        public string Kind = "";
        public double SizeMB;
        public double? SampleMass;
        public bool? Analyze;
        public double SciencePerMB;
        public double ScienceMaxValue;
        public double ScienceRemainingTotal;
        public double PercentCollectedTotal;
        public double ScienceCollectedInFlight;
        public int TimesCompleted;
        public double TransmitRate;
        public bool Transmitting;
        /// <summary>Null when the drive is unlimited (Kerbalism's -1 sentinel), never a negative number.</summary>
        public double? DriveCapacityMB;
        public double DriveUsedMB;
        /// <summary>Null when sample slots are unlimited.</summary>
        public int? SampleSlotsTotal;
        public int SampleSlotsUsed;
    }

    /// <summary>One Kerbalism <c>Laboratory</c> PartModule.</summary>
    public sealed class ScienceLabRaw
    {
        public string PartId = "";
        public string PartName = "";
        public double AnalysisRate;
        public double EffectiveRate;
        /// <summary>DISABLED | NO_EC | NO_STORAGE | NO_SAMPLE | NO_RESEARCHER | RUNNING.</summary>
        public string Status = "";
        public bool Running;
    }

    /// <summary>One Kerbalism <c>Sensor</c> PartModule: pure live readout, no storage.</summary>
    public sealed class ScienceSensorRaw
    {
        public string PartId = "";
        public string PartName = "";
        public string Type = "";
        public string Readout = "";
        public bool Active;
    }
}
