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
}
