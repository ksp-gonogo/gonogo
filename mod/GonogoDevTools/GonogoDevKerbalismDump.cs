using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace GonogoDevTools
{
    /// <summary>
    /// DEV-ONLY fixture collector for the Kerbalism uplink design work. Polls
    /// <c>PluginData/kerbalism-dump-request.cfg</c> (a <c>KERBDUMP { id, scenario }</c> node,
    /// same request/result-cfg pattern as <see cref="GonogoDevForceComms"/> /
    /// GonogoDevStampScan) and, on a NEW id, reflects into Kerbalism at RUNTIME (no
    /// compile-time Kerbalism reference: pure reflection, version-agnostic, builds even
    /// with Kerbalism absent) and dumps a fixture JSON of everything the uplink will need:
    ///   - <c>Kerbalism.System.API</c>: every public static method that takes just a
    ///     <c>Vessel</c> (the ~55 vessel-keyed aggregate reads), invoked for the active vessel;
    ///     plus the <c>(Vessel,string)</c> resource methods invoked for a candidate resource set.
    ///   - Greenhouse / ProcessController PartModules on the active vessel, public field/prop dump.
    ///   - Per-kerbal <c>KerbalData.rules</c> problem accumulators (best-effort via the Kerbalism DB).
    ///   - The <c>Features.*</c> static bools (the unmodeled-vs-healthy gates).
    ///   - <c>bodies</c>: the RSS/RO celestial body registry (real radii/mass/SOI/atmosphere),
    ///     reflected from <c>FlightGlobals.Bodies</c>. Body-only, no active vessel required.
    ///   - <c>roParts</c>: every active-vessel PartModule whose type belongs to a recognised RO/RP-1
    ///     mod (TestFlight, RealFuels, RP-1, RealHeat, ROLib/ROSolar, SolverEngines, ...), field/prop dumped.
    /// Output: <c>PluginData/kerbalism-fixture-&lt;scenario&gt;.json</c>. Result cfg records ok + path + counts.
    /// The whole thing is fail-soft: a missing type / thrown method is recorded as null, never fatal.
    /// Runs at both FLIGHT and the SPACE CENTER (<c>FlightAndKSC</c>) so the body registry can be
    /// captured with no vessel in play; every vessel-specific section below null-guards on
    /// <c>FlightGlobals.ActiveVessel</c> being absent.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.FlightAndKSC, once: false)]
    public sealed class GonogoDevKerbalismDump : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-kerbalism-dump: ";
        private static string? _lastAppliedId;

        private string? _requestPath;
        private string? _resultPath;
        private string? _pluginData;

        // Candidate resource names for the (Vessel,string) API methods (ResourceAmount/Capacity/AverageRate/…).
        // Superset of stock + Kerbalism + RO/ROKerbalism; missing ones just read 0. Extend from a live dump.
        private static readonly string[] CandidateResources =
        {
            // Kerbalism 3.32 default profile (confirmed from KerbalismConfig/Profiles/Default.cfg)
            "Food", "Water", "Oxygen", "CarbonDioxide", "Waste", "WasteWater", "WasteAtmosphere",
            "Nitrogen", "Ammonia", "Hydrogen", "Atmosphere", "ElectricCharge",
            "MonoPropellant", "Ore", "Oxidizer",
            // RO / ROKerbalism + niche resources (read 0 when absent, harmless)
            "LithiumHydroxide", "KO2", "PotassiumSuperoxide", "Shielding", "Sickness",
            "KuarqPowder", "Antimatter",
        };

        // Namespace/assembly-name substrings that identify an RO/RP-1 PartModule. Matched against
        // both GetType().Namespace and GetType().Assembly.GetName().Name so mods that don't namespace
        // their modules (some don't) are still caught via the assembly.
        private static readonly string[] RoNamespaceHints =
        {
            "TestFlight", "RealFuels", "RP0", "RP0Avionics", "RealHeat", "ROLib", "ROSolar",
            "SolverEngines", "KerbalismContracts", "AtmosphereAutopilot",
        };

        private void Start()
        {
            try
            {
                var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                _pluginData = Path.Combine(assemblyDir, "PluginData");
                Directory.CreateDirectory(_pluginData);
                _requestPath = Path.Combine(_pluginData, "kerbalism-dump-request.cfg");
                _resultPath = Path.Combine(_pluginData, "kerbalism-dump-result.cfg");
                Debug.Log(LogPrefix + "armed; polling " + _requestPath);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
            }
        }

        private void Update()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath)) return;
            ConfigNode root;
            try { root = ConfigNode.Load(_requestPath); } catch { return; }
            var node = root?.GetNode("KERBDUMP");
            if (node == null) return;
            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id) || id == _lastAppliedId) return;
            _lastAppliedId = id;
            var scenario = node.GetValue("scenario") ?? "default";
            try { Dump(id, scenario); }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "dump threw: " + ex);
                WriteResult(id, false, "", ex.Message);
            }
        }

        private void Dump(string id, string scenario)
        {
            var v = FlightGlobals.ActiveVessel;
            var sb = new StringBuilder();
            sb.Append("{\n");
            JField(sb, "scenario", scenario); sb.Append(",\n");
            JField(sb, "ut", Planetarium.GetUniversalTime()); sb.Append(",\n");
            JField(sb, "vessel", v != null ? v.vesselName : null); sb.Append(",\n");
            JField(sb, "vesselId", v != null ? v.id.ToString() : null); sb.Append(",\n");
            JField(sb, "crewCount", v != null ? v.GetCrewCount() : 0); sb.Append(",\n");

            int apiCount = DumpApi(sb, v);
            sb.Append(",\n");
            int ghCount = DumpModules(sb, v, "greenhouses", "Greenhouse");
            sb.Append(",\n");
            int pcCount = DumpModules(sb, v, "processes", "ProcessController");
            sb.Append(",\n");
            int kerbCount = DumpKerbals(sb, v);
            sb.Append(",\n");
            int featCount = DumpFeatures(sb);
            sb.Append(",\n");
            int bodyCount = DumpBodies(sb);
            sb.Append(",\n");
            int roCount = DumpRoParts(sb, v);
            sb.Append("\n}\n");

            var outPath = Path.Combine(_pluginData, "kerbalism-fixture-" + Sanitize(scenario) + ".json");
            File.WriteAllText(outPath, sb.ToString());
            Debug.Log(LogPrefix + "wrote " + outPath + " (api=" + apiCount + " gh=" + ghCount +
                      " proc=" + pcCount + " kerbals=" + kerbCount + " features=" + featCount +
                      " bodies=" + bodyCount + " roParts=" + roCount + ")");
            WriteResult(id, true, outPath,
                "api=" + apiCount + " gh=" + ghCount + " proc=" + pcCount + " kerbals=" + kerbCount +
                " features=" + featCount + " bodies=" + bodyCount + " roParts=" + roCount);
        }

        /// <summary>Invoke every public static API method that takes (Vessel) or (Vessel,string-resource).</summary>
        private int DumpApi(StringBuilder sb, Vessel v)
        {
            sb.Append("  \"api\": {");
            var apiType = FindType("KERBALISM.API") ?? FindType("Kerbalism.API") ?? FindType("Kerbalism.System.API");
            int n = 0;
            if (apiType != null && v != null)
            {
                bool first = true;
                foreach (var m in apiType.GetMethods(BindingFlags.Public | BindingFlags.Static))
                {
                    var ps = m.GetParameters();
                    try
                    {
                        if (ps.Length == 1 && ps[0].ParameterType == typeof(Vessel))
                        {
                            var val = m.Invoke(null, new object[] { v });
                            AppendKv(sb, ref first, m.Name, val); n++;
                        }
                        else if (ps.Length == 2 && ps[0].ParameterType == typeof(Vessel) && ps[1].ParameterType == typeof(string))
                        {
                            foreach (var res in CandidateResources)
                            {
                                try
                                {
                                    var val = m.Invoke(null, new object[] { v, res });
                                    if (val != null && !(val is double d && d == 0.0))
                                    { AppendKv(sb, ref first, m.Name + "[" + res + "]", val); n++; }
                                }
                                catch { }
                            }
                        }
                    }
                    catch { }
                }
            }
            sb.Append("}");
            return n;
        }

        /// <summary>Dump every part-module whose type name contains <paramref name="typeNameContains"/>.</summary>
        private int DumpModules(StringBuilder sb, Vessel v, string jsonKey, string typeNameContains)
        {
            sb.Append("  \"" + jsonKey + "\": [");
            int n = 0;
            if (v != null && v.parts != null)
            {
                bool firstMod = true;
                foreach (var part in v.parts)
                {
                    if (part.Modules == null) continue;
                    for (int i = 0; i < part.Modules.Count; i++)
                    {
                        var pm = part.Modules[i];
                        if (pm == null) continue;
                        var tn = pm.GetType().Name;
                        if (tn.IndexOf(typeNameContains, StringComparison.OrdinalIgnoreCase) < 0) continue;
                        if (!firstMod) sb.Append(", ");
                        firstMod = false;
                        sb.Append("{");
                        bool firstField = true;
                        AppendKv(sb, ref firstField, "_type", tn);
                        AppendKv(sb, ref firstField, "_part", part.partInfo != null ? part.partInfo.name : part.name);
                        DumpPublicMembers(sb, ref firstField, pm);
                        sb.Append("}");
                        n++;
                    }
                }
            }
            sb.Append("]");
            return n;
        }

        /// <summary>Best-effort per-kerbal rule accumulators via the Kerbalism DB (Kerbalism.DB.Kerbal(name).rules).</summary>
        private int DumpKerbals(StringBuilder sb, Vessel v)
        {
            sb.Append("  \"kerbals\": [");
            int n = 0;
            var dbType = FindType("KERBALISM.DB") ?? FindType("Kerbalism.DB");
            var kerbalMethod = dbType?.GetMethod("Kerbal", BindingFlags.Public | BindingFlags.Static);
            if (v != null && v.GetVesselCrew() != null)
            {
                bool firstK = true;
                foreach (var c in v.GetVesselCrew())
                {
                    if (!firstK) sb.Append(", ");
                    firstK = false;
                    sb.Append("{");
                    bool firstField = true;
                    AppendKv(sb, ref firstField, "name", c.name);
                    AppendKv(sb, ref firstField, "trait", c.trait);
                    try
                    {
                        var kd = kerbalMethod?.Invoke(null, new object[] { c.name });
                        if (kd != null)
                        {
                            var rulesField = kd.GetType().GetField("rules",
                                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                            var rules = rulesField?.GetValue(kd) as System.Collections.IDictionary;
                            if (rules != null)
                            {
                                sb.Append(", \"rules\": {");
                                bool firstRule = true;
                                foreach (System.Collections.DictionaryEntry e in rules)
                                {
                                    var problem = e.Value?.GetType().GetField("problem")?.GetValue(e.Value);
                                    AppendKv(sb, ref firstRule, e.Key?.ToString() ?? "?", problem);
                                }
                                sb.Append("}");
                            }
                        }
                    }
                    catch { }
                    sb.Append("}");
                    n++;
                }
            }
            sb.Append("]");
            return n;
        }

        /// <summary>The Features.* static bools (unmodeled-vs-healthy gates).</summary>
        private int DumpFeatures(StringBuilder sb)
        {
            sb.Append("  \"features\": {");
            int n = 0;
            var featType = FindType("KERBALISM.Features") ?? FindType("Kerbalism.Features");
            if (featType != null)
            {
                bool first = true;
                foreach (var f in featType.GetFields(BindingFlags.Public | BindingFlags.Static))
                {
                    if (f.FieldType != typeof(bool)) continue;
                    try { AppendKv(sb, ref first, f.Name, f.GetValue(null)); n++; } catch { }
                }
            }
            sb.Append("}");
            return n;
        }

        /// <summary>
        /// The RSS/RO celestial body registry (real radii/mass/SOI/atmosphere), reflected from
        /// <c>FlightGlobals.Bodies</c>. No active vessel required - this runs at the Space Center too.
        /// </summary>
        private static int DumpBodies(StringBuilder sb)
        {
            sb.Append("  \"bodies\": [");
            int n = 0;
            var bodies = FlightGlobals.Bodies;
            if (bodies != null)
            {
                bool firstBody = true;
                foreach (var b in bodies)
                {
                    if (b == null) continue;
                    if (!firstBody) sb.Append(", ");
                    firstBody = false;
                    sb.Append("{");
                    bool firstField = true;
                    AppendKv(sb, ref firstField, "bodyName", b.bodyName);
                    AppendKv(sb, ref firstField, "Radius", b.Radius);
                    AppendKv(sb, ref firstField, "Mass", b.Mass);
                    AppendKv(sb, ref firstField, "sphereOfInfluence", b.sphereOfInfluence);
                    AppendKv(sb, ref firstField, "atmosphere", b.atmosphere);
                    AppendKv(sb, ref firstField, "atmosphereDepth", b.atmosphereDepth);
                    AppendKv(sb, ref firstField, "GeeASL", b.GeeASL);
                    AppendKv(sb, ref firstField, "rotationPeriod", b.rotationPeriod);
                    AppendKv(sb, ref firstField, "orbitingBodiesCount", b.orbitingBodies != null ? b.orbitingBodies.Count : 0);
                    AppendKv(sb, ref firstField, "referenceBody", b.referenceBody != null ? b.referenceBody.bodyName : null);
                    sb.Append("}");
                    n++;
                }
            }
            sb.Append("]");
            return n;
        }

        /// <summary>
        /// Every active-vessel PartModule whose type belongs to a recognised RO/RP-1 mod (see
        /// <see cref="RoNamespaceHints"/>) - TestFlight reliability state, RealFuels tank config,
        /// RP-1 avionics controllable mass, RealHeat thermal, etc. Field/prop dump reuses
        /// <see cref="DumpPublicMembers"/>, same as the Kerbalism greenhouse/process sections.
        /// </summary>
        private static int DumpRoParts(StringBuilder sb, Vessel v)
        {
            sb.Append("  \"roParts\": [");
            int n = 0;
            if (v != null && v.parts != null)
            {
                bool firstMod = true;
                foreach (var part in v.parts)
                {
                    if (part.Modules == null) continue;
                    for (int i = 0; i < part.Modules.Count; i++)
                    {
                        var pm = part.Modules[i];
                        if (pm == null) continue;
                        var t = pm.GetType();
                        if (!IsRoType(t)) continue;
                        if (!firstMod) sb.Append(", ");
                        firstMod = false;
                        sb.Append("{");
                        bool firstField = true;
                        AppendKv(sb, ref firstField, "_type", t.Name);
                        AppendKv(sb, ref firstField, "_part", part.partInfo != null ? part.partInfo.name : part.name);
                        DumpPublicMembers(sb, ref firstField, pm);
                        sb.Append("}");
                        n++;
                    }
                }
            }
            sb.Append("]");
            return n;
        }

        private static bool IsRoType(Type t)
        {
            var ns = t.Namespace ?? "";
            string asmName;
            try { asmName = t.Assembly.GetName().Name ?? ""; } catch { asmName = ""; }
            foreach (var hint in RoNamespaceHints)
            {
                if (ns.IndexOf(hint, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    asmName.IndexOf(hint, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            return false;
        }

        private static void DumpPublicMembers(StringBuilder sb, ref bool first, object obj)
        {
            var t = obj.GetType();
            foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!IsScalar(f.FieldType)) continue;
                try { AppendKv(sb, ref first, f.Name, f.GetValue(obj)); } catch { }
            }
            foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!p.CanRead || p.GetIndexParameters().Length > 0 || !IsScalar(p.PropertyType)) continue;
                try { AppendKv(sb, ref first, p.Name, p.GetValue(obj, null)); } catch { }
            }
        }

        private static bool IsScalar(Type t) =>
            t == typeof(bool) || t == typeof(int) || t == typeof(long) || t == typeof(float) ||
            t == typeof(double) || t == typeof(string) || t.IsEnum;

        // --- tiny JSON helpers (flat scalar values only) ---
        private static void AppendKv(StringBuilder sb, ref bool first, string key, object val)
        {
            if (!first) sb.Append(", ");
            first = false;
            JField(sb, key, val);
        }

        private static void JField(StringBuilder sb, string key, object val)
        {
            sb.Append('"').Append(Esc(key)).Append("\": ");
            if (val == null) { sb.Append("null"); return; }
            switch (val)
            {
                case bool b: sb.Append(b ? "true" : "false"); break;
                case string s: sb.Append('"').Append(Esc(s)).Append('"'); break;
                case float f: sb.Append(SafeNum(f)); break;
                case double d: sb.Append(SafeNum(d)); break;
                case int i: sb.Append(i.ToString(System.Globalization.CultureInfo.InvariantCulture)); break;
                case long l: sb.Append(l.ToString(System.Globalization.CultureInfo.InvariantCulture)); break;
                default:
                    if (val.GetType().IsEnum) { sb.Append('"').Append(Esc(val.ToString())).Append('"'); }
                    else { sb.Append('"').Append(Esc(val.ToString())).Append('"'); }
                    break;
            }
        }

        private static string SafeNum(double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
            return d.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
        }

        private static string Esc(string s)
        {
            var sb = new StringBuilder(s.Length + 8);
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default: sb.Append(c); break;
                }
            }
            return sb.ToString();
        }

        private static string Sanitize(string s)
        {
            var sb = new StringBuilder();
            foreach (var c in s) sb.Append(char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '_');
            return sb.Length == 0 ? "default" : sb.ToString();
        }

        private static Type? FindType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try { var t = asm.GetType(fullName); if (t != null) return t; } catch { }
            }
            return null;
        }

        private void WriteResult(string id, bool ok, string path, string message)
        {
            try
            {
                var root = new ConfigNode();
                var n = root.AddNode("RESULT");
                n.AddValue("applied", id);
                n.AddValue("ok", ok);
                n.AddValue("path", path);
                n.AddValue("message", message);
                n.AddValue("time", DateTime.UtcNow.ToString("o"));
                root.Save(_resultPath);
            }
            catch (Exception ex) { Debug.LogError(LogPrefix + "WriteResult failed: " + ex.Message); }
        }
    }
}
