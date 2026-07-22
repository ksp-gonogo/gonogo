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
