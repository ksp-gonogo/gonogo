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
