using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using CommNet;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls a request file
    /// (<c>PluginData/antenna-request.cfg</c>, next to this assembly) and, on a new
    /// request, rewrites the RealAntennas parameters of every antenna on a named
    /// vessel, re-derives the antenna from them, and forces CommNet to rebuild, so
    /// KSP's own link budget genuinely closes a route home.
    ///
    /// <para><b>The link is REAL.</b> Nothing here fabricates a route or answers on
    /// CommNet's behalf. It raises transmit power, gain, tech level and band on the
    /// real <c>ModuleRealAntenna</c>, then makes RealAntennas re-read them; whether a
    /// route appears is CommNet's own answer, read afterwards from
    /// <c>vessel.connection.ControlPath</c>. That matters because the currency-delay
    /// arm reads exactly that path and deliberately ignores
    /// <c>Gonogo.KSP.DevCommsOverride</c>, so a faked route would prove nothing about
    /// the light-time it produces.</para>
    ///
    /// <para><b>Why a recalculation call is not optional.</b> RealAntennas snapshots
    /// txPower / gain / frequency / encoder / symbol rate into a burst-job array ONCE,
    /// in <c>Precompute.GatherAllAntennas</c>, called from <c>Precompute.Initialize</c>.
    /// The per-frame <c>UpdateAllAntennas</c> refreshes position and pointing only.
    /// Writing a KSPField and stopping there therefore changes the part's right-click
    /// menu and NOTHING about the link budget. The sequence that does land is:
    /// set the fields, invoke <c>ModuleRealAntenna.RecalculateFields()</c> (private:
    /// it pushes the fields onto the <c>RealAntenna</c> that Precompute reads),
    /// then <c>RACommNetVessel.DiscoverAntennas()</c>, which calls
    /// <c>RACommNetNetwork.InvalidateCache()</c>, which makes the next
    /// <c>UpdateEarly</c> run <c>Precompute.Initialize</c> again. This addon does all
    /// three and reports each one separately, because a boost that stopped after step
    /// one looks identical to a boost that worked.</para>
    ///
    /// <para><b>Every member is reached by reflection.</b> GonogoDevTools references
    /// only KSP and Unity (see its csproj), so RealAntennas is reached through the
    /// loaded assembly, never a compile-time reference. A member that has moved in a
    /// newer RealAntennas is reported by name as the thing that failed, not swallowed.</para>
    ///
    /// <para>Request format:
    /// <code>
    /// ANTENNA
    /// {
    ///     id = boost-1              // unique per request; a repeat within one scene is ignored
    ///     vessel = active           // active | vessel name | vessel GUID
    ///     txPower = 60              // dBm (60 = 1 kW)
    ///     techLevel = 9             // 0..9; drives receiver noise and the encoder
    ///     referenceGain = 40        // dBi
    ///     referenceFrequency = 430  // MHz, the band's own centre frequency
    ///     rfBand = UHF              // must be a band this install defines
    ///     antennaDiameter = 0       // m; ABOVE zero this REPLACES referenceGain with dish math
    ///     settleSeconds = 15        // how long to watch for the route to appear
    /// }
    /// </code></para>
    ///
    /// <para><b>An unknown field name is a refusal, not a shrug.</b> A request naming
    /// no key this addon knows, or naming a key it does not know, is rejected whole,
    /// with both the offending names and the accepted ones in the log and the result
    /// file. A request that parses but changes nothing is the failure mode that costs
    /// an evening, because it reads exactly like a successful one.</para>
    ///
    /// <para><b>referenceFrequency is not decorative.</b> RealAntennas derives gain as
    /// <c>referenceGain + 10*log10(bandFrequency / referenceFrequency)</c> whenever
    /// referenceGain exceeds 5 dBi. A referenceGain above 5 with referenceFrequency at
    /// zero divides by zero and yields an infinite gain, so that combination is
    /// refused before anything is written.</para>
    ///
    /// <para><b>There is deliberately no amwTemp field.</b> RealAntennas reads a
    /// module's <c>AMWTemp</c> only for GROUND stations; a vessel antenna's receive
    /// noise comes from <c>TechLevelInfo.ReceiverNoiseTemperature</c>
    /// (<c>Physics.AntennaMicrowaveTemp</c>). Offering the field would be offering a
    /// setting nothing re-reads, which is the exact trap this addon exists to avoid.
    /// Raise <c>techLevel</c> instead: it moves receiver noise from 27000 K at TL0 to
    /// 200 K at TL9, and the encoder's required Eb/N0 from 10 dB to 1 dB.</para>
    ///
    /// <para><b>Band must match exactly.</b> <c>RealAntenna.Compatible</c> is band
    /// equality, so an antenna on a band no ground station carries can never link
    /// however much power it has. The result reports how many home antennas share the
    /// boosted band, so "boost too small" and "nothing to talk to" stay distinguishable.</para>
    ///
    /// <para><c>once: false</c> re-instantiates this every flight-scene load, and
    /// <see cref="_lastAppliedId"/> is deliberately an INSTANCE field, unlike
    /// <see cref="GonogoDevTeleport"/>'s static one: applying the same absolute
    /// parameters twice is idempotent, and a boost wants re-asserting after a revert
    /// or a scene change rather than lasting exactly one scene per KSP process.</para>
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevAntenna : MonoBehaviour
    {
        private const string LogPrefix = "[GonogoDevAntenna] ";

        private const string ModuleTypeName = "RealAntennas.ModuleRealAntenna";
        private const string BandInfoTypeName = "RealAntennas.Antenna.BandInfo";
        private const string ScenarioTypeName = "RealAntennas.RACommNetScenario";

        private const float PollIntervalSeconds = 1f;
        private const float RouteSampleIntervalSeconds = 1f;
        private const double DefaultSettleSeconds = 15.0;

        /// <summary>Keys this addon understands. Anything else in the node is a
        /// refusal: see the class doc for why silence is the wrong answer.</summary>
        private static readonly string[] KnownKeys =
        {
            "id", "vessel", "settleSeconds",
            "txPower", "techLevel", "referenceGain", "referenceFrequency",
            "antennaDiameter", "rfBand",
        };

        /// <summary>The subset of <see cref="KnownKeys"/> that actually changes an
        /// antenna. A request carrying none of these is refused even though every
        /// name in it is spelled correctly, because it would apply nothing.</summary>
        private static readonly string[] BoostKeys =
        {
            "txPower", "techLevel", "referenceGain", "referenceFrequency",
            "antennaDiameter", "rfBand",
        };

        private string? _lastAppliedId;
        private float _sinceLastPoll;

        private string? _requestPath;
        private string? _resultPath;

        private WatchState? _watch;

        /// <summary>What one antenna looked like at one moment: the module's own
        /// KSPFields on the left, and what the <c>RealAntenna</c> behind them ended up
        /// holding on the right. Both halves are needed: the module fields prove the
        /// write landed, the RealAntenna fields prove the recalculation carried it
        /// through to the object Precompute actually reads.</summary>
        private sealed class AntennaSnapshot
        {
            public string Fault = "";
            public double TxPower = double.NaN;
            public double TechLevel = double.NaN;
            public double ReferenceGain = double.NaN;
            public double ReferenceFrequencyMHz = double.NaN;
            public double AntennaDiameter = double.NaN;
            public string RfBand = "(unread)";
            public double ModuleGain = double.NaN;
            public string Condition = "(unread)";
            public double RaTxPower = double.NaN;
            public double RaGain = double.NaN;
            public double RaFrequencyHz = double.NaN;
            public int RaTechLevel = -1;
            public string RaBand = "(unread)";
            public string RaShape = "(unread)";
            public double RaBeamwidthDeg = double.NaN;
        }

        /// <summary>One antenna's before/after pair plus which part carried it.</summary>
        private sealed class AntennaReport
        {
            public string PartTitle = "";
            public AntennaSnapshot Before = new AntennaSnapshot();
            public AntennaSnapshot After = new AntennaSnapshot();
            public string Fault = "";
            public bool Changed;
        }

        /// <summary>One reading of what CommNet says about the craft's route home,
        /// walked here rather than asked of the production code, for the same reason
        /// <see cref="GonogoDevCurrency"/> walks it twice.</summary>
        private sealed class RouteRead
        {
            public string Label = "";
            public double SinceApplySeconds;
            public bool ConnectionPresent;
            public bool RawConnected;
            public bool ControlPathPresent;
            public int HopCount = -1;
            public int HomeHopCount = -1;
            public double TotalPathMeters = double.NaN;
            public int HomeNodesInScene = -1;
            public string Fault = "";
        }

        private sealed class WatchState
        {
            public string Id = "";
            public bool Ok;
            public string Summary = "";
            public string VesselName = "";
            public string VesselId = "";
            public string Band = "";
            public int HomeAntennasOnBand = -1;
            public string HomeAntennaFault = "";
            public string RecalculateFields = "(not attempted)";
            public string DiscoverAntennas = "(not attempted)";
            public string InvalidateCache = "(not attempted)";
            public List<AntennaReport> Antennas = new List<AntennaReport>();
            public List<RouteRead> Routes = new List<RouteRead>();
            public double RouteAppearedAfterSeconds = double.NaN;
            public double SettleSeconds;
            public float StartRealtime;
            public float NextSampleRealtime;
        }

        /// <summary>The values one request asks for, each one absent unless the
        /// request named it. Absent means "leave what the antenna already has", which
        /// is why every field is nullable rather than defaulted.</summary>
        private sealed class BoostRequest
        {
            public string Id = "";
            public string VesselSelector = "active";
            public double SettleSeconds = DefaultSettleSeconds;
            public float? TxPower;
            public float? TechLevel;
            public float? ReferenceGain;
            public float? ReferenceFrequencyMHz;
            public float? AntennaDiameter;
            public string? RfBand;
        }

        private void Start()
        {
            try
            {
                var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (string.IsNullOrEmpty(assemblyDir))
                {
                    enabled = false;
                    return;
                }

                var pluginData = Path.Combine(assemblyDir, "PluginData");
                _requestPath = Path.Combine(pluginData, "antenna-request.cfg");
                _resultPath = Path.Combine(pluginData, "antenna-result.cfg");
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void Update()
        {
            try
            {
                PollWatch();
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "route watch failed: " + ex.Message);
                _watch = null;
            }

            // Modest cadence - NOT every frame, matching the other dev addons.
            _sinceLastPoll += Time.unscaledDeltaTime;
            if (_sinceLastPoll < PollIntervalSeconds)
            {
                return;
            }
            _sinceLastPoll = 0f;

            try
            {
                Poll();
            }
            catch (Exception ex)
            {
                // Never throw out of the poll.
                Debug.LogError(LogPrefix + "poll failed: " + ex.Message);
            }
        }

        /// <summary>
        /// Re-read the route on a timer after the boost lands. A rebuild is not
        /// instantaneous: InvalidateCache only sets a flag, the next UpdateEarly
        /// re-runs Precompute.Initialize, and the graph rebuild follows that. Reading
        /// ControlPath in the same frame as the write would report the OLD answer and
        /// call the tool broken.
        /// </summary>
        private void PollWatch()
        {
            var watch = _watch;
            if (watch == null)
            {
                return;
            }

            var now = Time.realtimeSinceStartup;
            if (now < watch.NextSampleRealtime)
            {
                return;
            }
            watch.NextSampleRealtime = now + RouteSampleIntervalSeconds;

            var elapsed = now - watch.StartRealtime;
            var read = ReadRoute(FindVessel(watch.VesselId), "after", elapsed);
            watch.Routes.Add(read);

            if (double.IsNaN(watch.RouteAppearedAfterSeconds) && read.HopCount > 0)
            {
                watch.RouteAppearedAfterSeconds = read.SinceApplySeconds;
                Debug.Log(LogPrefix + "route APPEARED for id=" + watch.Id + " after "
                    + read.SinceApplySeconds.ToString("F1", CultureInfo.InvariantCulture) + "s: "
                    + read.HopCount + " hops, " + read.HomeHopCount + " touching home");
            }

            watch.Summary = SummariseWatch(watch);
            WriteResult(watch);

            if (elapsed >= watch.SettleSeconds)
            {
                Debug.Log(LogPrefix + "watch complete for id=" + watch.Id + ": " + watch.Summary);
                _watch = null;
            }
        }

        private void Poll()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                // No request file is the PRODUCTION-SAFE default.
                return;
            }

            var root = ConfigNode.Load(_requestPath);
            var node = root?.GetNode("ANTENNA");
            if (node == null)
            {
                return;
            }

            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogError(LogPrefix + "request has no 'id'; ignoring");
                return;
            }

            if (string.Equals(id, _lastAppliedId, StringComparison.Ordinal))
            {
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            // Claim the id up-front: a malformed request must not be re-logged every
            // second, the same discipline the other dev addons keep.
            _lastAppliedId = id;
            _watch = null;

            var watch = new WatchState { Id = id, SettleSeconds = DefaultSettleSeconds };

            if (!TryReadRequest(node, out var request, out var refusal))
            {
                Fail(watch, refusal);
                return;
            }

            watch.SettleSeconds = request.SettleSeconds;

            var vessel = ResolveVessel(request.VesselSelector);
            if (vessel == null)
            {
                Fail(watch, "no vessel matched '" + request.VesselSelector
                    + "' (want 'active', a vessel name, or a vessel GUID)");
                return;
            }

            watch.VesselName = vessel.vesselName ?? "";
            watch.VesselId = vessel.id.ToString();

            if (!vessel.loaded)
            {
                Fail(watch, "vessel '" + watch.VesselName + "' is NOT LOADED, so its ModuleRealAntenna "
                    + "instances do not exist; switch to the craft and re-issue the request");
                return;
            }

            var modules = FindAntennaModules(vessel, out var moduleFault);
            if (moduleFault.Length > 0)
            {
                Fail(watch, moduleFault);
                return;
            }
            if (modules.Count == 0)
            {
                Fail(watch, "vessel '" + watch.VesselName + "' carries no " + ModuleTypeName
                    + "; there is no RealAntennas antenna on it to boost");
                return;
            }

            // Plan every module BEFORE writing any of them, so an impossible request
            // (an unknown band, an infinite gain) refuses whole rather than leaving
            // half a craft boosted.
            var plans = new List<KeyValuePair<PartModule, AntennaSnapshot>>();
            foreach (var module in modules)
            {
                var before = ReadSnapshot(module);
                if (before.Fault.Length > 0)
                {
                    Fail(watch, "could not read the antenna on '" + PartTitle(module) + "': " + before.Fault);
                    return;
                }
                if (!PlanIsSane(before, request, PartTitle(module), out var planRefusal))
                {
                    Fail(watch, planRefusal);
                    return;
                }
                plans.Add(new KeyValuePair<PartModule, AntennaSnapshot>(module, before));
            }

            if (request.RfBand != null && !BandIsDefined(request.RfBand, out var bandNames, out var bandFault))
            {
                Fail(watch, bandFault.Length > 0
                    ? bandFault
                    : "rfBand '" + request.RfBand + "' is not a band this install defines (defined: " + bandNames + ")");
                return;
            }

            watch.Routes.Add(ReadRoute(vessel, "before", 0.0));

            var recalculateFailures = 0;
            foreach (var plan in plans)
            {
                var report = new AntennaReport
                {
                    PartTitle = PartTitle(plan.Key),
                    Before = plan.Value,
                };

                report.Fault = WriteFields(plan.Key, request);
                if (report.Fault.Length == 0)
                {
                    report.Fault = InvokeRecalculateFields(plan.Key);
                }
                if (report.Fault.Length > 0)
                {
                    recalculateFailures++;
                }

                report.After = ReadSnapshot(plan.Key);
                report.Changed = report.Fault.Length == 0 && !SnapshotsMatch(report.Before, report.After);
                watch.Antennas.Add(report);
            }

            watch.RecalculateFields = recalculateFailures == 0
                ? "invoked on all " + plans.Count + " antenna(s)"
                : "FAILED on " + recalculateFailures + " of " + plans.Count + " antenna(s), see each ANTENNA fault";

            RefreshNetwork(vessel, watch);

            var boostedBand = watch.Antennas.Count > 0 ? watch.Antennas[0].After.RaBand : "(unknown)";
            watch.Band = boostedBand;
            watch.HomeAntennasOnBand = CountHomeAntennasOnBand(boostedBand, out var homeFault);
            watch.HomeAntennaFault = homeFault;

            var changed = 0;
            foreach (var report in watch.Antennas)
            {
                if (report.Changed)
                {
                    changed++;
                }
            }

            watch.Ok = changed > 0 && recalculateFailures == 0;
            watch.StartRealtime = Time.realtimeSinceStartup;
            watch.NextSampleRealtime = watch.StartRealtime + RouteSampleIntervalSeconds;
            watch.Summary = SummariseWatch(watch);

            foreach (var report in watch.Antennas)
            {
                Debug.Log(LogPrefix + "id=" + id + " '" + report.PartTitle + "': "
                    + DescribeSnapshot(report.Before) + "  ->  " + DescribeSnapshot(report.After)
                    + (report.Fault.Length > 0 ? "  FAULT: " + report.Fault : ""));
            }
            Debug.Log(LogPrefix + "id=" + id + " " + watch.Summary
                + "; watching the control path for " + watch.SettleSeconds.ToString("F0", CultureInfo.InvariantCulture) + "s");

            WriteResult(watch);
            _watch = watch;
        }

        private void Fail(WatchState watch, string message)
        {
            watch.Ok = false;
            watch.Summary = message;
            Debug.LogError(LogPrefix + "id=" + watch.Id + " REFUSED: " + message);
            WriteResult(watch);
        }

        // ---- Request parsing ----

        /// <summary>
        /// Read the request, refusing rather than defaulting on anything it cannot
        /// account for: an unknown key, a key that will not parse, or a request that
        /// names nothing to change. Each refusal names the key and the text it saw.
        /// </summary>
        private static bool TryReadRequest(ConfigNode node, out BoostRequest request, out string refusal)
        {
            request = new BoostRequest();
            refusal = "";

            var unknown = new List<string>();
            var boostKeysSeen = 0;
            for (var i = 0; i < node.values.Count; i++)
            {
                var name = node.values[i].name;
                if (!Contains(KnownKeys, name))
                {
                    unknown.Add(name);
                }
                else if (Contains(BoostKeys, name))
                {
                    boostKeysSeen++;
                }
            }

            if (unknown.Count > 0)
            {
                refusal = "unknown field name(s) " + string.Join(", ", unknown.ToArray())
                    + "; this addon accepts only " + string.Join(", ", KnownKeys)
                    + ". Nothing was applied.";
                return false;
            }

            if (boostKeysSeen == 0)
            {
                refusal = "the request names no field that changes an antenna; it must set at least one of "
                    + string.Join(", ", BoostKeys) + ". Nothing was applied.";
                return false;
            }

            request.Id = node.GetValue("id") ?? "";
            request.VesselSelector = (node.GetValue("vessel") ?? "active").Trim();

            if (!TryOptionalDouble(node, "settleSeconds", DefaultSettleSeconds, out var settle, out refusal))
            {
                return false;
            }
            request.SettleSeconds = settle < 0.0 ? 0.0 : settle;

            if (!TryOptionalFloat(node, "txPower", out request.TxPower, out refusal)
                || !TryOptionalFloat(node, "techLevel", out request.TechLevel, out refusal)
                || !TryOptionalFloat(node, "referenceGain", out request.ReferenceGain, out refusal)
                || !TryOptionalFloat(node, "referenceFrequency", out request.ReferenceFrequencyMHz, out refusal)
                || !TryOptionalFloat(node, "antennaDiameter", out request.AntennaDiameter, out refusal))
            {
                return false;
            }

            var band = node.GetValue("rfBand");
            if (band != null)
            {
                band = band.Trim();
                if (band.Length == 0)
                {
                    refusal = "rfBand was given but empty; give a band name this install defines, or omit the key";
                    return false;
                }
                request.RfBand = band;
            }

            return true;
        }

        private static bool TryOptionalFloat(ConfigNode node, string key, out float? value, out string refusal)
        {
            value = null;
            refusal = "";
            var raw = node.GetValue(key);
            if (raw == null)
            {
                return true;
            }
            if (!float.TryParse(raw.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
            {
                refusal = "'" + key + " = " + raw + "' is not a number; nothing was applied";
                return false;
            }
            value = parsed;
            return true;
        }

        private static bool TryOptionalDouble(ConfigNode node, string key, double fallback, out double value, out string refusal)
        {
            value = fallback;
            refusal = "";
            var raw = node.GetValue(key);
            if (raw == null)
            {
                return true;
            }
            if (!double.TryParse(raw.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out value))
            {
                refusal = "'" + key + " = " + raw + "' is not a number; nothing was applied";
                return false;
            }
            return true;
        }

        /// <summary>
        /// Refuse a plan whose gain would come out infinite. RealAntennas derives an
        /// omni-or-reference gain as <c>referenceGain + 10*log10(bandFreq/refFreq)</c>
        /// and only skips the scaling term when referenceGain is at or below 5 dBi, so
        /// a boosted referenceGain with referenceFrequency still at zero divides by
        /// zero. A dish diameter above zero takes a different path and is exempt.
        /// </summary>
        private static bool PlanIsSane(AntennaSnapshot before, BoostRequest request, string partTitle, out string refusal)
        {
            refusal = "";
            var diameter = request.AntennaDiameter ?? (float)before.AntennaDiameter;
            if (diameter > 0f)
            {
                return true;
            }

            var gain = request.ReferenceGain ?? (float)before.ReferenceGain;
            var freq = request.ReferenceFrequencyMHz ?? (float)before.ReferenceFrequencyMHz;
            if (gain > 5f && !(freq > 0f))
            {
                refusal = "'" + partTitle + "' would end with referenceGain "
                    + gain.ToString("F1", CultureInfo.InvariantCulture)
                    + " dBi and referenceFrequency " + freq.ToString("F1", CultureInfo.InvariantCulture)
                    + " MHz, and RealAntennas scales any reference gain above 5 dBi by "
                    + "log10(bandFrequency / referenceFrequency), which is infinite at zero. "
                    + "Set referenceFrequency to the band's own centre frequency in MHz "
                    + "(UHF 430, VHF 150, S 2250, X 8450). Nothing was applied.";
                return false;
            }
            return true;
        }

        // ---- RealAntennas reflection ----

        private static Type? ResolveType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var found = asm.GetType(fullName, throwOnError: false);
                    if (found != null)
                    {
                        return found;
                    }
                }
                catch (Exception)
                {
                    // A reflection-only or partially-loaded assembly is not grounds
                    // for giving up on the rest of the list.
                }
            }
            return null;
        }

        private static List<PartModule> FindAntennaModules(Vessel vessel, out string fault)
        {
            fault = "";
            var found = new List<PartModule>();

            var moduleType = ResolveType(ModuleTypeName);
            if (moduleType == null)
            {
                fault = ModuleTypeName + " is not loaded: RealAntennas is not installed in this game, "
                    + "so there is no real antenna to upgrade";
                return found;
            }

            foreach (var part in vessel.parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }
                foreach (PartModule module in part.Modules)
                {
                    if (module != null && moduleType.IsInstanceOfType(module))
                    {
                        found.Add(module);
                    }
                }
            }
            return found;
        }

        private static string PartTitle(PartModule module)
        {
            try
            {
                return module.part?.partInfo?.title ?? module.part?.name ?? "(unnamed part)";
            }
            catch (Exception)
            {
                return "(unnamed part)";
            }
        }

        private static FieldInfo? Field(Type type, string name) =>
            type.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

        private static AntennaSnapshot ReadSnapshot(PartModule module)
        {
            var snapshot = new AntennaSnapshot();
            try
            {
                var type = module.GetType();
                snapshot.TxPower = ReadFloatField(type, module, "TxPower", snapshot);
                snapshot.TechLevel = ReadFloatField(type, module, "TechLevel", snapshot);
                snapshot.ReferenceGain = ReadFloatField(type, module, "referenceGain", snapshot);
                snapshot.ReferenceFrequencyMHz = ReadFloatField(type, module, "referenceFrequency", snapshot);
                snapshot.AntennaDiameter = ReadFloatField(type, module, "antennaDiameter", snapshot);
                snapshot.ModuleGain = ReadFloatField(type, module, "Gain", snapshot);
                snapshot.RfBand = ReadStringField(type, module, "RFBand", snapshot);
                snapshot.Condition = Field(type, "Condition")?.GetValue(module)?.ToString() ?? "(unread)";

                var antenna = Field(type, "RAAntenna")?.GetValue(module);
                if (antenna == null)
                {
                    snapshot.Fault = Append(snapshot.Fault, "ModuleRealAntenna.RAAntenna is null or unreadable");
                    return snapshot;
                }

                var antennaType = antenna.GetType();
                snapshot.RaTxPower = ReadDoubleMember(antennaType, antenna, "TxPower");
                snapshot.RaGain = ReadDoubleMember(antennaType, antenna, "Gain");
                snapshot.RaFrequencyHz = ReadDoubleMember(antennaType, antenna, "Frequency");
                snapshot.RaBeamwidthDeg = ReadDoubleMember(antennaType, antenna, "Beamwidth");
                snapshot.RaShape = ReadMember(antennaType, antenna, "Shape")?.ToString() ?? "(unread)";

                var band = ReadMember(antennaType, antenna, "RFBand");
                snapshot.RaBand = band == null
                    ? "(unread)"
                    : Field(band.GetType(), "name")?.GetValue(band)?.ToString() ?? "(unread)";

                var techLevelInfo = ReadMember(antennaType, antenna, "TechLevelInfo");
                if (techLevelInfo != null
                    && Field(techLevelInfo.GetType(), "Level")?.GetValue(techLevelInfo) is int level)
                {
                    snapshot.RaTechLevel = level;
                }
            }
            catch (Exception ex)
            {
                snapshot.Fault = Append(snapshot.Fault, "threw: " + ex.Message);
            }
            return snapshot;
        }

        private static double ReadFloatField(Type type, object target, string name, AntennaSnapshot snapshot)
        {
            var field = Field(type, name);
            if (field == null)
            {
                snapshot.Fault = Append(snapshot.Fault, "ModuleRealAntenna." + name + " no longer exists");
                return double.NaN;
            }
            var value = field.GetValue(target);
            return value is float f ? f : Convert.ToDouble(value, CultureInfo.InvariantCulture);
        }

        private static string ReadStringField(Type type, object target, string name, AntennaSnapshot snapshot)
        {
            var field = Field(type, name);
            if (field == null)
            {
                snapshot.Fault = Append(snapshot.Fault, "ModuleRealAntenna." + name + " no longer exists");
                return "(unread)";
            }
            return field.GetValue(target)?.ToString() ?? "";
        }

        private static object? ReadMember(Type type, object target, string name)
        {
            var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (property != null)
            {
                return property.GetValue(target, null);
            }
            return Field(type, name)?.GetValue(target);
        }

        private static double ReadDoubleMember(Type type, object target, string name)
        {
            try
            {
                var value = ReadMember(type, target, name);
                return value == null ? double.NaN : Convert.ToDouble(value, CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return double.NaN;
            }
        }

        /// <summary>
        /// Write the requested KSPFields onto one module. Returns an empty string on
        /// success, or the name of the field that could not be written: a field that
        /// has been renamed in a newer RealAntennas must be reported, never skipped.
        /// </summary>
        private static string WriteFields(PartModule module, BoostRequest request)
        {
            var type = module.GetType();
            var fault = "";

            fault = Append(fault, WriteFloat(type, module, "TxPower", request.TxPower));
            fault = Append(fault, WriteFloat(type, module, "TechLevel", request.TechLevel));
            fault = Append(fault, WriteFloat(type, module, "referenceGain", request.ReferenceGain));
            fault = Append(fault, WriteFloat(type, module, "referenceFrequency", request.ReferenceFrequencyMHz));
            fault = Append(fault, WriteFloat(type, module, "antennaDiameter", request.AntennaDiameter));

            if (request.RfBand != null)
            {
                var field = Field(type, "RFBand");
                if (field == null)
                {
                    fault = Append(fault, "ModuleRealAntenna.RFBand no longer exists, so the band was not set");
                }
                else
                {
                    field.SetValue(module, request.RfBand);
                }
            }

            return fault;
        }

        private static string WriteFloat(Type type, object target, string name, float? value)
        {
            if (value == null)
            {
                return "";
            }
            var field = Field(type, name);
            if (field == null)
            {
                return "ModuleRealAntenna." + name + " no longer exists, so that value was not set";
            }
            field.SetValue(target, value.Value);
            return "";
        }

        /// <summary>
        /// Invoke <c>ModuleRealAntenna.RecalculateFields()</c>. It is private, and it
        /// is the ONLY thing that copies the KSPFields onto the <c>RealAntenna</c>
        /// (tech level info, tx power, band, symbol rate, gain, modulation bits) that
        /// Precompute later snapshots. Without it the write is cosmetic.
        /// </summary>
        private static string InvokeRecalculateFields(PartModule module)
        {
            var method = module.GetType().GetMethod(
                "RecalculateFields", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (method == null)
            {
                return "ModuleRealAntenna.RecalculateFields() no longer exists, so the written fields were "
                    + "NOT carried onto the RealAntenna and the link budget is unchanged";
            }
            try
            {
                method.Invoke(module, null);
                return "";
            }
            catch (Exception ex)
            {
                return "ModuleRealAntenna.RecalculateFields() threw: "
                    + (ex.InnerException?.Message ?? ex.Message);
            }
        }

        /// <summary>
        /// Make CommNet re-derive the graph from the changed antennas. Two calls,
        /// reported separately: <c>RACommNetVessel.DiscoverAntennas()</c> rebuilds the
        /// node's antenna list and internally invalidates the precompute cache, and
        /// <c>RACommNetNetwork.InvalidateCache()</c> is called directly as well so a
        /// version whose DiscoverAntennas stopped invalidating still gets the rebuild.
        /// <c>onVesselWasModified</c> is fired for the same reason RealAntennas fires
        /// it from its own permanent-shutdown action.
        /// </summary>
        private static void RefreshNetwork(Vessel vessel, WatchState watch)
        {
            try
            {
                GameEvents.onVesselWasModified.Fire(vessel);
            }
            catch (Exception ex)
            {
                Debug.LogWarning(LogPrefix + "onVesselWasModified.Fire threw: " + ex.Message);
            }

            var connection = vessel.connection;
            if (connection == null)
            {
                watch.DiscoverAntennas = "SKIPPED: vessel.connection is null, so the craft has no CommNetVessel";
            }
            else
            {
                var method = connection.GetType().GetMethod(
                    "DiscoverAntennas", BindingFlags.Public | BindingFlags.Instance);
                if (method == null)
                {
                    watch.DiscoverAntennas = "FAILED: " + connection.GetType().FullName
                        + " has no DiscoverAntennas(), so the node's antenna list was not rebuilt";
                }
                else
                {
                    try
                    {
                        var result = method.Invoke(connection, null);
                        var count = result is System.Collections.ICollection list ? list.Count : -1;
                        watch.DiscoverAntennas = count < 0
                            ? "invoked"
                            : "invoked (" + count + " active antenna(s) on the node)";
                    }
                    catch (Exception ex)
                    {
                        watch.DiscoverAntennas = "FAILED: DiscoverAntennas() threw: "
                            + (ex.InnerException?.Message ?? ex.Message);
                    }
                }
            }

            watch.InvalidateCache = InvalidateNetworkCache();
        }

        private static string InvalidateNetworkCache()
        {
            try
            {
                var scenarioType = ResolveType(ScenarioTypeName);
                if (scenarioType == null)
                {
                    return "FAILED: " + ScenarioTypeName + " is not loaded";
                }

                var instance = CommNetScenario.Instance;
                if (instance == null || !scenarioType.IsInstanceOfType(instance))
                {
                    return "FAILED: CommNetScenario.Instance is not a " + ScenarioTypeName
                        + ", so RealAntennas is not driving CommNet in this game";
                }

                var network = scenarioType
                    .GetProperty("Network", BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(instance, null);
                if (network == null)
                {
                    return "FAILED: RACommNetScenario.Network is null or unreadable";
                }

                var method = network.GetType().GetMethod(
                    "InvalidateCache", BindingFlags.Public | BindingFlags.Instance);
                if (method == null)
                {
                    return "FAILED: " + network.GetType().FullName + " has no InvalidateCache(), so the "
                        + "precompute snapshot will keep the OLD antenna parameters";
                }

                method.Invoke(network, null);
                return "invoked";
            }
            catch (Exception ex)
            {
                return "FAILED: threw: " + ex.Message;
            }
        }

        private static bool BandIsDefined(string band, out string definedNames, out string fault)
        {
            definedNames = "";
            fault = "";
            try
            {
                var bandInfo = ResolveType(BandInfoTypeName);
                if (bandInfo == null)
                {
                    fault = BandInfoTypeName + " is not loaded, so rfBand could not be checked; nothing was applied";
                    return false;
                }

                if (!(bandInfo.GetField("All", BindingFlags.Public | BindingFlags.Static)?.GetValue(null)
                        is System.Collections.IDictionary all))
                {
                    fault = BandInfoTypeName + ".All is unreadable, so rfBand could not be checked; nothing was applied";
                    return false;
                }

                var names = new List<string>();
                foreach (var key in all.Keys)
                {
                    names.Add(key?.ToString() ?? "");
                }
                definedNames = string.Join(", ", names.ToArray());
                return all.Contains(band);
            }
            catch (Exception ex)
            {
                fault = "checking rfBand threw: " + ex.Message + "; nothing was applied";
                return false;
            }
        }

        /// <summary>
        /// How many ground-station antennas sit on the boosted band. RealAntennas
        /// pairs two antennas only when their bands are equal, so a zero here means no
        /// amount of power can ever produce a link and the request needs a different
        /// band, not a bigger number. A negative count means the read failed and must
        /// never be mistaken for a measured zero.
        /// </summary>
        private static int CountHomeAntennasOnBand(string band, out string fault)
        {
            fault = "";
            if (band.Length == 0 || band == "(unread)" || band == "(unknown)")
            {
                fault = "the boosted band could not be read, so no home-band count was taken";
                return -1;
            }

            try
            {
                var scenarioType = ResolveType(ScenarioTypeName);
                if (scenarioType == null)
                {
                    fault = ScenarioTypeName + " is not loaded";
                    return -1;
                }

                if (!(scenarioType.GetField("GroundStations", BindingFlags.Public | BindingFlags.Static)
                        ?.GetValue(null) is System.Collections.IDictionary stations))
                {
                    fault = "RACommNetScenario.GroundStations is unreadable";
                    return -1;
                }

                var count = 0;
                foreach (var station in stations.Values)
                {
                    if (station == null)
                    {
                        continue;
                    }
                    var comm = station.GetType()
                        .GetProperty("Comm", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(station, null);
                    if (comm == null)
                    {
                        continue;
                    }
                    if (!(comm.GetType()
                            .GetProperty("RAAntennaList", BindingFlags.Public | BindingFlags.Instance)
                            ?.GetValue(comm, null) is System.Collections.IEnumerable antennas))
                    {
                        continue;
                    }
                    foreach (var antenna in antennas)
                    {
                        if (antenna == null)
                        {
                            continue;
                        }
                        var bandInfo = Field(antenna.GetType(), "RFBand")?.GetValue(antenna);
                        var name = bandInfo == null
                            ? null
                            : Field(bandInfo.GetType(), "name")?.GetValue(bandInfo)?.ToString();
                        if (string.Equals(name, band, StringComparison.Ordinal))
                        {
                            count++;
                        }
                    }
                }
                return count;
            }
            catch (Exception ex)
            {
                fault = "counting home antennas threw: " + ex.Message;
                return -1;
            }
        }

        // ---- Route reading ----

        /// <summary>
        /// Walk <c>vessel.connection.ControlPath</c> here, in this assembly, using
        /// nothing of the production code. This is the only reading that proves the
        /// boost worked: every field on the antenna can read correct while CommNet
        /// still solves no route.
        /// </summary>
        private static RouteRead ReadRoute(Vessel? vessel, string label, double sinceApplySeconds)
        {
            var read = new RouteRead { Label = label, SinceApplySeconds = sinceApplySeconds };
            try
            {
                if (vessel == null)
                {
                    read.Fault = "the vessel is no longer in FlightGlobals";
                    return read;
                }

                var connection = vessel.connection;
                read.ConnectionPresent = connection != null;
                if (connection == null)
                {
                    read.Fault = "vessel.connection is null: the craft has no CommNetVessel at all";
                    return read;
                }

                read.RawConnected = connection.IsConnected;

                var path = connection.ControlPath;
                read.ControlPathPresent = path != null;
                if (path == null)
                {
                    read.Fault = "vessel.connection.ControlPath is NULL: CommNet holds no solved path";
                    return read;
                }

                var hops = 0;
                var homeHops = 0;
                var total = 0.0;
                foreach (var link in path)
                {
                    if (link == null || link.a == null || link.b == null)
                    {
                        continue;
                    }
                    hops++;
                    total += (link.a.precisePosition - link.b.precisePosition).magnitude;
                    if (link.a.isHome || link.b.isHome)
                    {
                        homeHops++;
                    }
                }

                read.HopCount = hops;
                read.HomeHopCount = homeHops;
                read.TotalPathMeters = total;
                read.HomeNodesInScene = CountHomeNodes();

                if (hops == 0)
                {
                    read.Fault = "vessel.connection.ControlPath is EMPTY: CommNet solved no route home";
                }
                else if (homeHops == 0)
                {
                    read.Fault = "the control path has hops but none of them touches a home node";
                }
            }
            catch (Exception ex)
            {
                read.Fault = "threw: " + ex.Message;
            }
            return read;
        }

        private static int CountHomeNodes()
        {
            try
            {
                var commField = typeof(CommNetHome).GetField("comm", BindingFlags.NonPublic | BindingFlags.Instance);
                if (commField == null)
                {
                    return -1;
                }
                var homes = UnityEngine.Object.FindObjectsOfType<CommNetHome>();
                if (homes == null)
                {
                    return -1;
                }
                var count = 0;
                foreach (var home in homes)
                {
                    if (home != null && commField.GetValue(home) is CommNode)
                    {
                        count++;
                    }
                }
                return count;
            }
            catch (Exception)
            {
                return -1;
            }
        }

        // ---- Vessel resolution ----

        private static Vessel? ResolveVessel(string selector)
        {
            var wanted = (selector ?? "").Trim();
            if (wanted.Length == 0 || string.Equals(wanted, "active", StringComparison.OrdinalIgnoreCase))
            {
                return FlightGlobals.ActiveVessel;
            }

            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            foreach (var v in vessels)
            {
                if (v != null && string.Equals(v.id.ToString(), wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
            foreach (var v in vessels)
            {
                if (v != null && string.Equals(v.vesselName, wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
            return null;
        }

        private static Vessel? FindVessel(string vesselId)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                return null;
            }
            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }
            foreach (var v in vessels)
            {
                if (v != null && string.Equals(v.id.ToString(), vesselId, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
            return null;
        }

        // ---- Reporting ----

        private static string SummariseWatch(WatchState watch)
        {
            if (!watch.Ok && watch.Antennas.Count == 0)
            {
                return watch.Summary.Length > 0 ? watch.Summary : "nothing was applied";
            }

            var changed = 0;
            foreach (var report in watch.Antennas)
            {
                if (report.Changed)
                {
                    changed++;
                }
            }

            var sb = new StringBuilder();
            sb.Append("boosted ").Append(changed).Append(" of ").Append(watch.Antennas.Count)
                .Append(" antenna(s) on ").Append(watch.VesselName);

            if (watch.HomeAntennasOnBand == 0)
            {
                sb.Append("; NO ground station carries the ").Append(watch.Band)
                    .Append(" band, so no boost can ever produce a link on it");
            }
            else if (watch.HomeAntennasOnBand > 0)
            {
                sb.Append("; ").Append(watch.HomeAntennasOnBand)
                    .Append(" home antenna(s) share the ").Append(watch.Band).Append(" band");
            }

            var last = watch.Routes.Count > 0 ? watch.Routes[watch.Routes.Count - 1] : null;
            if (!double.IsNaN(watch.RouteAppearedAfterSeconds))
            {
                sb.Append("; route APPEARED after ")
                    .Append(watch.RouteAppearedAfterSeconds.ToString("F1", CultureInfo.InvariantCulture))
                    .Append("s");
                if (last != null && last.HopCount > 0)
                {
                    sb.Append(" (now ").Append(last.HopCount).Append(" hops, ")
                        .Append(last.HomeHopCount).Append(" touching home)");
                }
            }
            else if (last != null && last.Label == "after")
            {
                sb.Append("; NO route yet after ")
                    .Append(last.SinceApplySeconds.ToString("F1", CultureInfo.InvariantCulture))
                    .Append("s: ").Append(last.Fault.Length > 0 ? last.Fault : "control path still empty");
            }
            else
            {
                sb.Append("; waiting for CommNet to rebuild");
            }

            return sb.ToString();
        }

        private static string DescribeSnapshot(AntennaSnapshot s) =>
            string.Format(CultureInfo.InvariantCulture,
                "tx={0:F1}dBm TL={1:F0} refGain={2:F1}dBi refFreq={3:F0}MHz dish={4:F2}m band={5} gain={6:F1}dBi (RealAntenna: tx={7:F1} gain={8:F1} band={9} TL={10} shape={11})",
                s.TxPower, s.TechLevel, s.ReferenceGain, s.ReferenceFrequencyMHz, s.AntennaDiameter,
                s.RfBand, s.ModuleGain, s.RaTxPower, s.RaGain, s.RaBand, s.RaTechLevel, s.RaShape);

        private static bool SnapshotsMatch(AntennaSnapshot a, AntennaSnapshot b) =>
            Same(a.TxPower, b.TxPower)
            && Same(a.TechLevel, b.TechLevel)
            && Same(a.ReferenceGain, b.ReferenceGain)
            && Same(a.ReferenceFrequencyMHz, b.ReferenceFrequencyMHz)
            && Same(a.AntennaDiameter, b.AntennaDiameter)
            && Same(a.RaGain, b.RaGain)
            && Same(a.RaTxPower, b.RaTxPower)
            && string.Equals(a.RfBand, b.RfBand, StringComparison.Ordinal);

        private static bool Same(double a, double b) =>
            (double.IsNaN(a) && double.IsNaN(b)) || Math.Abs(a - b) < 1e-6;

        private void WriteResult(WatchState watch)
        {
            if (string.IsNullOrEmpty(_resultPath))
            {
                return;
            }

            try
            {
                var dir = Path.GetDirectoryName(_resultPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir!);
                }

                var sb = new StringBuilder();
                sb.AppendLine("RESULT");
                sb.AppendLine("{");
                sb.AppendLine("\tapplied = " + watch.Id);
                sb.AppendLine("\tok = " + (watch.Ok ? "True" : "False"));
                sb.AppendLine("\tmessage = " + watch.Summary);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("\tvessel = " + (watch.VesselId.Length > 0
                    ? watch.VesselName + " [" + watch.VesselId + "]"
                    : "(none resolved)"));
                sb.AppendLine("\tantennasFound = " + watch.Antennas.Count.ToString(CultureInfo.InvariantCulture));
                sb.AppendLine("\trecalculateFields = " + watch.RecalculateFields);
                sb.AppendLine("\tdiscoverAntennas = " + watch.DiscoverAntennas);
                sb.AppendLine("\tinvalidateCache = " + watch.InvalidateCache);
                sb.AppendLine("\tboostedBand = " + (watch.Band.Length > 0 ? watch.Band : "(none)"));
                sb.AppendLine("\thomeAntennasOnBand = " + Countable(watch.HomeAntennasOnBand));
                if (watch.HomeAntennaFault.Length > 0)
                {
                    sb.AppendLine("\thomeAntennasOnBandFault = " + watch.HomeAntennaFault);
                }
                sb.AppendLine("\trouteAppeared = " + (double.IsNaN(watch.RouteAppearedAfterSeconds)
                    ? "False"
                    : "True"));
                sb.AppendLine("\trouteAppearedAfterSeconds = " + (double.IsNaN(watch.RouteAppearedAfterSeconds)
                    ? "(never within the watch)"
                    : watch.RouteAppearedAfterSeconds.ToString("F1", CultureInfo.InvariantCulture)));

                foreach (var report in watch.Antennas)
                {
                    AppendAntenna(sb, report);
                }
                foreach (var read in watch.Routes)
                {
                    AppendRoute(sb, read);
                }

                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }

        private static void AppendAntenna(StringBuilder sb, AntennaReport report)
        {
            sb.AppendLine("\tANTENNA");
            sb.AppendLine("\t{");
            sb.AppendLine("\t\tpart = " + report.PartTitle);
            sb.AppendLine("\t\tchanged = " + (report.Changed ? "True" : "False"));
            if (report.Fault.Length > 0)
            {
                sb.AppendLine("\t\tfault = " + report.Fault);
            }
            AppendSnapshot(sb, "BEFORE", report.Before);
            AppendSnapshot(sb, "AFTER", report.After);
            sb.AppendLine("\t}");
        }

        private static void AppendSnapshot(StringBuilder sb, string label, AntennaSnapshot s)
        {
            sb.AppendLine("\t\t" + label);
            sb.AppendLine("\t\t{");
            sb.AppendLine("\t\t\ttxPowerDbm = " + Number(s.TxPower, "F1"));
            sb.AppendLine("\t\t\ttechLevel = " + Number(s.TechLevel, "F0"));
            sb.AppendLine("\t\t\treferenceGainDbi = " + Number(s.ReferenceGain, "F2"));
            sb.AppendLine("\t\t\treferenceFrequencyMHz = " + Number(s.ReferenceFrequencyMHz, "F1"));
            sb.AppendLine("\t\t\tantennaDiameterM = " + Number(s.AntennaDiameter, "F3"));
            sb.AppendLine("\t\t\trfBand = " + s.RfBand);
            sb.AppendLine("\t\t\tmoduleGainDbi = " + Number(s.ModuleGain, "F2"));
            sb.AppendLine("\t\t\tcondition = " + s.Condition);
            sb.AppendLine("\t\t\trealAntennaTxPowerDbm = " + Number(s.RaTxPower, "F1"));
            sb.AppendLine("\t\t\trealAntennaGainDbi = " + Number(s.RaGain, "F2"));
            sb.AppendLine("\t\t\trealAntennaFrequencyHz = " + Number(s.RaFrequencyHz, "F0"));
            sb.AppendLine("\t\t\trealAntennaBand = " + s.RaBand);
            sb.AppendLine("\t\t\trealAntennaTechLevel = " + Countable(s.RaTechLevel));
            sb.AppendLine("\t\t\trealAntennaShape = " + s.RaShape);
            sb.AppendLine("\t\t\trealAntennaBeamwidthDeg = " + Number(s.RaBeamwidthDeg, "F2"));
            if (s.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\tfault = " + s.Fault);
            }
            sb.AppendLine("\t\t}");
        }

        private static void AppendRoute(StringBuilder sb, RouteRead read)
        {
            sb.AppendLine("\tROUTE");
            sb.AppendLine("\t{");
            sb.AppendLine("\t\tat = " + read.Label);
            sb.AppendLine("\t\tsinceApplySeconds = " + read.SinceApplySeconds.ToString("F1", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\tconnectionPresent = " + (read.ConnectionPresent ? "True" : "False"));
            sb.AppendLine("\t\trawCommNetConnected = " + (read.RawConnected ? "True" : "False"));
            sb.AppendLine("\t\tcontrolPathPresent = " + (read.ControlPathPresent ? "True" : "False"));
            sb.AppendLine("\t\tcontrolPathHops = " + Countable(read.HopCount));
            sb.AppendLine("\t\thopsTouchingHome = " + Countable(read.HomeHopCount));
            sb.AppendLine("\t\ttotalPathMeters = " + Number(read.TotalPathMeters, "F1"));
            sb.AppendLine("\t\thomeNodesInScene = " + Countable(read.HomeNodesInScene));
            if (read.Fault.Length > 0)
            {
                sb.AppendLine("\t\tfailedTest = " + read.Fault);
            }
            sb.AppendLine("\t}");
        }

        /// <summary>A negative count means the read failed, which must never render as
        /// a measured zero.</summary>
        private static string Countable(int count) =>
            count < 0 ? "(unreadable)" : count.ToString(CultureInfo.InvariantCulture);

        /// <summary>NaN means the read failed, and renders as such rather than as a
        /// substituted 0.0 that would read like a measurement.</summary>
        private static string Number(double value, string format) =>
            double.IsNaN(value) ? "(unreadable)"
            : double.IsInfinity(value) ? "(infinite)"
            : value.ToString(format, CultureInfo.InvariantCulture);

        private static string Append(string existing, string addition) =>
            addition.Length == 0 ? existing
            : existing.Length == 0 ? addition
            : existing + "; " + addition;

        private static bool Contains(string[] haystack, string needle)
        {
            foreach (var candidate in haystack)
            {
                if (string.Equals(candidate, needle, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }
    }
}
