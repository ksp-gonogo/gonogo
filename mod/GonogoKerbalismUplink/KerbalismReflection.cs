using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using UnityEngine;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// Reflection-only bridge to Kerbalism. No compile-time reference to
    /// Kerbalism.dll: every call degrades to null/empty on a moved/absent
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
        private readonly Type? _stormType;
        private readonly Type? _modifiersType;
        private readonly Type? _prefsRadiationType;
        private readonly Type? _resourceCacheType;
        private readonly Type? _ruleType;
        private readonly MethodInfo? _ruleVariance;
        private readonly MethodInfo? _dbKerbal;
        private readonly MethodInfo? _buildReliabilityList;
        private readonly MethodInfo? _dbStorm;
        private readonly MethodInfo? _stormKeyMethod;
        private readonly MethodInfo? _dbKerbalismData;
        private readonly MethodInfo? _resourceCacheGet;
        private readonly MethodInfo? _modifiersEvaluate;
        private readonly PropertyInfo? _prefsRadiationInstanceProp;
        private readonly PropertyInfo? _stormEjectionSpeedProp;
        private readonly Dictionary<string, MethodInfo> _apiVessel = new();
        private readonly Dictionary<string, MethodInfo> _apiVesselString = new();

        // ── drive actuation (File Manager commands) ─────────────────────────
        private readonly Type? _driveType;
        private readonly Type? _scienceDbType;
        private readonly MethodInfo? _getSubjectDataFromStockId;
        private readonly MethodInfo? _driveSend;
        private readonly MethodInfo? _driveDeleteFile;
        private readonly MethodInfo? _driveDeleteSample;
        private readonly MethodInfo? _driveAnalyze;
        private readonly MethodInfo? _driveRecordSample;
        private readonly MethodInfo? _driveSampleCapacityAvailable;

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
            _stormType = FindType("KERBALISM.Storm") ?? FindType("Kerbalism.Storm");
            _modifiersType = FindType("KERBALISM.Modifiers") ?? FindType("Kerbalism.Modifiers");
            _prefsRadiationType = FindType("KERBALISM.PreferencesRadiation") ?? FindType("Kerbalism.PreferencesRadiation");
            _resourceCacheType = FindType("KERBALISM.ResourceCache") ?? FindType("Kerbalism.ResourceCache");
            _ruleType = FindType("KERBALISM.Rule") ?? FindType("Kerbalism.Rule");
            // Rule.Variance(name, crewMember, variance) is private static. Asked
            // rather than reimplemented because it hashes a string built from the
            // kerbal's courage and stupidity FORMATTED, so a reimplementation
            // would have to match Kerbalism's number formatting to land on the
            // same multiplier, and would silently disagree if it did not.
            _ruleVariance = _ruleType?.GetMethod(
                "Variance", BindingFlags.NonPublic | BindingFlags.Static, null,
                new[] { typeof(string), typeof(ProtoCrewMember), typeof(double) }, null);

            _dbKerbal = _dbType?.GetMethod("Kerbal", BindingFlags.Public | BindingFlags.Static);
            _buildReliabilityList = _reliabilityInfoType?.GetMethod("BuildList", BindingFlags.Public | BindingFlags.Static);
            _dbStorm = _dbType?.GetMethod("Storm", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(string) }, null);
            _stormKeyMethod = _stormType?.GetMethod(
                "StormKey", BindingFlags.Public | BindingFlags.Static, null,
                new[] { typeof(CelestialBody), typeof(CelestialBody) }, null);
            _dbKerbalismData = _dbType?.GetMethod(
                "KerbalismData", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(Vessel) }, null);
            _resourceCacheGet = _resourceCacheType?.GetMethod(
                "Get", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(Vessel) }, null);
            _prefsRadiationInstanceProp = _prefsRadiationType?.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static);
            _stormEjectionSpeedProp = _prefsRadiationType?.GetProperty("StormEjectionSpeed", BindingFlags.Public | BindingFlags.Instance);

            if (_modifiersType != null)
            {
                // Two overloads named Evaluate exist (the live-vessel one and the
                // VAB/SPH planner one over EnvironmentAnalyzer/VesselAnalyzer); pick
                // the one whose first parameter is Vessel and whose last is
                // List<string>, which uniquely identifies the live-vessel overload.
                foreach (var m in _modifiersType.GetMethods(BindingFlags.Public | BindingFlags.Static))
                {
                    if (m.Name != "Evaluate") continue;
                    var ps = m.GetParameters();
                    if (ps.Length == 4 && ps[0].ParameterType == typeof(Vessel) && ps[3].ParameterType == typeof(List<string>))
                    {
                        _modifiersEvaluate = m;
                        break;
                    }
                }
            }

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

            // Drive actuation: every method below has exactly one overload in
            // Kerbalism's Drive/ScienceDB (ground-truthed against
            // src/Kerbalism/Science/Drive.cs and ScienceDB.cs), so a plain
            // name lookup is unambiguous, unlike Modifiers.Evaluate above.
            _driveType = FindType("KERBALISM.Drive") ?? FindType("Kerbalism.Drive");
            _scienceDbType = FindType("KERBALISM.ScienceDB") ?? FindType("Kerbalism.ScienceDB");
            _getSubjectDataFromStockId = _scienceDbType?.GetMethod("GetSubjectDataFromStockId", BindingFlags.Public | BindingFlags.Static);
            _driveSend = _driveType?.GetMethod("Send", BindingFlags.Public | BindingFlags.Instance);
            _driveDeleteFile = _driveType?.GetMethod("Delete_file", BindingFlags.Public | BindingFlags.Instance);
            _driveDeleteSample = _driveType?.GetMethod("Delete_sample", BindingFlags.Public | BindingFlags.Instance);
            _driveAnalyze = _driveType?.GetMethod("Analyze", BindingFlags.Public | BindingFlags.Instance);
            _driveRecordSample = _driveType?.GetMethod("Record_sample", BindingFlags.Public | BindingFlags.Instance);
            _driveSampleCapacityAvailable = _driveType?.GetMethod("SampleCapacityAvailable", BindingFlags.Public | BindingFlags.Instance);
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
        /// Per-rule config CONSTANTS from the loaded KERBALISM.Profile.rules[],
        /// degeneration (units/s) + fatal_threshold. Static / vessel-independent
        /// (resolved fresh each call; the list is small). These are NOT in the
        /// KerbalData accumulator the dump tool captured; they feed the stage-2
        /// death-clock. Verified against Kerbalism source (not just inferred):
        /// `Profile.rules` is `public static List&lt;Rule&gt;` (Profile/Profile.cs),
        /// and `Rule.name`/`Rule.degeneration`/`Rule.fatal_threshold` are public
        /// instance fields (Profile/Rule.cs): field names/types below match
        /// exactly. `fatal_threshold` genuinely varies per rule: the default
        /// profile leaves it at the Rule.cs ctor default of 1.0 for every rule
        /// except radiation, which overrides it to 50.0
        /// (GameData/KerbalismConfig/Profiles/Default.cfg's `radiation` Rule
        /// block): confirming the CrewStatus widget's per-rule
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

        /// <summary>
        /// ProcessController PartModules on the vessel (scrubber/recycler/fuel cell).
        /// <c>Resource</c> is the PSEUDO-resource the controller gates on ("_Scrubber"),
        /// which joins onto the profile Process whose modifier list contains it;
        /// <c>FlightId</c> is the host part, so a ledger row can say WHERE.
        /// </summary>
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
                        FlightId = part.flightID,
                        ValveIndex = (int)(MemberDouble(pm, "valve_i") ?? 0),
                    };
                }
            }
        }

        /// <summary>
        /// Every Kerbalism <c>Harvester</c> on the vessel: the drill half of ISRU.
        ///
        /// <para>Matched on the EXACT type name rather than a substring, unlike
        /// <see cref="Processes"/>'s <c>ProcessController</c> match. Stock's own
        /// module is <c>ModuleResourceHarvester</c>, which contains "Harvester", so a
        /// substring match would sweep stock parts into the Kerbalism reader on any
        /// install where both survive and report Kerbalism-shaped nulls for all of
        /// them.</para>
        ///
        /// <para><c>AdjustedRate</c> is read as a property or a parameterless method,
        /// because it is the one member here whose shape is a Kerbalism implementation
        /// detail rather than a config field. The asteroid/comet source mass is
        /// best-effort: null when the harvest source cannot be reached, never a
        /// guess.</para>
        /// </summary>
        public IEnumerable<HarvesterRaw> Harvesters(Vessel v)
        {
            if (v?.parts == null) yield break;
            foreach (var part in v.parts)
            {
                if (part.Modules == null) continue;
                foreach (PartModule pm in part.Modules)
                {
                    if (pm == null) continue;
                    if (!string.Equals(pm.GetType().Name, "Harvester", StringComparison.Ordinal)) continue;

                    var raw = new HarvesterRaw
                    {
                        FlightId = part.flightID,
                        Resource = MemberString(pm, "resource") ?? "",
                        Deployed = MemberBool(pm, "deployed") ?? false,
                        Running = MemberBool(pm, "running") ?? false,
                        Issue = MemberString(pm, "issue") ?? "",
                        Type = (int)(MemberDouble(pm, "type") ?? 0),
                        Rate = MemberDouble(pm, "rate") ?? 0,
                        AbundanceRate = MemberDouble(pm, "abundance_rate") ?? 0,
                        EcRate = MemberDouble(pm, "ec_rate") ?? 0,
                        Abundance = MemberDouble(pm, "abundance"),
                        AdjustedRate = MemberDouble(pm, "AdjustedRate") ?? InvokeDoubleMethod(pm, "AdjustedRate"),
                    };

                    var source = Member(pm, "source") ?? Member(pm, "harvest_source") ?? Member(pm, "HarvestSource");
                    if (source != null)
                    {
                        raw.SourceMassRemaining = MemberDouble(source, "mass");
                        raw.SourceMassThreshold = MemberDouble(source, "mass_threshold");
                    }

                    yield return raw;
                }
            }
        }

        /// <summary>
        /// The loaded profile's own static definitions: <c>Profile.rules</c>,
        /// <c>Profile.processes</c>, <c>Profile.supplies</c>, plus a KSP resource
        /// definition for every resource they mention.
        ///
        /// <para>This is what lets gonogo carry NO list of resource names. Read once
        /// (the caller caches): these are static after load and do not change
        /// within a session.</para>
        /// </summary>
        public ProfileRaw Profile()
        {
            var profile = new ProfileRaw();
            if (_profileType == null) return profile;

            foreach (var rule in StaticList("rules"))
            {
                var t = rule.GetType();
                var name = Field<string>(rule, t, "name");
                if (string.IsNullOrEmpty(name)) continue;
                profile.Rules.Add(new RuleDefRaw
                {
                    Name = name!,
                    Input = Field<string>(rule, t, "input") ?? "",
                    Output = Field<string>(rule, t, "output") ?? "",
                    Rate = FieldDouble(rule, t, "rate"),
                    Interval = FieldDouble(rule, t, "interval"),
                    Degeneration = FieldDouble(rule, t, "degeneration"),
                    FatalThreshold = FieldDouble(rule, t, "fatal_threshold"),
                    Breakdown = Field<bool?>(rule, t, "breakdown") ?? false,
                    Variance = FieldDouble(rule, t, "variance"),
                    Modifiers = StringList(rule, t, "modifiers"),
                });
            }

            foreach (var proc in StaticList("processes"))
            {
                var t = proc.GetType();
                var name = Field<string>(proc, t, "name");
                if (string.IsNullOrEmpty(name)) continue;
                profile.Processes.Add(new ProcessDefRaw
                {
                    Name = name!,
                    Inputs = RateMap(proc, t, "inputs"),
                    Outputs = RateMap(proc, t, "outputs"),
                    Modifiers = StringList(proc, t, "modifiers"),
                    DumpValves = DumpValves(proc, t),
                });
            }

            foreach (var supply in StaticList("supplies"))
            {
                var t = supply.GetType();
                var resource = Field<string>(supply, t, "resource");
                if (string.IsNullOrEmpty(resource)) continue;
                profile.Supplies.Add(new SupplyDefRaw
                {
                    Resource = resource!,
                    LowThreshold = FieldDouble(supply, t, "low_threshold"),
                });
            }

            profile.Name = ProfileName();
            foreach (var name in KerbalismCapture.ResourceNames(profile))
            {
                var def = PartResourceLibrary.Instance?.GetDefinition(name);
                if (def == null) continue;
                profile.Resources[name] = new ResourceDefRaw
                {
                    Name = name,
                    DisplayName = string.IsNullOrEmpty(def.displayName) ? name : def.displayName,
                    FlowMode = def.resourceFlowMode.ToString(),
                    // The ordinal is what the client's pooled verdict reads; the
                    // name is its display label.
                    FlowModeOrdinal = (int)def.resourceFlowMode,
                    Density = def.density,
                };
            }
            return profile;
        }

        /// <summary>
        /// The loaded profile's name. Kerbalism stores it on Settings rather than
        /// Profile; an empty string is fine, it is display/fixture keying only and
        /// never a behavioural switch.
        /// </summary>
        private string ProfileName()
        {
            var settings = FindType("KERBALISM.Settings") ?? FindType("Kerbalism.Settings");
            var field = settings?.GetField("Profile", BindingFlags.Public | BindingFlags.Static);
            try { return field?.GetValue(null) as string ?? ""; } catch { return ""; }
        }

        private IEnumerable<object> StaticList(string fieldName)
        {
            var field = _profileType?.GetField(fieldName, BindingFlags.Public | BindingFlags.Static);
            object? value = null;
            try { value = field?.GetValue(null); } catch { }
            if (value is not IEnumerable items) yield break;
            foreach (var item in items)
                if (item != null) yield return item;
        }

        private static T? Field<T>(object obj, Type t, string name)
        {
            try { return t.GetField(name)?.GetValue(obj) is T v ? v : default; }
            catch { return default; }
        }

        private static double FieldDouble(object obj, Type t, string name)
        {
            try { return AsDouble(t.GetField(name)?.GetValue(obj)) ?? 0; } catch { return 0; }
        }

        private static List<string> StringList(object obj, Type t, string name)
        {
            var result = new List<string>();
            object? value = null;
            try { value = t.GetField(name)?.GetValue(obj); } catch { }
            if (value is IEnumerable items)
                foreach (var item in items)
                    if (item is string s && s.Length > 0) result.Add(s);
            return result;
        }

        /// <summary>
        /// A Process's inputs/outputs: Kerbalism holds these as
        /// <c>Dictionary&lt;string, double&gt;</c> of resource name -> rate per unit
        /// of process capacity, per second.
        /// </summary>
        private static Dictionary<string, double> RateMap(object obj, Type t, string name)
        {
            var result = new Dictionary<string, double>(StringComparer.Ordinal);
            object? value = null;
            try { value = t.GetField(name)?.GetValue(obj); } catch { }
            if (value is IDictionary dict)
                foreach (DictionaryEntry entry in dict)
                    if (entry.Key is string key)
                        result[key] = AsDouble(entry.Value) ?? 0;
            return result;
        }

        /// <summary>
        /// The Process's dump_valve options, in the profile's declared order, so
        /// ProcessController.valve_i indexes into the same list. Kerbalism models
        /// this as a DumpSpecs with a list of resource-name combinations; the shape
        /// has moved between versions, so read defensively and degrade to empty.
        /// </summary>
        private static List<string> DumpValves(object obj, Type t)
        {
            var result = new List<string>();
            object? specs = null;
            try { specs = t.GetField("dump_valve")?.GetValue(obj) ?? t.GetField("dumpValve")?.GetValue(obj); }
            catch { }
            if (specs == null) return result;

            var st = specs.GetType();
            object? combos = null;
            try { combos = st.GetField("valves")?.GetValue(specs) ?? st.GetField("combos")?.GetValue(specs); }
            catch { }
            if (combos is not IEnumerable items) return result;

            foreach (var combo in items)
            {
                if (combo is string s) { result.Add(s); continue; }
                if (combo is IEnumerable names)
                {
                    var parts = new List<string>();
                    foreach (var n in names) if (n is string ns) parts.Add(ns);
                    if (parts.Count > 0) result.Add(string.Join("&", parts.ToArray()));
                }
            }
            return result;
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

        // ── solar vantage / storms (star-agnostic) ──────────────────────────────

        /// <summary>
        /// Per-star vantage (<c>VesselData.EnvSunsInfo</c>) plus, for each of those
        /// stars, the CME slot for THIS vessel's current SOI body
        /// (<c>DB.Storm(Storm.StormKey(v.mainBody, star))</c>). Star-agnostic: one
        /// entry per star Kerbalism tracks for this vessel, 1..N uniformly.
        /// StormTime/StormDuration/Dist are only filled when storm_state != 0 (see
        /// <c>Sitrep.Contract.KerbalismStormEntry</c>'s fair-vs-cheating doc
        /// comment); storm_generation is never read.
        /// </summary>
        public SolarRaw Solar(Vessel v)
        {
            var raw = new SolarRaw();
            if (v == null || _dbKerbalismData == null) return raw;

            object? vd = null;
            try { vd = _dbKerbalismData.Invoke(null, new object[] { v }); } catch { }
            if (vd == null) return raw;

            if (Member(vd, "EnvSunsInfo") is not IEnumerable sunsInfo) return raw;

            var mainBody = v.mainBody;
            foreach (var sunInfo in sunsInfo)
            {
                if (sunInfo == null) continue;
                var sunData = Member(sunInfo, "SunData");
                var star = sunData == null ? null : Member(sunData, "body") as CelestialBody;
                if (star == null) continue;

                double dx = 0, dy = 0, dz = 0;
                if (Member(sunInfo, "Direction") is Vector3d direction)
                {
                    dx = direction.x;
                    dy = direction.y;
                    dz = direction.z;
                }

                raw.Stars.Add(new StarInfoRaw
                {
                    Star = star.bodyName,
                    DirX = dx,
                    DirY = dy,
                    DirZ = dz,
                    Distance = MemberDouble(sunInfo, "Distance") ?? 0,
                });

                if (mainBody == null || _stormKeyMethod == null || _dbStorm == null) continue;

                string? key = null;
                try { key = _stormKeyMethod.Invoke(null, new object[] { mainBody, star }) as string; } catch { }
                if (string.IsNullOrEmpty(key)) continue;

                object? storm = null;
                try { storm = _dbStorm.Invoke(null, new object[] { key }); } catch { }
                if (storm == null) continue;

                int state = 0;
                try { state = Convert.ToInt32(Member(storm, "storm_state") ?? 0); } catch { }

                var entry = new StormEntryRaw { Star = star.bodyName, StormState = state };
                if (state != 0)
                {
                    entry.StormTime = MemberDouble(storm, "storm_time");
                    entry.StormDuration = MemberDouble(storm, "storm_duration");
                    entry.Dist = Vector3d.Distance(mainBody.position, star.position);
                }
                raw.Storms.Add(entry);
            }
            return raw;
        }

        /// <summary>
        /// Global CME transit speed, <c>PreferencesRadiation.Instance.StormEjectionSpeed</c>
        /// (metres/second, a fraction of c). One value for every storm on every
        /// body/star pair.
        /// </summary>
        public double? StormEjectionSpeed()
        {
            if (_prefsRadiationInstanceProp == null || _stormEjectionSpeedProp == null) return null;
            try
            {
                var instance = _prefsRadiationInstanceProp.GetValue(null);
                return instance == null ? null : AsDouble(_stormEjectionSpeedProp.GetValue(instance));
            }
            catch { return null; }
        }

        // ── modifier product (ledger option a') ─────────────────────────────────

        /// <summary>
        /// Live modifier-evaluation context for one capture tick: the vessel's
        /// VesselData + VesselResources, resolved once and reused across every
        /// process/rule <see cref="EvaluateModifiers"/> call that tick, rather than
        /// re-reflecting them per process/rule.
        /// </summary>
        public sealed class ModifierContext
        {
            internal object? Vd;
            internal object? Resources;
        }

        /// <summary>
        /// Fills each crew entry's <see cref="KerbalRulesRaw.RuleVarianceFactors"/>
        /// for the rules that HAVE a variance, from Kerbalism's own
        /// <c>Rule.Variance</c>. A rule with no variance is skipped: its factor
        /// is exactly 1 for every kerbal, so asking would be waste.
        ///
        /// <para>An entry is left ABSENT when the read fails rather than being
        /// filled with 1.0, because 1.0 is a real answer and the difference
        /// decides whether the death clock reports a number or admits it cannot
        /// (see <see cref="KerbalismDeathClock"/>).</para>
        /// </summary>
        public void FillRuleVarianceFactors(Vessel v, IEnumerable<RuleDefRaw> rules, List<KerbalRulesRaw> crew)
        {
            if (v == null || rules == null || crew == null || crew.Count == 0 || _ruleVariance == null) return;

            var varying = new List<RuleDefRaw>();
            foreach (var rule in rules)
            {
                if (rule != null && rule.Variance > 1e-10) varying.Add(rule);
            }
            if (varying.Count == 0) return;

            var members = v.GetVesselCrew();
            if (members == null) return;

            var byName = new Dictionary<string, KerbalRulesRaw>(StringComparer.Ordinal);
            foreach (var k in crew)
            {
                if (k != null && !string.IsNullOrEmpty(k.Name)) byName[k.Name] = k;
            }

            foreach (var member in members)
            {
                if (member == null || !byName.TryGetValue(member.name, out var entry)) continue;
                foreach (var rule in varying)
                {
                    object? factor;
                    try { factor = _ruleVariance.Invoke(null, new object[] { rule.Name, member, rule.Variance }); }
                    catch { continue; }
                    if (AsDouble(factor) is double d) entry.RuleVarianceFactors[rule.Name] = d;
                }
            }
        }

        /// <summary>
        /// How long ago, in seconds of sim time, Kerbalism last recomputed this
        /// vessel's environment and status (<c>VesselData.secSinceLastEval</c>,
        /// which it accumulates between evaluations and resets to zero at each
        /// one). Subtract it from the read UT for the UT the values were true
        /// at.
        ///
        /// <para>Worth reading because it is not small for a background craft:
        /// Kerbalism steps ONE unloaded vessel per tick, so a value from a fleet
        /// of thirty probes can be thirty ticks old. Null when it cannot be
        /// read, which the caller must carry as ignorance rather than substitute
        /// the read time for.</para>
        /// </summary>
        public double? SecondsSinceLastEvaluation(Vessel v)
        {
            if (v == null || _dbKerbalismData == null) return null;
            object? vd;
            try { vd = _dbKerbalismData.Invoke(null, new object[] { v }); } catch { return null; }
            return vd == null ? null : AsDouble(HiddenMember(vd, "secSinceLastEval"));
        }

        /// <summary>
        /// Whether Kerbalism simulates this vessel at all
        /// (<c>VesselData.IsSimulated</c>: false for debris, a rescue-contract
        /// craft and a dead EVA kerbal). A vessel it does not simulate has
        /// resource and habitat values that nothing is maintaining, so reading
        /// them would report a frozen state as a live one. Null when the read
        /// fails.
        /// </summary>
        public bool? IsSimulated(Vessel v)
        {
            if (v == null || _dbKerbalismData == null) return null;
            object? vd;
            try { vd = _dbKerbalismData.Invoke(null, new object[] { v }); } catch { return null; }
            return vd == null ? null : MemberBool(vd, "IsSimulated");
        }

        public ModifierContext? BeginModifierContext(Vessel v)
        {
            if (v == null || _dbKerbalismData == null || _resourceCacheGet == null) return null;
            try
            {
                var vd = _dbKerbalismData.Invoke(null, new object[] { v });
                var resources = _resourceCacheGet.Invoke(null, new object[] { v });
                if (vd == null || resources == null) return null;
                return new ModifierContext { Vd = vd, Resources = resources };
            }
            catch { return null; }
        }

        /// <summary>
        /// Kerbalism's own <c>Modifiers.Evaluate(vessel, vesselData, vesselResources,
        /// modifiers)</c>, the exact math a running Process/Rule scales its recipe
        /// by. An empty modifiers list evaluates to 1.0 (product over nothing),
        /// matching Kerbalism's own loop starting at <c>k = 1.0</c>.
        /// </summary>
        public double? EvaluateModifiers(ModifierContext? ctx, Vessel v, List<string> modifiers)
        {
            if (v == null || ctx?.Vd == null || ctx.Resources == null || _modifiersEvaluate == null) return null;
            if (modifiers == null || modifiers.Count == 0) return 1.0;
            try { return AsDouble(_modifiersEvaluate.Invoke(null, new object[] { v, ctx.Vd, ctx.Resources, modifiers })); }
            catch { return null; }
        }

        // ── science (the "science" capability's Kerbalism provider) ─────────────

        /// <summary>
        /// Everything the Kerbalism science provider needs off one vessel, in one
        /// main-thread pass: the <c>Experiment</c> modules (instruments), every file
        /// and sample on every <c>HardDrive</c> (stored results, with the drive's own
        /// capacity), the <c>Laboratory</c> modules, the <c>Sensor</c> modules, and
        /// the <c>KerbalismScansat</c> modules (SCANsat map scanners Kerbalism has
        /// taken over: see <see cref="ScienceScannerRaw"/> for why nothing else
        /// reports them).
        ///
        /// <para>Gated on <c>Features.Science</c> as well as assembly presence: with
        /// the feature off, Kerbalism is not simulating science and the provider must
        /// report nothing rather than an empty vessel (see
        /// <c>KerbalismScienceBackend.IsModeled</c>, the same
        /// <c>Features.Reliability</c> shape the reliability backend uses).</para>
        ///
        /// <para>[fixture-confirm] every member name below against a live install.
        /// Each read is independently fail-soft: a renamed member yields null for
        /// that field, a moved type yields fewer rows, and nothing throws into the
        /// capture. The alternative, one strongly-typed read, would take the whole
        /// provider out on any Kerbalism refactor.</para>
        /// </summary>
        public ScienceRaw Science(Vessel v)
        {
            var raw = new ScienceRaw { Modeled = Modeled("Science") };
            if (!raw.Modeled || v?.parts == null) return raw;

            // Read once for the whole vessel: older Kerbalism builds record which
            // scanners they cut for want of EC in a vessel-level list rather than on
            // the scanner module (see ScannerOf).
            var autoStopped = AutoStoppedScannerIds(v);

            foreach (var part in v.parts)
            {
                if (part?.Modules == null) continue;
                var partId = part.flightID.ToString(CultureInfo.InvariantCulture);
                var partName = part.partInfo?.title ?? part.partName ?? "";

                foreach (PartModule pm in part.Modules)
                {
                    if (pm == null) continue;
                    var moduleName = pm.GetType().Name;

                    if (string.Equals(moduleName, "Experiment", StringComparison.Ordinal))
                    {
                        raw.Experiments.Add(ExperimentOf(pm, partId, partName));
                        continue;
                    }
                    if (string.Equals(moduleName, "HardDrive", StringComparison.Ordinal))
                    {
                        StoredOf(pm, partId, partName, raw.Stored);
                        continue;
                    }
                    if (string.Equals(moduleName, "Laboratory", StringComparison.Ordinal))
                    {
                        raw.Labs.Add(new ScienceLabRaw
                        {
                            PartId = partId,
                            PartName = partName,
                            AnalysisRate = MemberDouble(pm, "analysis_rate") ?? 0,
                            EffectiveRate = InvokeDoubleMethod(pm, "EffectiveRate") ?? MemberDouble(pm, "analysis_rate") ?? 0,
                            Status = MemberEnumName(pm, "Status") ?? MemberString(pm, "status") ?? "",
                            Running = MemberBool(pm, "running") ?? false,
                        });
                        continue;
                    }
                    if (string.Equals(moduleName, "KerbalismScansat", StringComparison.Ordinal))
                    {
                        raw.Scanners.Add(ScannerOf(pm, part, partId, partName, autoStopped));
                        continue;
                    }
                    if (string.Equals(moduleName, "Sensor", StringComparison.Ordinal))
                    {
                        raw.Sensors.Add(new ScienceSensorRaw
                        {
                            PartId = partId,
                            PartName = partName,
                            Type = MemberString(pm, "type") ?? "",
                            // Kerbalism formats its own readout string; gonogo passes
                            // it through rather than re-deriving a number it would
                            // then have to unit-label without knowing the sensor type.
                            Readout = MemberString(pm, "Status") ?? MemberString(pm, "status") ?? "",
                            Active = MemberBool(pm, "active") ?? true,
                        });
                    }
                }
            }
            return raw;
        }

        private static ScienceExperimentRaw ExperimentOf(PartModule pm, string partId, string partName)
        {
            var sampleAmount = MemberDouble(pm, "sample_amount") ?? 0;
            return new ScienceExperimentRaw
            {
                PartId = partId,
                PartName = partName,
                ExperimentId = MemberString(pm, "experiment_id") ?? "",
                // Kerbalism's own display title when it has one, else the part's.
                Title = MemberString(pm, "ExperimentTitle") ?? MemberString(pm, "experiment_title") ?? partName,
                Issue = MemberString(pm, "issue") ?? "",
                // The simulated state is `State`, the derived display state `Status`
                // (Modules/Experiment.cs's two-layer RunningState -> ExpStatus).
                RunningState = MemberEnumName(pm, "State") ?? MemberEnumName(pm, "RunningState") ?? "",
                ExpStatus = MemberEnumName(pm, "Status") ?? MemberEnumName(pm, "ExpStatus") ?? "",
                DataRate = MemberDouble(pm, "data_rate") ?? 0,
                ProdFactor = MemberDouble(pm, "prodFactor") ?? 0,
                TakesSample = sampleAmount > 0,
                // Only meaningful for a finite-sample experiment: for a
                // sample-less one the field is a zero that would read as
                // "depleted" rather than "not applicable".
                RemainingSampleMass = sampleAmount > 0 ? MemberDouble(pm, "remainingSampleMass") : null,
            };
        }

        /// <summary>
        /// One <c>KerbalismScansat</c> module, across two generations of the module.
        ///
        /// <para>The newer one publishes <c>IsScanning</c>, <c>Issue</c>,
        /// <c>BodyCoveragePercent</c> and a per-module <c>power_disabled</c>. The
        /// older one, which is what ships in KerbalismModularScience, has none of
        /// them: it persists <c>body_coverage</c> privately and records the scanners
        /// it cut for want of EC in <c>VesselData.scansat_id</c>, a vessel-level list
        /// of part flightIDs (<paramref name="autoStopped"/>). So each field reads
        /// the newer member first and falls back to the older signal, and anything
        /// neither generation answers stays null rather than guessing.</para>
        ///
        /// <para>Scanning state is the one the older module genuinely cannot answer:
        /// it delegates to SCANsat's own <c>StopScanner</c>/<c>ResumeScanner</c> and
        /// keeps no flag. Reading SCANsat's module for it would make this Uplink
        /// depend on another mod's assembly, so it reports null and the map projects
        /// <c>deployed</c> accordingly.</para>
        /// </summary>
        private static ScienceScannerRaw ScannerOf(
            PartModule pm, Part part, string partId, string partName, HashSet<uint>? autoStopped)
        {
            var autoStop = autoStopped == null ? (bool?)null : autoStopped.Contains(part.flightID);
            return new ScienceScannerRaw
            {
                PartId = partId,
                PartName = partName,
                ExperimentId = MemberString(pm, "experimentType") ?? "",
                Issue = MemberString(pm, "Issue") ?? "",
                Scanning = MemberBool(pm, "IsScanning"),
                PowerDisabled = MemberBool(pm, "PowerDisabled")
                    ?? HiddenMember(pm, "power_disabled") as bool?
                    ?? autoStop,
                BodyCoveragePercent = MemberDouble(pm, "BodyCoveragePercent")
                    ?? AsDouble(HiddenMember(pm, "body_coverage")),
                EcRate = MemberDouble(pm, "ec_rate"),
            };
        }

        /// <summary>
        /// The part flightIDs Kerbalism has auto-stopped for want of EC, off
        /// <c>VesselData.scansat_id</c>. Null (not empty) when this build has no such
        /// list, which is what keeps "no scanner was cut" distinguishable from "this
        /// build does not record cuts".
        /// </summary>
        private HashSet<uint>? AutoStoppedScannerIds(Vessel v)
        {
            if (_dbKerbalismData == null) return null;
            try
            {
                var vd = _dbKerbalismData.Invoke(null, new object[] { v });
                if (vd == null) return null;
                if (!(Member(vd, "scansat_id") is IEnumerable ids)) return null;
                var set = new HashSet<uint>();
                foreach (var id in ids)
                {
                    if (id != null) set.Add(Convert.ToUInt32(id, CultureInfo.InvariantCulture));
                }
                return set;
            }
            catch { return null; }
        }

        /// <summary>
        /// Every file and sample on one <c>HardDrive</c>, each carrying that drive's
        /// own capacity figures. <c>dataCapacity</c>/<c>sampleCapacity</c> use
        /// <c>-1</c> for unlimited, which is normalised to null HERE rather than
        /// forwarded: a negative capacity would read in a widget as a real number.
        /// </summary>
        private static void StoredOf(PartModule pm, string partId, string partName, List<ScienceStoredRaw> into)
        {
            var dataCapacity = MemberDouble(pm, "dataCapacity");
            var sampleCapacity = MemberDouble(pm, "sampleCapacity");
            var drive = Member(pm, "Drive") ?? InvokeMethod(pm, "GetDrive");
            if (drive == null) return;

            var files = Pairs(Member(drive, "files") as IEnumerable);
            var samples = Pairs(Member(drive, "samples") as IEnumerable);
            var usedMB = 0.0;
            foreach (var entry in files)
            {
                usedMB += MemberDouble(entry.Value, "size") ?? 0;
            }
            // Kerbalism quantises sample capacity in SLOTS, one per stored sample,
            // not by mass or size.
            var slotsUsed = samples.Count;

            foreach (var entry in files)
            {
                var row = StoredRow(entry.Key, entry.Value, partId, partName, "file");
                row.TransmitRate = MemberDouble(entry.Value, "transmitRate") ?? 0;
                row.Transmitting = row.TransmitRate > 0;
                // GetFileSend wants the SubjectData's internal Id, not the
                // StockSubjectId already carried on the row: Drive keys its
                // fileSendFlags dictionary by the former.
                var subjectId = entry.Key != null ? MemberString(entry.Key, "Id") : null;
                row.SendFlagged = subjectId != null ? InvokeBoolMethod(drive, "GetFileSend", subjectId) : null;
                Fill(row, dataCapacity, usedMB, sampleCapacity, slotsUsed);
                into.Add(row);
            }
            foreach (var entry in samples)
            {
                var row = StoredRow(entry.Key, entry.Value, partId, partName, "sample");
                row.SampleMass = MemberDouble(entry.Value, "mass");
                row.Analyze = MemberBool(entry.Value, "analyze");
                Fill(row, dataCapacity, usedMB, sampleCapacity, slotsUsed);
                into.Add(row);
            }
        }

        private static void Fill(ScienceStoredRaw row, double? dataCapacity, double usedMB, double? sampleCapacity, int slotsUsed)
        {
            row.DriveCapacityMB = dataCapacity.HasValue && dataCapacity.Value >= 0 ? dataCapacity : null;
            row.DriveUsedMB = usedMB;
            row.SampleSlotsTotal = sampleCapacity.HasValue && sampleCapacity.Value >= 0 ? (int)sampleCapacity.Value : (int?)null;
            row.SampleSlotsUsed = slotsUsed;
        }

        /// <summary>
        /// One stored row from a (SubjectData, File|Sample) pair. Everything about
        /// WHAT the result is comes off the SubjectData (Kerbalism's per-subject
        /// ledger); everything about the stored blob comes off the file/sample.
        /// </summary>
        private static ScienceStoredRaw StoredRow(object? subject, object? blob, string partId, string partName, string kind)
        {
            var row = new ScienceStoredRaw
            {
                PartId = partId,
                PartName = partName,
                Kind = kind,
                SizeMB = blob != null ? MemberDouble(blob, "size") ?? 0 : 0,
            };
            if (subject == null) return row;

            // StockSubjectId, not Id: the stock-format string is the one a widget can
            // join against anything else, and it is what Kerbalism maintains for
            // exactly that interop reason.
            row.SubjectId = MemberString(subject, "StockSubjectId") ?? MemberString(subject, "Id") ?? "";
            row.SciencePerMB = MemberDouble(subject, "SciencePerMB") ?? 0;
            row.ScienceMaxValue = MemberDouble(subject, "ScienceMaxValue") ?? 0;
            row.ScienceRemainingTotal = MemberDouble(subject, "ScienceRemainingTotal") ?? 0;
            row.PercentCollectedTotal = MemberDouble(subject, "PercentCollectedTotal") ?? 0;
            row.ScienceCollectedInFlight = MemberDouble(subject, "ScienceCollectedInFlight") ?? 0;
            row.TimesCompleted = (int)(MemberDouble(subject, "TimesCompleted") ?? 0);

            var expInfo = Member(subject, "ExpInfo");
            if (expInfo != null)
            {
                row.ExperimentId = MemberString(expInfo, "ExperimentId") ?? "";
                row.Title = MemberString(expInfo, "Title") ?? "";
            }
            var situation = Member(subject, "Situation");
            if (situation != null)
            {
                row.Biome = MemberString(situation, "Biome") ?? "";
                // ScienceSituation is a superset of stock's 6-value mask (it adds
                // Surface/Flying/Space/BodyGlobal), so this string is Kerbalism's
                // vocabulary, not stock's, and core's Situation field says so via
                // the entry's valueModel tag.
                row.Situation = MemberEnumName(situation, "ScienceSituation") ?? MemberString(situation, "Situation") ?? "";
            }
            return row;
        }

        /// <summary>
        /// Key/value pairs out of a reflected <c>Dictionary&lt;SubjectData, T&gt;</c>
        /// without naming either generic argument: enumerating a dictionary yields
        /// <c>KeyValuePair</c> structs, whose Key/Value are readable as members like
        /// anything else. Returns nothing for a null/non-enumerable input.
        /// </summary>
        private static List<KeyValuePair<object?, object?>> Pairs(IEnumerable? dictionary)
        {
            var pairs = new List<KeyValuePair<object?, object?>>();
            if (dictionary == null) return pairs;
            foreach (var kvp in dictionary)
            {
                if (kvp == null) continue;
                pairs.Add(new KeyValuePair<object?, object?>(Member(kvp, "Key"), Member(kvp, "Value")));
            }
            return pairs;
        }

        // ── drive actuation (File Manager commands) ─────────────────────────
        //
        // The File Manager commands (KerbalismFileActuator) resolve and act
        // through these methods only, never by reaching into Kerbalism types
        // directly: this keeps every Drive/ScienceDB member name confirmed
        // against source in exactly one place (see this file's header
        // comment on the reflection convention).

        /// <summary>
        /// Resolve a stock-format subject id (the same id <c>science.experiments[].subjectId</c>
        /// carries) back to Kerbalism's live <c>SubjectData</c>, via the public
        /// <c>ScienceDB.GetSubjectDataFromStockId(string, ScienceSubject, string)</c>
        /// resolver (Science/ScienceDB.cs:684). Both optional parameters are
        /// passed null, matching their own defaults. Null on a malformed id or
        /// an absent assembly.
        ///
        /// <para>The resolver MUTATES the save for a parseable id it does not
        /// know: it constructs an unknown-subject entry and registers it
        /// permanently in the science DB. Callers must therefore validate the
        /// requested subject against the current snapshot BEFORE resolving, so
        /// an arbitrary wire id can never seed a player's subject DB. The
        /// command provider does exactly that.</para>
        /// </summary>
        public object? ResolveSubjectData(string stockSubjectId)
        {
            if (_getSubjectDataFromStockId == null || string.IsNullOrEmpty(stockSubjectId)) return null;
            try { return _getSubjectDataFromStockId.Invoke(null, new object?[] { stockSubjectId, null, null }); }
            catch { return null; }
        }

        /// <summary>
        /// Every live <c>Drive</c> on the vessel's <c>HardDrive</c> parts,
        /// paired with whether that same part also carries a <c>Laboratory</c>
        /// module: the same per-part walk <see cref="Science"/> uses, so a
        /// subject id resolvable on the read side resolves here too. Used by
        /// <c>MoveToLab</c> to find a drive that is genuinely lab-adjacent,
        /// not merely any drive with room.
        /// </summary>
        public List<(object Drive, bool LabAdjacent)> DrivesWithLabAdjacency(Vessel v)
        {
            var result = new List<(object, bool)>();
            if (v?.parts == null) return result;
            foreach (var part in v.parts)
            {
                if (part?.Modules == null) continue;
                // A part can carry more than one HardDrive (a config patch can add
                // them), and the read side emits a row per drive, so collect every
                // one: keeping only the last would leave the extra drives' rows
                // resolving NotFound on every command.
                var drives = new List<object>();
                var hasLab = false;
                foreach (PartModule pm in part.Modules)
                {
                    if (pm == null) continue;
                    var moduleName = pm.GetType().Name;
                    if (string.Equals(moduleName, "HardDrive", StringComparison.Ordinal))
                    {
                        var drive = Member(pm, "Drive") ?? InvokeMethod(pm, "GetDrive");
                        if (drive != null) drives.Add(drive);
                    }
                    else if (string.Equals(moduleName, "Laboratory", StringComparison.Ordinal))
                        hasLab = true;
                }
                foreach (var drive in drives) result.Add((drive, hasLab));
            }
            return result;
        }

        /// <summary>Every live <c>Drive</c> on the vessel, lab-adjacency stripped off (see <see cref="DrivesWithLabAdjacency"/>).</summary>
        public List<object> Drives(Vessel v) => DrivesWithLabAdjacency(v).ConvertAll(t => t.Drive);

        /// <summary>The drive (among <paramref name="drives"/>) whose <c>files</c> dictionary currently holds this subject, or null if it has moved on since the caller's snapshot.</summary>
        public object? DriveHoldingFile(List<object> drives, object subjectData) =>
            drives.Find(d => Pairs(Member(d, "files") as IEnumerable).Exists(p => ReferenceEquals(p.Key, subjectData)));

        /// <summary>The drive (among <paramref name="drives"/>) whose <c>samples</c> dictionary currently holds this subject, or null.</summary>
        public object? DriveHoldingSample(List<object> drives, object subjectData) =>
            drives.Find(d => Pairs(Member(d, "samples") as IEnumerable).Exists(p => ReferenceEquals(p.Key, subjectData)));

        /// <summary>The live <c>Sample</c> blob for this subject on this drive, or null.</summary>
        public object? SampleBlob(object drive, object subjectData)
        {
            foreach (var pair in Pairs(Member(drive, "samples") as IEnumerable))
            {
                if (ReferenceEquals(pair.Key, subjectData)) return pair.Value;
            }
            return null;
        }

        /// <summary>A <c>SubjectData</c>'s internal <c>Id</c>, the key <c>Drive.Send</c>/<c>GetFileSend</c> want (never the stock-format id carried on the wire).</summary>
        public string? SubjectInternalId(object subjectData) => MemberString(subjectData, "Id");

        /// <summary>A <c>Sample</c> blob's stored size in MB.</summary>
        public double SampleSize(object sample) => MemberDouble(sample, "size") ?? 0;

        /// <summary>A <c>Sample</c> blob's physical mass.</summary>
        public double SampleMass(object sample) => MemberDouble(sample, "mass") ?? 0;

        /// <summary>Whether a <c>Sample</c> blob was created by the Hijacker and must keep the stock crediting formula on recovery (see Sample.cs).</summary>
        public bool SampleUsesStockCrediting(object sample) => MemberBool(sample, "useStockCrediting") ?? false;

        /// <summary>Set (or clear) a file's queued-for-transmission flag: <c>Drive.Send(string subjectId, bool)</c>.</summary>
        public bool DriveSend(object drive, string internalSubjectId, bool flag)
        {
            if (_driveSend == null) return false;
            try { _driveSend.Invoke(drive, new object[] { internalSubjectId, flag }); return true; }
            catch { return false; }
        }

        /// <summary>Delete a stored file outright: <c>Drive.Delete_file(SubjectData, double)</c>. An amount of 0.0 deletes the whole file (Drive.cs's own "delete everything" sentinel).</summary>
        public bool DriveDeleteFile(object drive, object subjectData)
        {
            if (_driveDeleteFile == null) return false;
            try { _driveDeleteFile.Invoke(drive, new object[] { subjectData, 0.0 }); return true; }
            catch { return false; }
        }

        /// <summary>Set (or clear) a sample's lab-analysis flag: <c>Drive.Analyze(SubjectData, bool)</c>.</summary>
        public bool DriveAnalyze(object drive, object subjectData, bool flag)
        {
            if (_driveAnalyze == null) return false;
            try { _driveAnalyze.Invoke(drive, new object[] { subjectData, flag }); return true; }
            catch { return false; }
        }

        /// <summary>
        /// Dump a stored sample: <c>Drive.Delete_sample(SubjectData, double)</c>.
        /// An amount of 0.0 (the default) removes the whole sample; a caller
        /// moving part of a sample elsewhere passes the exact amount moved.
        /// </summary>
        public bool DriveDeleteSample(object drive, object subjectData, double amount = 0.0)
        {
            if (_driveDeleteSample == null) return false;
            try { _driveDeleteSample.Invoke(drive, new object[] { subjectData, amount }); return true; }
            catch { return false; }
        }

        /// <summary>How much sample capacity a drive has free for this subject: <c>Drive.SampleCapacityAvailable(SubjectData)</c>. Null on reflection failure, not to be confused with a genuine zero.</summary>
        public double? DriveSampleCapacityAvailable(object drive, object subjectData)
        {
            if (_driveSampleCapacityAvailable == null) return null;
            try { return AsDouble(_driveSampleCapacityAvailable.Invoke(drive, new object[] { subjectData })); }
            catch { return null; }
        }

        /// <summary>Record a sample onto a drive, creating or topping up the existing one: <c>Drive.Record_sample(SubjectData, double, double, bool)</c>. False when the drive has no room.</summary>
        public bool DriveRecordSample(object drive, object subjectData, double amount, double mass, bool useStockCrediting)
        {
            if (_driveRecordSample == null) return false;
            try { return (bool)(_driveRecordSample.Invoke(drive, new object[] { subjectData, amount, mass, useStockCrediting }) ?? false); }
            catch { return false; }
        }

        /// <summary>A KERBALISM.Features.* flag, false when absent (see <see cref="Features"/>).</summary>
        private bool Modeled(string feature) =>
            Features().TryGetValue(feature, out var on) && on;

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
        /// <summary>
        /// A private instance field or property, for the handful of Kerbalism members
        /// that are persisted state with no public reader. Same fail-soft contract as
        /// <see cref="Member"/>; kept separate so the ordinary reads cannot quietly
        /// start depending on a mod's internals.
        /// </summary>
        private static object? HiddenMember(object obj, string name)
        {
            var t = obj.GetType();
            var f = t.GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
            if (f != null) { try { return f.GetValue(obj); } catch { return null; } }
            var p = t.GetProperty(name, BindingFlags.NonPublic | BindingFlags.Instance);
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

        private static object? InvokeMethod(object obj, string name)
        {
            var m = obj.GetType().GetMethod(name, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (m == null) return null;
            try { return m.Invoke(obj, null); } catch { return null; }
        }

        private static bool? InvokeBoolMethod(object obj, string name, string arg)
        {
            var m = obj.GetType().GetMethod(name, BindingFlags.Public | BindingFlags.Instance, null, new[] { typeof(string) }, null);
            if (m == null) return null;
            try { return m.Invoke(obj, new object[] { arg }) as bool?; } catch { return null; }
        }

        private static double? InvokeDoubleMethod(object obj, string name) => AsDouble(InvokeMethod(obj, name));

        /// <summary>
        /// An enum-valued member as its NAME. Kerbalism's state machines are enums
        /// (<c>RunningState</c>, <c>ExpStatus</c>, the lab's <c>Status</c>,
        /// <c>ScienceSituation</c>), and the name is the only stable thing about
        /// them: the numeric value shifts whenever a case is inserted, so carrying
        /// the ordinal on the wire would silently relabel states across a Kerbalism
        /// update. Returns null when the member is absent or is not an enum, so a
        /// caller can fall back to a plain string member of the same name.
        /// </summary>
        private static string? MemberEnumName(object obj, string name)
        {
            var raw = Member(obj, name);
            if (raw == null) return null;
            var t = raw.GetType();
            return t.IsEnum ? raw.ToString() : null;
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
