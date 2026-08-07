using System;
using System.Collections.Generic;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Pure plain-data mappers: a captured snapshot -> the value-tree dictionaries
    /// that mirror the Sitrep.Contract Kerbalism POCOs field-for-field (camelCase
    /// wire keys). NO KSP/Unity/Kerbalism types: headless-testable against the
    /// captured fixtures (local_docs/kerbalism-fixtures/). The uplink's
    /// capture-on-main reflection (KerbalismReflection) fills KerbalismSnapshot +
    /// the *Raw lists; these mappers run off the main thread (Courier).
    /// </summary>
    public static class KerbalismCapture
    {
        public static Dictionary<string, object?> BuildSpaceWeather(KerbalismSnapshot s) => new()
        {
            ["radiationRadPerSecond"] = s.Radiation,
            ["habitatRadiationRadPerSecond"] = s.HabitatRadiation,
            ["magnetosphere"] = s.Magnetosphere,
            ["innerBelt"] = s.InnerBelt,
            ["outerBelt"] = s.OuterBelt,
            ["stormIncoming"] = s.StormIncoming,
            ["stormInProgress"] = s.StormInProgress,
            ["blackout"] = s.Blackout,
            ["inSunlight"] = s.InSunlight,
            ["shieldingAmount"] = s.ShieldingAmount,
            ["shieldingCapacity"] = s.ShieldingCapacity,
        };

        /// <summary>
        /// The resources the life-support ledger reports a rate for: the union of
        /// every rule input/output, every process input/output and every Supply in
        /// the loaded profile. Pseudo-resources (the leading-underscore tokens
        /// Kerbalism uses to gate a process, e.g. "_Scrubber") are excluded, they
        /// are plumbing, not consumables.
        ///
        /// <para>THE authoritative list, and deliberately the ONLY one. It drives
        /// both which names <c>CaptureOnMain</c> asks Kerbalism for a rate about and
        /// what <c>kerbalism.profile</c> declares, so the two cannot drift; a second
        /// list anywhere would be the old hardcoding in a new disguise. Asserted by
        /// <c>LifeSupportResourceCoverageTests</c>.</para>
        /// </summary>
        public static List<string> ResourceNames(ProfileRaw profile)
        {
            var seen = new SortedSet<string>(StringComparer.Ordinal);
            void Add(string? name)
            {
                if (!string.IsNullOrEmpty(name) && !name!.StartsWith("_", StringComparison.Ordinal))
                    seen.Add(name);
            }

            foreach (var r in profile.Rules) { Add(r.Input); Add(r.Output); }
            foreach (var p in profile.Processes)
            {
                foreach (var k in p.Inputs.Keys) Add(k);
                foreach (var k in p.Outputs.Keys) Add(k);
            }
            foreach (var s in profile.Supplies) Add(s.Resource);
            return new List<string>(seen);
        }

        /// <summary>
        /// The loaded profile's own definitions (Topic "kerbalism.profile"). Pure:
        /// no KSP, no Kerbalism, fixture-testable.
        /// </summary>
        public static Dictionary<string, object?> BuildProfile(ProfileRaw profile)
        {
            var lowThresholds = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var s in profile.Supplies)
                if (!string.IsNullOrEmpty(s.Resource)) lowThresholds[s.Resource] = s.LowThreshold;

            var resources = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var name in ResourceNames(profile))
            {
                profile.Resources.TryGetValue(name, out var def);
                var isSupply = lowThresholds.TryGetValue(name, out var low);
                resources[name] = new Dictionary<string, object?>
                {
                    ["flowMode"] = def?.FlowMode ?? "",
                    ["displayName"] = def?.DisplayName ?? name,
                    ["density"] = def?.Density ?? 0,
                    ["isSupply"] = isSupply,
                    ["lowThreshold"] = isSupply ? low : (double?)null,
                };
            }

            var rules = new List<object>();
            foreach (var r in profile.Rules)
                rules.Add(new Dictionary<string, object?>
                {
                    ["name"] = r.Name,
                    ["input"] = r.Input,
                    ["output"] = r.Output,
                    // The whole reason this field exists: a Rule with an interval
                    // consumes `rate` ONCE PER INTERVAL. Dividing here, once, is
                    // what stops every consumer rediscovering that the hard way.
                    ["ratePerSecond"] = r.Interval > 0 ? r.Rate / r.Interval : r.Rate,
                    ["rate"] = r.Rate,
                    ["interval"] = r.Interval,
                    ["degeneration"] = r.Degeneration,
                    ["fatalThreshold"] = r.FatalThreshold,
                    ["breakdown"] = r.Breakdown,
                    ["modifiers"] = new List<object>(r.Modifiers),
                });

            var processes = new List<object>();
            foreach (var p in profile.Processes)
                processes.Add(new Dictionary<string, object?>
                {
                    ["name"] = p.Name,
                    ["inputs"] = new Dictionary<string, object?>(
                        Cast(p.Inputs), StringComparer.Ordinal),
                    ["outputs"] = new Dictionary<string, object?>(
                        Cast(p.Outputs), StringComparer.Ordinal),
                    ["modifiers"] = new List<object>(p.Modifiers),
                    ["dumpValves"] = new List<object>(p.DumpValves),
                });

            return new Dictionary<string, object?>
            {
                ["name"] = profile.Name,
                ["resources"] = resources,
                ["rules"] = rules,
                ["processes"] = processes,
            };
        }

        private static Dictionary<string, object?> Cast(Dictionary<string, double> src)
        {
            var outMap = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var kv in src) outMap[kv.Key] = kv.Value;
            return outMap;
        }

        public static Dictionary<string, object?> BuildLifeSupport(
            KerbalismSnapshot s,
            List<ProcessRaw> processes,
            IReadOnlyDictionary<string, double>? rates = null)
        {
            var procs = new List<object>();
            foreach (var p in processes)
                procs.Add(new Dictionary<string, object?>
                {
                    ["resource"] = p.Resource,
                    ["title"] = p.Title,
                    ["capacity"] = p.Capacity,
                    ["running"] = p.Running,
                    ["broken"] = p.Broken,
                    ["flightId"] = p.FlightId,
                    ["valveIndex"] = p.ValveIndex,
                });

            // Full map every emission, never a delta: a key disappearing is then
            // itself a real statement (vessel.resources' own convention).
            var rateMap = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (rates != null)
                foreach (var kv in rates) rateMap[kv.Key] = kv.Value;

            return new Dictionary<string, object?>
            {
                ["rates"] = rateMap,
                ["habitat"] = new Dictionary<string, object?>
                {
                    ["pressure"] = s.Pressure,
                    ["poisoning"] = s.Poisoning,
                    ["shielding"] = s.Shielding,
                    ["livingSpace"] = s.LivingSpace,
                    ["comfort"] = s.Comfort,
                    ["volume"] = s.Volume,
                    ["surface"] = s.Surface,
                },
                ["processes"] = procs,
            };
        }

        public static List<object> BuildCrew(
            IEnumerable<KerbalRulesRaw> crew,
            IReadOnlyDictionary<string, RuleConstants> constants)
        {
            var list = new List<object>();
            foreach (var k in crew)
            {
                var rules = new List<object>();
                foreach (var kv in k.Rules)
                {
                    constants.TryGetValue(kv.Key, out var c);   // default (0,0) when unknown
                    rules.Add(new Dictionary<string, object?>
                    {
                        ["name"] = kv.Key,
                        ["value"] = kv.Value,
                        ["degenPerSec"] = c.DegenPerSec,
                        ["fatalThreshold"] = c.FatalThreshold,
                    });
                }
                list.Add(new Dictionary<string, object?>
                {
                    ["name"] = k.Name,
                    ["trait"] = k.Trait,
                    ["rules"] = rules,
                    // deathClockSec: null until rule->resource linkage is confirmed; the client
                    // derives stage-1 (resource time-to-empty from kerbalism.lifesupport) +
                    // stage-2 (this rule's (fatalThreshold - value)/degenPerSec).
                    ["deathClockSec"] = null,
                });
            }
            return list;
        }

        public static Dictionary<string, object?> BuildFeatures(IReadOnlyDictionary<string, bool> f)
        {
            bool G(string k) => f.TryGetValue(k, out var v) && v;
            return new Dictionary<string, object?>
            {
                ["reliability"] = G("Reliability"),
                ["radiation"] = G("Radiation"),
                ["spaceWeather"] = G("SpaceWeather"),
                ["shielding"] = G("Shielding"),
                ["livingSpace"] = G("LivingSpace"),
                ["comfort"] = G("Comfort"),
                ["poisoning"] = G("Poisoning"),
                ["pressure"] = G("Pressure"),
                ["habitat"] = G("Habitat"),
                ["supplies"] = G("Supplies"),
                ["science"] = G("Science"),
                ["automation"] = G("Automation"),
                ["deploy"] = G("Deploy"),
            };
        }
    }

    /// <summary>Plain scalar snapshot of one vessel's Kerbalism state (KSP-free).</summary>
    public struct KerbalismSnapshot
    {
        public double Radiation, HabitatRadiation, ShieldingAmount, ShieldingCapacity;
        public bool Magnetosphere, InnerBelt, OuterBelt, StormIncoming, StormInProgress, Blackout, InSunlight;
        public double Pressure, Poisoning, Shielding, LivingSpace, Comfort, Volume, Surface;
        /// <summary>
        /// Signed net rate per resource (units/s), keyed by KSP resource name.
        /// Replaced the Food/Water/Oxygen/ElectricCharge triples: those were four
        /// of the twelve the default profile runs on, and were spelled out in
        /// three separate files. The names here come from
        /// <see cref="KerbalismCapture.ResourceNames"/> reading the loaded
        /// profile, never from a list in gonogo.
        /// </summary>
        public Dictionary<string, double> Rates;
    }
}
