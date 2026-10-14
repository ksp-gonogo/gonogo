using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. In flight, polls a request file
    /// (<c>PluginData/teleport-request.cfg</c>, next to this assembly) and, on a
    /// new request, teleports the active vessel into a specified orbit around a
    /// specified body. This lets a headless automated test place a vessel
    /// anywhere; kRPC 0.5.4 has no set-orbit / cheat
    /// API.
    ///
    /// This mirrors KSP's own Alt+F12 "Set Ship Orbit" cheat exactly: the stock
    /// debug window (decompiled <c>Assembly-CSharp</c>) calls
    /// <code>
    ///   FlightGlobals.fetch.SetShipOrbit(selBodyIndex, ecc, sma, inc, LAN, MnA, lPe, ObT);
    /// </code>
    /// and that public method runs the safe stock sequence internally
    /// (<c>PrepForOrbitSet</c>: clear Landed/Splashed, SetLandedAt, kill ground
    /// contact, put every unpacked vessel <c>GoOnRails()</c>, set dominant body;
    /// then <c>ActiveVessel.orbit.SetOrbit(inc, ecc, sma, LAN, argPe, mna, UT, body)</c>
    /// clamped to <c>SOI * 0.99</c>; then <c>PostOrbitSet</c>: updateFromParameters,
    /// bypass collision, FloatingOrigin.SetOffset, CheckReferenceFrame,
    /// HoldVesselUnpack(10), fire SOI-changed, IgnoreGForces/IgnoreSpeed). We call
    /// that same public entry point rather than re-implementing the sequence, so
    /// we inherit whatever stock does on this KSP version.
    ///
    /// <b>not</b> production behaviour. Lives in the Deck-only GonogoDevTools
    /// assembly and is never shipped. With no request file (the production
    /// default), this addon does nothing at all.
    ///
    /// <c>once: false</c> re-instantiates this every time the flight scene loads.
    /// <see cref="DevRequestLedger"/> applies a request once across scene reloads and
    /// restarts, and refuses one written before the running session started.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevTeleport : MonoBehaviour
    {
        /// <summary>Keys a teleport node may carry. Anything else is a refusal:
        /// this addon used to ignore a name it did not recognise, so a request
        /// saying <c>periKm</c> instead of <c>periapsisKm</c> silently placed the
        /// craft somewhere else entirely and read as a successful setup.</summary>
        private static readonly string[] DropKeys =
        {
            "id", "body", "latitudeDeg", "longitudeDeg", "heightAboveTerrainM", "headingDeg",
        };

        private static readonly string[] KnownKeys =
        {
            "id", "body", "periapsisKm", "apoapsisKm", "inclinationDeg", "meanAnomalyDeg", "altitudeAboveTerrainM",
        };

        private const float PollIntervalSeconds = 1f;
        private float _sinceLastPoll;

        private string? _requestPath;
        private string? _resultPath;
        private DevRequestLedger? _ledger;

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
                _requestPath = Path.Combine(pluginData, "teleport-request.cfg");
                _resultPath = Path.Combine(pluginData, "teleport-result.cfg");
                _ledger = new DevRequestLedger(Path.Combine(pluginData, "teleport-applied.cfg"));
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-teleport: Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void Update()
        {
            // Modest cadence - NOT every frame.
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
                Debug.LogError("[Gonogo] dev-teleport: poll failed: " + ex.Message);
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
            var node = root?.GetNode("TELEPORT") ?? root?.GetNode("DROP");
            if (node == null)
            {
                return;
            }

            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogError("[Gonogo] dev-teleport: request has no 'id'; ignoring");
                return;
            }

            var decision = _ledger!.Admit(id!, File.GetLastWriteTimeUtc(_requestPath), out var stampFailure);
            if (stampFailure != null)
            {
                Debug.LogWarning("[Gonogo] dev-teleport: could not stamp id=" + id
                    + " as applied, so a restart may apply it again: " + stampFailure);
            }

            if (decision == DevRequestDecision.AlreadyApplied)
            {
                return;
            }

            if (decision == DevRequestDecision.PredatesSession)
            {
                Debug.LogWarning("[Gonogo] dev-teleport: request id=" + id + " predates this KSP session; refused");
                WriteResult(id!, ok: false, DevRequestLedger.PredatesSessionMessage);
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            if (node.name == "DROP")
            {
                ApplyDrop(id, node);
                return;
            }

            try
            {
                var unknown = UnknownKeys(node, KnownKeys);
                if (unknown.Length > 0)
                {
                    Debug.LogError("[Gonogo] dev-teleport: request id=" + id
                        + " names unknown field(s) " + unknown + "; nothing was applied");
                    WriteResult(id, ok: false, "unknown field name(s) " + unknown
                        + "; this addon accepts only " + string.Join(", ", KnownKeys) + ". Nothing was applied.");
                    return;
                }

                var vessel = FlightGlobals.ActiveVessel;
                if (vessel == null)
                {
                    WriteResult(id, ok: false, "no active vessel");
                    return;
                }

                var bodyName = node.GetValue("body");
                if (string.IsNullOrEmpty(bodyName))
                {
                    WriteResult(id, ok: false, "missing 'body'");
                    return;
                }

                var body = FindBody(bodyName!);
                if (body == null)
                {
                    WriteResult(id, ok: false, "unknown body '" + bodyName + "'");
                    return;
                }

                if (!TryGetDouble(node, "periapsisKm", out var periKm))
                {
                    WriteResult(id, ok: false, "missing/invalid 'periapsisKm'");
                    return;
                }
                if (!TryGetDouble(node, "apoapsisKm", out var apoKm))
                {
                    WriteResult(id, ok: false, "missing/invalid 'apoapsisKm'");
                    return;
                }

                // inclination is optional, default 0.
                if (!TryGetDouble(node, "inclinationDeg", out var inclinationDeg))
                {
                    inclinationDeg = 0.0;
                }

                // Optional, default 0 (periapsis); 180 places the craft at apoapsis.
                if (!TryGetDouble(node, "meanAnomalyDeg", out var meanAnomalyDeg))
                {
                    meanAnomalyDeg = 0.0;
                }

                // Optional: the height above the terrain under the placed point.
                // Absent leaves the point where the orbit puts it.
                var wantsHeight = TryGetDouble(node, "altitudeAboveTerrainM", out var requestedHeightM);

                var (sma, ecc) = OrbitFromApsides(body.Radius, periKm, apoKm);

                Debug.Log(string.Format(CultureInfo.InvariantCulture,
                    "[Gonogo] dev-teleport: request id={0} body={1} periKm={2} apoKm={3} incDeg={4} mnaDeg={5} -> sma={6:F1} ecc={7:F6}",
                    id, body.bodyName, periKm, apoKm, inclinationDeg, meanAnomalyDeg, sma, ecc));

                var bodyIndex = FlightGlobals.Bodies.IndexOf(body);
                if (bodyIndex < 0)
                {
                    WriteResult(id, ok: false, "body '" + body.bodyName + "' not in FlightGlobals.Bodies");
                    return;
                }

                // Mirror the stock Alt+F12 "Set Ship Orbit" cheat exactly. This
                // public method runs KSP's own PrepForOrbitSet / SetOrbit /
                // PostOrbitSet sequence internally.
                //   SetShipOrbit(selBodyIndex, ecc, sma, inc, LAN, mna, argPe, ObT)
                // inclination is degrees (Orbit.inclination is degrees); LAN and
                // argumentOfPeriapsis default to 0; mna is radians, taken from the
                // request's degrees; ObT is unused by SetShipOrbit (it uses
                // Planetarium.GetUniversalTime()).
                FlightGlobals.fetch.SetShipOrbit(
                    bodyIndex,
                    ecc,
                    sma,
                    inclinationDeg,
                    /* LAN */ 0.0,
                    /* mna */ TeleportAnomaly.ToRadians(meanAnomalyDeg),
                    /* argPe */ 0.0,
                    /* ObT */ 0.0);

                var heightNote = "";
                if (wantsHeight)
                {
                    heightNote = PlaceAboveTerrain(
                        bodyIndex, body, vessel, ref periKm, ref apoKm, inclinationDeg, meanAnomalyDeg, requestedHeightM);
                    (sma, ecc) = OrbitFromApsides(body.Radius, periKm, apoKm);
                }

                Debug.Log("[Gonogo] dev-teleport: applied request id=" + id + heightNote);
                WriteResult(id, ok: true,
                    string.Format(CultureInfo.InvariantCulture,
                        "teleported {0} to {1} peri={2}km apo={3}km inc={4}deg mna={5}deg (sma={6:F1} ecc={7:F6})",
                        vessel.vesselName, body.bodyName, periKm, apoKm, inclinationDeg, meanAnomalyDeg, sma, ecc)
                        + heightNote);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-teleport: teleport failed for id=" + id + ": " + ex);
                WriteResult(id, ok: false, "exception: " + ex.Message);
            }
        }

        /// <summary>
        /// Places the active craft a height above the terrain at a latitude and
        /// longitude, moving with the ground there, through the game's own
        /// set-vessel-position path (it sets state vectors, so the craft has the
        /// ground's speed in the inertial frame), and lets physics take it from
        /// there: the craft unpacks a few physics frames later and falls.
        /// </summary>
        private void ApplyDrop(string id, ConfigNode node)
        {
            try
            {
                var unknown = UnknownKeys(node, DropKeys);
                if (unknown.Length > 0)
                {
                    WriteResult(id, ok: false, "unknown field name(s) " + unknown
                        + "; a DROP accepts only " + string.Join(", ", DropKeys) + ". Nothing was applied.");
                    return;
                }

                var vessel = FlightGlobals.ActiveVessel;
                if (vessel == null)
                {
                    WriteResult(id, ok: false, "no active vessel");
                    return;
                }

                var body = FindBody(node.GetValue("body") ?? "");
                if (body == null)
                {
                    WriteResult(id, ok: false, "missing or unknown 'body'");
                    return;
                }

                if (!TryGetDouble(node, "latitudeDeg", out var latitude)
                    || !TryGetDouble(node, "longitudeDeg", out var longitude)
                    || !TryGetDouble(node, "heightAboveTerrainM", out var height))
                {
                    WriteResult(id, ok: false, "missing/invalid 'latitudeDeg', 'longitudeDeg' or 'heightAboveTerrainM'");
                    return;
                }

                if (!TryGetDouble(node, "headingDeg", out var heading))
                {
                    heading = 0.0;
                }

                var bodyIndex = FlightGlobals.Bodies.IndexOf(body);
                if (bodyIndex < 0)
                {
                    WriteResult(id, ok: false, "body '" + body.bodyName + "' not in FlightGlobals.Bodies");
                    return;
                }

                FlightGlobals.fetch.SetVesselPosition(
                    bodyIndex, latitude, longitude, height, 0.0, heading, asl: false, easeToSurface: false);

                Read(body, vessel, out var altitudeM, out var terrainM);
                var note = string.Format(CultureInfo.InvariantCulture,
                    "dropped {0} on {1} at lat={2}deg lon={3}deg heading={4}deg; terrain={5:F1}m altitude={6:F1}m heightAboveTerrain={7:F1}m requested={8:F1}m",
                    vessel.vesselName, body.bodyName, latitude, longitude, heading, terrainM, altitudeM, altitudeM - terrainM, height);
                Debug.Log("[Gonogo] dev-teleport: applied drop id=" + id + "; " + note);
                WriteResult(id, ok: true, note);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-teleport: drop failed for id=" + id + ": " + ex);
                WriteResult(id, ok: false, "exception: " + ex.Message);
            }
        }

        /// <summary>
        /// Reads the terrain height under the point the orbit placed the craft at
        /// and, when the craft stands lower above it than asked, places it once
        /// more with both apsides raised by the shortfall. Returns the text the
        /// result carries: the terrain height read, the height achieved, and
        /// whether it placed again.
        /// </summary>
        private static string PlaceAboveTerrain(
            int bodyIndex, CelestialBody body, Vessel vessel, ref double periKm, ref double apoKm,
            double inclinationDeg, double meanAnomalyDeg, double requestedHeightM)
        {
            Read(body, vessel, out var altitudeM, out var terrainM);
            var again = TeleportHeight.Correction(periKm, apoKm, altitudeM, terrainM, requestedHeightM);
            var replaced = again.HasValue;
            if (again.HasValue)
            {
                periKm = again.Value.PeriapsisKm;
                apoKm = again.Value.ApoapsisKm;
                var (sma, ecc) = OrbitFromApsides(body.Radius, periKm, apoKm);
                FlightGlobals.fetch.SetShipOrbit(
                    bodyIndex, ecc, sma, inclinationDeg, 0.0, TeleportAnomaly.ToRadians(meanAnomalyDeg), 0.0, 0.0);
                Read(body, vessel, out altitudeM, out terrainM);
            }

            return string.Format(CultureInfo.InvariantCulture,
                "; terrain={0:F1}m altitude={1:F1}m heightAboveTerrain={2:F1}m requested={3:F1}m replaced={4}",
                terrainM, altitudeM, altitudeM - terrainM, requestedHeightM, replaced);
        }

        private static void Read(CelestialBody body, Vessel vessel, out double altitudeM, out double terrainM)
        {
            body.GetLatLonAltOrbital(vessel.orbit.pos, out var latitude, out var longitude, out altitudeM);
            terrainM = body.TerrainAltitude(latitude, longitude);
        }

        /// <summary>
        /// Convert an apoapsis / periapsis pair (km above the body's surface)
        /// into semi-major axis (m) and eccentricity. Handles apo==peri
        /// (circular) and apo/peri given in either order.
        ///
        /// Pure and side-effect free so it can be unit-tested in isolation
        /// (there is no test project in GonogoDevTools today, but this is the
        /// one piece of non-trivial math and is deliberately factored out).
        /// </summary>
        public static (double sma, double ecc) OrbitFromApsides(double bodyRadiusM, double periKm, double apoKm)
        {
            var rP = bodyRadiusM + periKm * 1000.0;
            var rA = bodyRadiusM + apoKm * 1000.0;

            // Periapsis must be the smaller radius; swap if the caller inverted.
            if (rP > rA)
            {
                (rP, rA) = (rA, rP);
            }

            var sma = (rA + rP) / 2.0;
            var ecc = (rA + rP) == 0.0 ? 0.0 : (rA - rP) / (rA + rP);
            return (sma, ecc);
        }

        private static CelestialBody? FindBody(string name)
        {
            var bodies = FlightGlobals.Bodies;
            if (bodies == null)
            {
                return null;
            }

            foreach (var b in bodies)
            {
                if (b != null && string.Equals(b.bodyName, name, StringComparison.OrdinalIgnoreCase))
                {
                    return b;
                }
            }
            return null;
        }

        /// <summary>The names in this teleport node that mean nothing here, comma
        /// separated, or an empty string when every name is one we act on.</summary>
        private static string UnknownKeys(ConfigNode node, string[] accepted)
        {
            var unknown = new List<string>();
            for (var i = 0; i < node.values.Count; i++)
            {
                var name = node.values[i].name;
                var known = false;
                foreach (var candidate in accepted)
                {
                    if (string.Equals(candidate, name, StringComparison.Ordinal))
                    {
                        known = true;
                        break;
                    }
                }
                if (!known)
                {
                    unknown.Add(name);
                }
            }
            return string.Join(", ", unknown.ToArray());
        }

        private static bool TryGetDouble(ConfigNode node, string key, out double value)
        {
            value = 0.0;
            var raw = node.GetValue(key);
            return !string.IsNullOrEmpty(raw)
                && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
        }

        private void WriteResult(string id, bool ok, string message)
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
                sb.AppendLine("\tapplied = " + id);
                sb.AppendLine("\tok = " + (ok ? "True" : "False"));
                sb.AppendLine("\tmessage = " + message);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-teleport: failed writing result: " + ex.Message);
            }
        }
    }
}
