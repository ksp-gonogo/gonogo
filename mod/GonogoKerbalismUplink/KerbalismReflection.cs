using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Reflection-only bridge to Kerbalism. No compile-time reference to
    /// Kerbalism.dll — every call degrades to null/empty on a moved/absent
    /// surface, so the uplink loads presence-safe. The reflection calls are
    /// ported verbatim from the proven mod/GonogoDevTools/GonogoDevKerbalismDump.cs,
    /// which performed exactly these reads against live Kerbalism 3.32 + CRP v112
    /// to produce local_docs/kerbalism-fixtures/. Mirrors the RaReflection.cs shape
    /// (probe assembly by name; cache handles once; typed-absence readers).
    /// </summary>
    public sealed class KerbalismReflection
    {
        private readonly Assembly? _asm;
        private readonly Type? _apiType;
        private readonly Type? _featuresType;
        private readonly Type? _dbType;
        private readonly Type? _profileType;
        private readonly Type? _reliabilityInfoType;
        private readonly MethodInfo? _dbKerbal;
        private readonly MethodInfo? _buildReliabilityList;
        private readonly Dictionary<string, MethodInfo> _apiVessel = new();
        private readonly Dictionary<string, MethodInfo> _apiVesselString = new();

        public bool IsAvailable => _asm != null && _apiType != null;

        public KerbalismReflection()
        {
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                var n = a.GetName().Name;
                if (string.Equals(n, "Kerbalism", StringComparison.OrdinalIgnoreCase)) { _asm = a; break; }
            }

            _apiType = FindType("KERBALISM.API") ?? FindType("Kerbalism.API") ?? FindType("Kerbalism.System.API");
            _featuresType = FindType("KERBALISM.Features") ?? FindType("Kerbalism.Features") ?? FindType("Kerbalism.System.Features");
            _dbType = FindType("KERBALISM.DB") ?? FindType("Kerbalism.DB");
            _profileType = FindType("KERBALISM.Profile") ?? FindType("Kerbalism.Profile");
            _reliabilityInfoType = FindType("KERBALISM.ReliabilityInfo") ?? FindType("Kerbalism.ReliabilityInfo");

            _dbKerbal = _dbType?.GetMethod("Kerbal", BindingFlags.Public | BindingFlags.Static);
            _buildReliabilityList = _reliabilityInfoType?.GetMethod("BuildList", BindingFlags.Public | BindingFlags.Static);

            if (_apiType != null)
            {
                foreach (var m in _apiType.GetMethods(BindingFlags.Public | BindingFlags.Static))
                {
                    var ps = m.GetParameters();
                    if (ps.Length == 1 && ps[0].ParameterType == typeof(Vessel))
                        _apiVessel[m.Name] = m;
                    else if (ps.Length == 2 && ps[0].ParameterType == typeof(Vessel) && ps[1].ParameterType == typeof(string))
                        _apiVesselString[m.Name] = m;
                }
            }
        }

        /// <summary>Invoke a public static (Vessel)->double API method (Radiation, Pressure, Comfort, …).</summary>
        public double? Api(string method, Vessel v) => AsDouble(InvokeVessel(method, v));

        /// <summary>Invoke a public static (Vessel)->bool API method (Magnetosphere, InnerBelt, StormIncoming, …).</summary>
        public bool? ApiBool(string method, Vessel v) => InvokeVessel(method, v) as bool?;

        /// <summary>Invoke a public static (Vessel,string)->double API method (ResourceAmount/Capacity/AverageRate).</summary>
        public double? ApiResource(string method, Vessel v, string resource) =>
            AsDouble(InvokeVesselString(method, v, resource));

        private object? InvokeVessel(string method, Vessel v)
        {
            if (v == null || !_apiVessel.TryGetValue(method, out var m)) return null;
            try { return m.Invoke(null, new object[] { v }); } catch { return null; }
        }

        private object? InvokeVesselString(string method, Vessel v, string resource)
        {
            if (v == null || !_apiVesselString.TryGetValue(method, out var m)) return null;
            try { return m.Invoke(null, new object[] { v, resource }); } catch { return null; }
        }

        /// <summary>KERBALISM.Features.* public static bools (unmodeled-vs-healthy gates).</summary>
        public IReadOnlyDictionary<string, bool> Features()
        {
            var result = new Dictionary<string, bool>();
            if (_featuresType == null) return result;
            foreach (var f in _featuresType.GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                if (f.FieldType != typeof(bool)) continue;
                try { result[f.Name] = (bool)(f.GetValue(null) ?? false); } catch { }
            }
            return result;
        }

        /// <summary>Per-kerbal rule accumulator VALUES via KERBALISM.DB.Kerbal(name).rules[name].problem.</summary>
        public IEnumerable<KerbalRulesRaw> CrewRules(Vessel v)
        {
            if (v == null || v.GetVesselCrew() == null) yield break;
            foreach (var c in v.GetVesselCrew())
            {
                var rules = new Dictionary<string, double>();
                object? kd = null;
                try { kd = _dbKerbal?.Invoke(null, new object[] { c.name }); } catch { }
                if (kd != null)
                {
                    var rulesField = kd.GetType().GetField("rules",
                        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    if (rulesField?.GetValue(kd) is IDictionary dict)
                    {
                        foreach (DictionaryEntry e in dict)
                        {
                            object? problem = null;
                            try { problem = e.Value?.GetType().GetField("problem")?.GetValue(e.Value); } catch { }
                            if (AsDouble(problem) is double d) rules[Convert.ToString(e.Key) ?? ""] = d;
                        }
                    }
                }
                yield return new KerbalRulesRaw { Name = c.name, Trait = c.trait, Rules = rules };
            }
        }

        /// <summary>
        /// Per-rule config CONSTANTS from the loaded KERBALISM.Profile.rules[] —
        /// degeneration (units/s) + fatal_threshold. Static / vessel-independent
        /// (resolved fresh each call; the list is small). These are NOT in the
        /// KerbalData accumulator the dump tool captured; they feed the stage-2
        /// death-clock. Verified against Kerbalism source (not just inferred):
        /// `Profile.rules` is `public static List&lt;Rule&gt;` (Profile/Profile.cs),
        /// and `Rule.name`/`Rule.degeneration`/`Rule.fatal_threshold` are public
        /// instance fields (Profile/Rule.cs) — field names/types below match
        /// exactly. `fatal_threshold` genuinely varies per rule: the default
        /// profile leaves it at the Rule.cs ctor default of 1.0 for every rule
        /// except radiation, which overrides it to 50.0
        /// (GameData/KerbalismConfig/Profiles/Default.cfg's `radiation` Rule
        /// block) — confirming the CrewManifest widget's per-rule
        /// value/fatalThreshold normalization is correct, not a hardcoded-1.0 bug.
        /// </summary>
        public IReadOnlyDictionary<string, RuleConstants> RuleConstants()
        {
            var result = new Dictionary<string, RuleConstants>();
            var rulesField = _profileType?.GetField("rules", BindingFlags.Public | BindingFlags.Static);
            if (rulesField?.GetValue(null) is IEnumerable rules)
            {
                foreach (var rule in rules)
                {
                    if (rule == null) continue;
                    var t = rule.GetType();
                    string? name = null;
                    try { name = t.GetField("name")?.GetValue(rule) as string; } catch { }
                    if (string.IsNullOrEmpty(name)) continue;
                    double degen = 0, fatal = 0;
                    try { degen = AsDouble(t.GetField("degeneration")?.GetValue(rule)) ?? 0; } catch { }
                    try { fatal = AsDouble(t.GetField("fatal_threshold")?.GetValue(rule)) ?? 0; } catch { }
                    result[name!] = new RuleConstants { DegenPerSec = degen, FatalThreshold = fatal };
                }
            }
            return result;
        }

        /// <summary>ProcessController PartModules on the vessel (scrubber/recycler/fuel cell).</summary>
        public IEnumerable<ProcessRaw> Processes(Vessel v)
        {
            if (v?.parts == null) yield break;
            foreach (var part in v.parts)
            {
                if (part.Modules == null) continue;
                foreach (PartModule pm in part.Modules)
                {
                    if (pm == null) continue;
                    if (pm.GetType().Name.IndexOf("ProcessController", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    yield return new ProcessRaw
                    {
                        Resource = MemberString(pm, "resource") ?? "",
                        Title = MemberString(pm, "title") ?? "",
                        Capacity = MemberDouble(pm, "capacity") ?? 0,
                        Running = MemberBool(pm, "running") ?? MemberBool(pm, "toggle") ?? false,
                        Broken = MemberBool(pm, "broken") ?? false,
                    };
                }
            }
        }

        /// <summary>
        /// Vessel reliability: API.Malfunction/Critical bools + the per-part list
        /// from KERBALISM.ReliabilityInfo.BuildList(Vessel) (fields
        /// title/group/broken/critical/partId/mtbf/rel_duration/rel_ignitions +
        /// NeedsMaintenance()). [fixture-confirm] the exact ReliabilityInfo shape;
        /// per-part reads degrade to an empty list when the type moved.
        /// </summary>
        public ReliabilityRaw Reliability(Vessel v)
        {
            var raw = new ReliabilityRaw
            {
                Malfunction = ApiBool("Malfunction", v) ?? false,
                Critical = ApiBool("Critical", v) ?? false,
            };
            if (_buildReliabilityList != null && v != null)
            {
                object? list = null;
                try { list = _buildReliabilityList.Invoke(null, new object[] { v }); } catch { }
                if (list is IEnumerable entries)
                {
                    foreach (var e in entries)
                    {
                        if (e == null) continue;
                        raw.Parts.Add(new ReliabilityPartRaw
                        {
                            PartId = MemberString(e, "partId") ?? "",
                            Title = MemberString(e, "title") ?? "",
                            Group = MemberString(e, "group") ?? "",
                            Broken = MemberBool(e, "broken") ?? false,
                            Critical = MemberBool(e, "critical") ?? false,
                            Mtbf = MemberDouble(e, "mtbf") ?? 0,
                            IgnitionsConsumed = MemberDouble(e, "rel_ignitions") ?? 0,
                            DurationConsumed = MemberDouble(e, "rel_duration") ?? 0,
                            NeedsRepair = InvokeBoolMethod(e, "NeedsMaintenance") ?? false,
                        });
                    }
                }
            }
            return raw;
        }

        // ── member readers (field-or-property, fail-soft) ──────────────────────

        private static object? Member(object obj, string name)
        {
            var t = obj.GetType();
            var f = t.GetField(name, BindingFlags.Public | BindingFlags.Instance);
            if (f != null) { try { return f.GetValue(obj); } catch { return null; } }
            var p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (p != null) { try { return p.GetValue(obj); } catch { return null; } }
            return null;
        }
        private static string? MemberString(object obj, string name) => Member(obj, name) as string;
        private static double? MemberDouble(object obj, string name) => AsDouble(Member(obj, name));
        private static bool? MemberBool(object obj, string name) => Member(obj, name) as bool?;

        private static bool? InvokeBoolMethod(object obj, string name)
        {
            var m = obj.GetType().GetMethod(name, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (m == null) return null;
            try { return m.Invoke(obj, null) as bool?; } catch { return null; }
        }

        private Type? FindType(string fullName)
        {
            if (_asm != null) { try { var t = _asm.GetType(fullName); if (t != null) return t; } catch { } }
            foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            {
                try { var t = a.GetType(fullName); if (t != null) return t; } catch { }
            }
            return null;
        }

        private static double? AsDouble(object? o)
        {
            if (o == null) return null;
            try { return Convert.ToDouble(o); } catch { return null; }
        }
    }
}
