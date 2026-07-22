using System.Collections.Generic;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Pure plain-data mappers: a captured snapshot -> the value-tree dictionaries
    /// that mirror the Sitrep.Contract Kerbalism POCOs field-for-field (camelCase
    /// wire keys). NO KSP/Unity/Kerbalism types — headless-testable against the
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

        private static Dictionary<string, object?> Res(double a, double c, double r) =>
            new() { ["amount"] = a, ["capacity"] = c, ["rate"] = r };

        public static Dictionary<string, object?> BuildLifeSupport(KerbalismSnapshot s, List<ProcessRaw> processes)
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
                });

            return new Dictionary<string, object?>
            {
                ["food"] = Res(s.FoodAmount, s.FoodCapacity, s.FoodRate),
                ["water"] = Res(s.WaterAmount, s.WaterCapacity, s.WaterRate),
                ["oxygen"] = Res(s.OxygenAmount, s.OxygenCapacity, s.OxygenRate),
                ["electricCharge"] = Res(s.EcAmount, s.EcCapacity, s.EcRate),
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
        public double FoodAmount, FoodCapacity, FoodRate;
        public double WaterAmount, WaterCapacity, WaterRate;
        public double OxygenAmount, OxygenCapacity, OxygenRate;
        public double EcAmount, EcCapacity, EcRate;
        public double Pressure, Poisoning, Shielding, LivingSpace, Comfort, Volume, Surface;
    }
}
