using System;
using System.Collections;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using CommNet;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Points one antenna on a named vessel at a named place
    /// and reports whether the link solver ACTUALLY started honouring it, which is a
    /// different question from whether the property took the value.
    ///
    /// <para><b>The question this exists for.</b> RealAntennas keeps a burst-job
    /// mirror of every antenna. <c>Precompute.DoThings</c> refreshes each antenna's
    /// pointing DIRECTION on every network rebuild, but <c>isTracking</c> is written
    /// only by <c>Precompute.GatherAllAntennas</c>, reached from
    /// <c>Precompute.Initialize</c>. <c>IsTracking</c> is true for a dish with NO
    /// target and RealAntennas treats that as perfectly aimed at zero pointing loss,
    /// so a null-to-target change that does not reach the mirror leaves the solver
    /// still giving the dish a free pass while the property, the part menu and the
    /// map cone all say it is aimed. That is a command that appears to work.</para>
    ///
    /// <para><b>So the probe reports three layers and never collapses them.</b> The
    /// property (<c>Target</c>, <c>IsTracking</c>, <c>CanTarget</c>), the burst mirror
    /// (<c>AntennaData.isTracking</c>, read by reflection because it is internal), and
    /// the craft's own route home. A change visible in the first and not the second is
    /// exactly the failure being looked for, and a probe that only read the first
    /// could not see it.</para>
    ///
    /// <para><b>Both refresh calls are separately switchable</b>, because the whole
    /// point is which of them is needed. <c>invalidate</c> calls
    /// <c>RACommNetNetwork.InvalidateCache()</c>; <c>discover</c> calls
    /// <c>RACommNetVessel.DiscoverAntennas()</c>, which REBUILDS the node's antenna
    /// list and therefore replaces the object the target was set on. Running the same
    /// request twice with one flag each is what tells them apart.</para>
    ///
    /// <para><b>Every member is reached by reflection.</b> GonogoDevTools references
    /// only KSP and Unity, so RealAntennas is reached through the loaded assembly. A
    /// member that has moved is reported by name as the thing that failed rather than
    /// swallowed.</para>
    ///
    /// <para>Request format, polled from <c>PluginData/antenna-target-request.cfg</c>
    /// next to this assembly:
    /// <code>
    /// ANTENNATARGET
    /// {
    ///     id = t1                  // unique per request; a repeat is ignored
    ///     vessel = commsat         // vessel name or GUID; NOT "active" for the real test
    ///     antennaIndex = 0         // which antenna on the node
    ///     mode = BodyLatLonAlt     // Vessel | BodyLatLonAlt | AzEl | OrbitRelative | none
    ///     bodyName = Mun           // BodyLatLonAlt
    ///     latLonAlt = 0,0,-200000  // BodyLatLonAlt; negative altitude is the body centre
    ///     targetVesselId = <guid>  // Vessel / AzEl / OrbitRelative
    ///     azimuth = 0              // AzEl
    ///     elevation = 0            // AzEl / OrbitRelative
    ///     forward = 0              // OrbitRelative
    ///     invalidate = true
    ///     discover = false
    ///     save = false             // write persistent.sfs afterwards
    ///     settleSeconds = 20
    /// }
    /// </code>
    /// <c>mode = none</c> reads and reports without writing anything, which is how the
    /// other half of the persistence question is asked after a restart.</para>
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public class GonogoDevAntennaTarget : MonoBehaviour
    {
        private const string LogPrefix = "[GonogoDevAntennaTarget] ";
        private const string NodeName = "ANTENNATARGET";
        // No type NAME is written down anywhere below, and that is deliberate: every
        // type this needs is reached from an object the game hands over. The target
        // type is the declared type of the antenna's own `Target` property; the
        // network is a property of whatever `CommNetScenario.Instance` turns out to
        // be. A written-out name is a second copy of the backend's spelling that
        // goes stale silently when the backend renames something, and it is coupling
        // to a mod this dev assembly is not entitled to depend on.
        private const float PollIntervalSeconds = 2f;
        private const float SampleIntervalSeconds = 2f;

        private string? _requestPath;
        private string? _resultPath;
        private string _lastAppliedId = "";
        private float _sinceLastPoll;
        private Watch? _watch;

        private sealed class Request
        {
            public string Id = "";
            public string VesselSelector = "";
            public int AntennaIndex;
            public string Mode = "none";
            public string BodyName = "";
            public string LatLonAlt = "";
            public string TargetVesselId = "";
            public string Azimuth = "";
            public string Elevation = "";
            public string Forward = "";
            public bool Invalidate = true;
            public bool Discover;
            public bool Clear;
            public bool Save;
            public double SettleSeconds = 20.0;
        }

        /// <summary>One reading of all three layers at one instant.</summary>
        private sealed class Layers
        {
            public string Label = "";
            public double SinceApplySeconds;
            public string Target = "(unread)";
            public string IsTracking = "(unread)";
            public string CanTarget = "(unread)";
            public string Shape = "(unread)";
            public string Beamwidth = "(unread)";
            public string MirrorIsTracking = "(unread)";
            public string MirrorFault = "";
            public string Connected = "(unread)";
            public string HopsHome = "(unread)";
        }

        private sealed class Watch
        {
            public string Id = "";
            public bool Ok;
            public string Summary = "";
            public string VesselName = "";
            public string VesselId = "";
            public string Loaded = "(unread)";
            public string AntennaName = "(unread)";
            public string AntennaCount = "(unread)";
            public string ParentSnapshot = "(unread)";
            public string Parent = "(unread)";
            public string LoadFromConfig = "(not attempted)";
            public string Assign = "(not attempted)";
            public string DiscoverAntennas = "(not attempted)";
            public string InvalidateCache = "(not attempted)";
            public string SaveGame = "(not attempted)";
            public string SnapshotTargetNode = "(unread)";
            public double SettleSeconds;
            public float StartRealtime;
            public float NextSampleRealtime;
            public Layers Before = new Layers();
            public System.Collections.Generic.List<Layers> After =
                new System.Collections.Generic.List<Layers>();
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
                _requestPath = Path.Combine(pluginData, "antenna-target-request.cfg");
                _resultPath = Path.Combine(pluginData, "antenna-target-result.cfg");
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
                Sample();
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "sampling failed: " + ex.Message);
                _watch = null;
            }

            _sinceLastPoll += Time.unscaledDeltaTime;
            if (_sinceLastPoll < PollIntervalSeconds) return;
            _sinceLastPoll = 0f;

            try
            {
                Poll();
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "poll failed: " + ex.Message);
            }
        }

        private void Poll()
        {
            if (_requestPath == null || !File.Exists(_requestPath)) return;
            var root = ConfigNode.Load(_requestPath);
            var node = root?.GetNode(NodeName);
            if (node == null) return;

            var request = new Request();
            request.Id = node.GetValue("id") ?? "";
            if (request.Id.Length == 0 || request.Id == _lastAppliedId) return;
            _lastAppliedId = request.Id;

            request.VesselSelector = node.GetValue("vessel") ?? "";
            request.AntennaIndex = ParseInt(node.GetValue("antennaIndex"), 0);
            request.Mode = node.GetValue("mode") ?? "none";
            request.BodyName = node.GetValue("bodyName") ?? "";
            request.LatLonAlt = node.GetValue("latLonAlt") ?? "";
            request.TargetVesselId = node.GetValue("targetVesselId") ?? "";
            request.Azimuth = node.GetValue("azimuth") ?? "";
            request.Elevation = node.GetValue("elevation") ?? "";
            request.Forward = node.GetValue("forward") ?? "";
            request.Invalidate = ParseBool(node.GetValue("invalidate"), true);
            request.Discover = ParseBool(node.GetValue("discover"), false);
            request.Clear = ParseBool(node.GetValue("clear"), false);
            request.Save = ParseBool(node.GetValue("save"), false);
            request.SettleSeconds = ParseDouble(node.GetValue("settleSeconds"), 20.0);

            Apply(request);
        }

        private void Apply(Request request)
        {
            var watch = new Watch
            {
                Id = request.Id,
                SettleSeconds = request.SettleSeconds,
                StartRealtime = Time.realtimeSinceStartup,
            };
            watch.NextSampleRealtime = watch.StartRealtime;
            _watch = watch;

            var vessel = FindVessel(request.VesselSelector);
            if (vessel == null)
            {
                watch.Summary = "REFUSED: no vessel matched '" + request.VesselSelector + "'";
                WriteResult(watch);
                return;
            }
            watch.VesselName = vessel.GetDisplayName();
            watch.VesselId = vessel.id.ToString();
            watch.Loaded = vessel.loaded ? "LOADED" : "UNLOADED";

            var antenna = FindAntenna(vessel, request.AntennaIndex, watch, out var fault);
            if (antenna == null)
            {
                watch.Summary = "REFUSED: " + fault;
                WriteResult(watch);
                return;
            }
            _antenna = antenna;
            _vessel = vessel;

            watch.AntennaName = Read(antenna, "Name");
            watch.ParentSnapshot = ReadObject(antenna, "ParentSnapshot") == null ? "null" : "present";
            watch.Parent = ReadObject(antenna, "Parent") == null ? "null" : "present";
            watch.Before = ReadLayers(antenna, vessel, "before", 0.0);

            if (request.Clear)
            {
                // The sharpest edge in the whole surface: the setter's persistence arm
                // calls Save on the incoming value with no null guard, so this is
                // expected to throw for an antenna carrying a ParentSnapshot. Whether
                // it does is the thing being measured, so it is attempted and the throw
                // is reported rather than guarded against.
                watch.LoadFromConfig = "SKIPPED: clear = true, assigning null instead";
                watch.Assign = AssignTarget(antenna, null);
            }
            else if (!string.Equals(request.Mode, "none", StringComparison.OrdinalIgnoreCase))
            {
                var built = BuildTarget(request, antenna, out var buildFault);
                watch.LoadFromConfig = buildFault.Length > 0 ? "FAILED: " + buildFault : "invoked";
                if (built != null)
                {
                    watch.Assign = AssignTarget(antenna, built);
                }
            }
            else
            {
                watch.LoadFromConfig = "SKIPPED: mode = none, this is a read-only pass";
            }

            if (request.Discover) watch.DiscoverAntennas = Discover(vessel);
            if (request.Invalidate) watch.InvalidateCache = Invalidate();
            watch.SnapshotTargetNode = ReadSnapshotTarget(antenna);
            if (request.Save) watch.SaveGame = SaveGame();

            watch.Ok = true;
            watch.Summary = "applied";
            WriteResult(watch);
        }

        private object? _antenna;
        private Vessel? _vessel;

        private void Sample()
        {
            var watch = _watch;
            if (watch == null || _antenna == null || _vessel == null) return;
            var now = Time.realtimeSinceStartup;
            if (now < watch.NextSampleRealtime) return;
            watch.NextSampleRealtime = now + SampleIntervalSeconds;

            var since = now - watch.StartRealtime;
            watch.After.Add(ReadLayers(_antenna, _vessel, "after", since));
            WriteResult(watch);

            if (since >= watch.SettleSeconds)
            {
                _watch = null;
            }
        }


        private Layers ReadLayers(object antenna, Vessel vessel, string label, double since)
        {
            var layers = new Layers { Label = label, SinceApplySeconds = since };
            var target = ReadObject(antenna, "Target");
            layers.Target = target == null ? "null" : target.ToString();
            layers.IsTracking = Read(antenna, "IsTracking");
            layers.CanTarget = Read(antenna, "CanTarget");
            layers.Shape = Read(antenna, "Shape");
            layers.Beamwidth = Read(antenna, "Beamwidth");
            layers.MirrorIsTracking = ReadMirror(antenna, out var mirrorFault);
            layers.MirrorFault = mirrorFault;

            try
            {
                var connection = vessel.Connection;
                layers.Connected = connection == null ? "(no CommNetVessel)"
                    : connection.IsConnected.ToString();
                layers.HopsHome = connection?.ControlPath == null
                    ? "(no control path)"
                    : connection.ControlPath.Count.ToString(CultureInfo.InvariantCulture);
            }
            catch (Exception ex)
            {
                layers.Connected = "FAILED: " + ex.Message;
            }
            return layers;
        }

        /// <summary>
        /// The burst mirror's own <c>isTracking</c> for this antenna, which is the
        /// value the link solver reads and the only one that says whether a target
        /// change has actually bitten.
        /// </summary>
        private static string ReadMirror(object antenna, out string fault)
        {
            fault = "";
            try
            {
                var network = GraphBehind(out var networkFault);
                if (network == null)
                {
                    fault = networkFault;
                    return "(unreachable)";
                }

                var precompute = network.GetType()
                    .GetField("precompute", BindingFlags.Public | BindingFlags.NonPublic
                        | BindingFlags.Instance)
                    ?.GetValue(network);
                if (precompute == null)
                {
                    fault = network.GetType().FullName + " has no readable precompute field";
                    return "(unreachable)";
                }

                var map = precompute.GetType()
                    .GetField("allAntennas", BindingFlags.Public | BindingFlags.NonPublic
                        | BindingFlags.Instance)
                    ?.GetValue(precompute) as IDictionary;
                if (map == null)
                {
                    fault = "Precompute has no readable 'allAntennas' dictionary";
                    return "(unreachable)";
                }
                if (!map.Contains(antenna))
                {
                    return "(this antenna is not in the mirror at all)";
                }
                var index = Convert.ToInt32(map[antenna], CultureInfo.InvariantCulture);

                var data = precompute.GetType()
                    .GetField("antennaDataList", BindingFlags.Public | BindingFlags.NonPublic
                        | BindingFlags.Instance)
                    ?.GetValue(precompute);
                if (data == null)
                {
                    fault = "Precompute has no readable 'antennaDataList'";
                    return "(unreachable)";
                }

                var item = data.GetType()
                    .GetProperty("Item", BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(data, new object[] { index });
                if (item == null)
                {
                    fault = "NativeArray<AntennaData> has no readable indexer";
                    return "(unreachable)";
                }

                var tracking = item.GetType()
                    .GetField("isTracking", BindingFlags.Public | BindingFlags.NonPublic
                        | BindingFlags.Instance)
                    ?.GetValue(item);
                if (tracking == null)
                {
                    fault = "AntennaData has no readable 'isTracking'";
                    return "(unreachable)";
                }
                return tracking.ToString() + " (mirror slot " + index + ")";
            }
            catch (Exception ex)
            {
                fault = "threw: " + ex.Message;
                return "(unreachable)";
            }
        }


        private static object? BuildTarget(Request request, object antenna, out string fault)
        {
            fault = "";
            // The target type, taken from the antenna rather than named: the declared
            // type of its own Target property is the base class every target kind
            // derives from, and the sanctioned constructor is a static on it.
            var property = antenna.GetType()
                .GetProperty("Target", BindingFlags.Public | BindingFlags.Instance);
            if (property == null)
            {
                fault = antenna.GetType().FullName + " has no Target property";
                return null;
            }
            var type = property.PropertyType;
            var method = type.GetMethod(
                "LoadFromConfig", BindingFlags.Public | BindingFlags.Static);
            if (method == null)
            {
                fault = type.FullName + " has no public static LoadFromConfig";
                return null;
            }

            var node = new ConfigNode("TARGET");
            node.AddValue("name", request.Mode);
            if (request.BodyName.Length > 0) node.AddValue("bodyName", request.BodyName);
            if (request.LatLonAlt.Length > 0) node.AddValue("latLonAlt", request.LatLonAlt);
            if (request.TargetVesselId.Length > 0) node.AddValue("vesselId", request.TargetVesselId);
            if (request.Azimuth.Length > 0) node.AddValue("azimuth", request.Azimuth);
            if (request.Elevation.Length > 0) node.AddValue("elevation", request.Elevation);
            if (request.Forward.Length > 0) node.AddValue("forward", request.Forward);

            try
            {
                var built = method.Invoke(null, new object[] { node, antenna });
                if (built == null)
                {
                    fault = "LoadFromConfig returned null, which means the mode name '"
                        + request.Mode + "' is not one it branches on";
                }
                return built;
            }
            catch (Exception ex)
            {
                fault = "LoadFromConfig threw: " + (ex.InnerException?.Message ?? ex.Message);
                return null;
            }
        }

        private static string AssignTarget(object antenna, object? target)
        {
            try
            {
                var property = antenna.GetType()
                    .GetProperty("Target", BindingFlags.Public | BindingFlags.Instance);
                if (property == null || !property.CanWrite)
                {
                    return "FAILED: " + antenna.GetType().FullName + " has no writable Target property";
                }
                property.SetValue(antenna, target, null);
                return "assigned";
            }
            catch (Exception ex)
            {
                return "FAILED: threw: " + (ex.InnerException?.Message ?? ex.Message);
            }
        }

        /// <summary>
        /// What the craft's SAVED state now says, read straight off the snapshot the
        /// setter writes to. This is the half of the persistence question that does
        /// not need a reload: if the node is not here, nothing will be written out.
        /// </summary>
        private static string ReadSnapshotTarget(object antenna)
        {
            try
            {
                var snapshot = ReadObject(antenna, "ParentSnapshot");
                if (snapshot == null)
                {
                    return "(no ParentSnapshot: this antenna belongs to a LOADED vessel, "
                        + "whose target is written on save from the live module instead)";
                }
                var values = snapshot.GetType()
                    .GetField("moduleValues", BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(snapshot) as ConfigNode;
                if (values == null) return "(ProtoPartModuleSnapshot.moduleValues unreadable)";
                var target = values.GetNode("TARGET");
                if (target == null) return "ABSENT: moduleValues carries no TARGET node";
                return "present: " + target.ToString().Replace("\n", " ").Replace("\r", "");
            }
            catch (Exception ex)
            {
                return "FAILED: threw: " + ex.Message;
            }
        }


        private static string Discover(Vessel vessel)
        {
            try
            {
                var connection = vessel.connection;
                if (connection == null) return "SKIPPED: vessel.connection is null";
                var method = connection.GetType()
                    .GetMethod("DiscoverAntennas", BindingFlags.Public | BindingFlags.Instance);
                if (method == null)
                {
                    return "FAILED: " + connection.GetType().FullName + " has no DiscoverAntennas()";
                }
                var result = method.Invoke(connection, null);
                var count = result is ICollection list ? list.Count : -1;
                return count < 0 ? "invoked" : "invoked (" + count + " antenna(s))";
            }
            catch (Exception ex)
            {
                return "FAILED: threw: " + (ex.InnerException?.Message ?? ex.Message);
            }
        }

        private static string Invalidate()
        {
            try
            {
                var network = NetworkBehind(out var fault);
                if (network == null) return "FAILED: " + fault;
                var method = network.GetType()
                    .GetMethod("InvalidateCache", BindingFlags.Public | BindingFlags.Instance);
                if (method == null)
                {
                    return "FAILED: " + network.GetType().FullName + " has no InvalidateCache()";
                }
                method.Invoke(network, null);
                return "invoked";
            }
            catch (Exception ex)
            {
                return "FAILED: threw: " + ex.Message;
            }
        }

        private static string SaveGame()
        {
            try
            {
                GamePersistence.SaveGame("persistent", HighLogic.SaveFolder, SaveMode.OVERWRITE);
                return "persistent.sfs written";
            }
            catch (Exception ex)
            {
                return "FAILED: threw: " + ex.Message;
            }
        }


        /// <summary>
        /// The network behaviour the scene's CommNet scenario is driving, whatever it
        /// turns out to be. A stock scenario has no <c>Network</c> property, so the
        /// absence of one IS the answer that no replacement backend is installed.
        /// </summary>
        private static object? NetworkBehind(out string fault)
        {
            fault = "";
            var instance = CommNetScenario.Instance;
            if (instance == null)
            {
                fault = "CommNetScenario.Instance is null, so nothing is driving CommNet";
                return null;
            }
            var network = instance.GetType()
                .GetProperty("Network", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(instance, null);
            if (network == null)
            {
                fault = instance.GetType().FullName
                    + " exposes no Network, so the stock scenario is driving CommNet "
                    + "and there is no precompute to invalidate";
                return null;
            }
            return network;
        }

        /// <summary>The link graph that network holds, which is what owns the mirror.</summary>
        private static object? GraphBehind(out string fault)
        {
            var network = NetworkBehind(out fault);
            if (network == null) return null;
            var commNet = network.GetType()
                .GetProperty("CommNet", BindingFlags.Public | BindingFlags.Instance)
                ?.GetValue(network, null);
            if (commNet == null)
            {
                fault = network.GetType().FullName + " has no CommNet graph";
                return null;
            }
            return commNet;
        }

        private static object? FindAntenna(Vessel vessel, int index, Watch watch, out string fault)
        {
            fault = "";
            try
            {
                var comm = vessel.Connection?.Comm;
                if (comm == null)
                {
                    fault = "the vessel has no CommNode";
                    return null;
                }
                var list = comm.GetType()
                    .GetProperty("RAAntennaList", BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(comm, null) as IList;
                if (list == null)
                {
                    fault = comm.GetType().FullName
                        + " has no RAAntennaList, so no beam-modelling backend is driving this node";
                    return null;
                }
                watch.AntennaCount = list.Count.ToString(CultureInfo.InvariantCulture);
                if (index < 0 || index >= list.Count)
                {
                    fault = "antennaIndex " + index + " is outside the node's "
                        + list.Count + " antenna(s)";
                    return null;
                }
                return list[index];
            }
            catch (Exception ex)
            {
                fault = "walking the node threw: " + ex.Message;
                return null;
            }
        }

        private static Vessel? FindVessel(string selector)
        {
            if (selector.Length == 0) return null;
            foreach (var vessel in FlightGlobals.Vessels)
            {
                if (vessel == null) continue;
                if (string.Equals(vessel.id.ToString(), selector, StringComparison.OrdinalIgnoreCase))
                {
                    return vessel;
                }
            }
            foreach (var vessel in FlightGlobals.Vessels)
            {
                if (vessel == null) continue;
                if (string.Equals(vessel.GetDisplayName(), selector, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(vessel.vesselName, selector, StringComparison.OrdinalIgnoreCase))
                {
                    return vessel;
                }
            }
            return null;
        }

        private static string Read(object instance, string member)
        {
            var value = ReadObject(instance, member);
            return value == null ? "null" : value.ToString();
        }

        private static object? ReadObject(object instance, string member)
        {
            try
            {
                var type = instance.GetType();
                var property = type.GetProperty(
                    member, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                if (property != null) return property.GetValue(instance, null);
                var field = type.GetField(
                    member, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                return field?.GetValue(instance);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static int ParseInt(string? raw, int fallback) =>
            int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v)
                ? v : fallback;

        private static double ParseDouble(string? raw, double fallback) =>
            double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)
                ? v : fallback;

        private static bool ParseBool(string? raw, bool fallback) =>
            bool.TryParse(raw, out var v) ? v : fallback;

        private void WriteResult(Watch watch)
        {
            if (_resultPath == null) return;
            try
            {
                var sb = new StringBuilder();
                sb.AppendLine("ANTENNATARGETRESULT");
                sb.AppendLine("{");
                sb.AppendLine("  id = " + watch.Id);
                sb.AppendLine("  ok = " + watch.Ok);
                sb.AppendLine("  summary = " + watch.Summary);
                sb.AppendLine("  vessel = " + watch.VesselName);
                sb.AppendLine("  vesselId = " + watch.VesselId);
                sb.AppendLine("  loadState = " + watch.Loaded);
                sb.AppendLine("  antenna = " + watch.AntennaName);
                sb.AppendLine("  antennaCount = " + watch.AntennaCount);
                sb.AppendLine("  parentSnapshot = " + watch.ParentSnapshot);
                sb.AppendLine("  parentModule = " + watch.Parent);
                sb.AppendLine("  loadFromConfig = " + watch.LoadFromConfig);
                sb.AppendLine("  assign = " + watch.Assign);
                sb.AppendLine("  discoverAntennas = " + watch.DiscoverAntennas);
                sb.AppendLine("  invalidateCache = " + watch.InvalidateCache);
                sb.AppendLine("  saveGame = " + watch.SaveGame);
                sb.AppendLine("  snapshotTarget = " + watch.SnapshotTargetNode);
                AppendLayers(sb, watch.Before);
                foreach (var layers in watch.After) AppendLayers(sb, layers);
                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "writing the result failed: " + ex.Message);
            }
        }

        private static void AppendLayers(StringBuilder sb, Layers layers)
        {
            sb.AppendLine("  SAMPLE");
            sb.AppendLine("  {");
            sb.AppendLine("    label = " + layers.Label);
            sb.AppendLine("    sinceApplySeconds = "
                + layers.SinceApplySeconds.ToString("F1", CultureInfo.InvariantCulture));
            sb.AppendLine("    target = " + layers.Target);
            sb.AppendLine("    isTracking = " + layers.IsTracking);
            sb.AppendLine("    canTarget = " + layers.CanTarget);
            sb.AppendLine("    shape = " + layers.Shape);
            sb.AppendLine("    beamwidthDeg = " + layers.Beamwidth);
            sb.AppendLine("    mirrorIsTracking = " + layers.MirrorIsTracking);
            if (layers.MirrorFault.Length > 0)
            {
                sb.AppendLine("    mirrorFault = " + layers.MirrorFault);
            }
            sb.AppendLine("    connected = " + layers.Connected);
            sb.AppendLine("    hopsHome = " + layers.HopsHome);
            sb.AppendLine("  }");
        }
    }
}
