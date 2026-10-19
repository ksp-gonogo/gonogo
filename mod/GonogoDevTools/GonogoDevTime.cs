using System;
using System.IO;
using System.Reflection;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls a request file (<c>PluginData/time-request.cfg</c>, next
    /// to this assembly) that moves game time forward and reads the sun's height, so
    /// rig camera comparisons can start at the same time of day.
    ///
    /// Request format (same shape as <see cref="GonogoDevTimeWarp"/>'s node):
    /// <code>
    /// TIME
    /// {
    ///     id = &lt;unique string, e.g. a timestamp&gt;
    ///     setut = 1234567.0        // optional: move to this universal time, forward only
    ///     sunelev = true           // optional: report the sun's elevation in degrees
    ///     lat = 9.45               // optional with sunelev, degrees north; goes with lon
    ///     lon = -172.11            // optional with sunelev, degrees east; goes with lat
    /// }
    /// </code>
    /// At least one of <c>setut</c> and <c>sunelev</c> is required. With both, the
    /// elevation is read after the move. Without <c>lat</c> and <c>lon</c> the elevation
    /// is taken at the active vessel's position, on its body; with them, on the active
    /// vessel's body, or Kerbin when there is no active vessel. The elevation is for a
    /// point 1 m above the terrain at that spot.
    ///
    /// <para>The result goes to <c>PluginData/time-result.cfg</c> as a <c>RESULT</c> node:
    /// <c>applied</c> (the request id), <c>ok</c>, <c>requestedUt</c>, <c>achievedUt</c>
    /// (the game's UT read back after a settle delay, never the requested one),
    /// <c>sunElevationDeg</c>, <c>lat</c>, <c>lon</c>, <c>body</c>, <c>message</c> and
    /// <c>time</c>. A figure the request did not ask for reads <c>unknown</c>.</para>
    ///
    /// <para>A <c>setut</c> earlier than the current UT is refused with a reason and
    /// changes nothing. A request id that was already applied, or a request file written
    /// before this KSP session started, is handled by <see cref="DevRequestLedger"/> like
    /// the other one-shot tools: bump the id to run the same request again.</para>
    ///
    /// With no request file, the production-safe default, nothing here does anything at all.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevTime : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-time: ";
        private const float PollIntervalSeconds = 1f;

        /// <summary>
        /// Polls to wait after moving time before reading it back, so vessel and body
        /// positions have been updated to the new UT when the sun is measured.
        /// </summary>
        private const int SettlePolls = 1;

        private float _sinceLastPoll;
        private string? _requestPath;
        private string? _resultPath;
        private DevRequestLedger? _ledger;

        private string? _pendingId;
        private TimeRequest? _pendingRequest;
        private int _pendingPollsLeft;

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
                _requestPath = Path.Combine(pluginData, "time-request.cfg");
                _resultPath = Path.Combine(pluginData, "time-result.cfg");
                _ledger = new DevRequestLedger(Path.Combine(pluginData, "time-applied.cfg"));
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void Update()
        {
            _sinceLastPoll += Time.unscaledDeltaTime;
            if (_sinceLastPoll < PollIntervalSeconds)
            {
                return;
            }
            _sinceLastPoll = 0f;

            try
            {
                if (_pendingId != null)
                {
                    _pendingPollsLeft--;
                    if (_pendingPollsLeft <= 0)
                    {
                        var id = _pendingId;
                        var request = _pendingRequest!;
                        _pendingId = null;
                        _pendingRequest = null;
                        Report(id, request);
                    }
                    return;
                }

                Poll();
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "poll failed: " + ex.Message);
            }
        }

        private void Poll()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                return;
            }

            var root = ConfigNode.Load(_requestPath);
            var node = root?.GetNode("TIME");
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

            var decision = _ledger!.Admit(id!, File.GetLastWriteTimeUtc(_requestPath), out var stampFailure);
            if (stampFailure != null)
            {
                Debug.LogWarning(LogPrefix + "could not stamp id=" + id
                    + " as applied, so a restart may apply it again: " + stampFailure);
            }

            if (decision == DevRequestDecision.AlreadyApplied)
            {
                return;
            }

            if (decision == DevRequestDecision.PredatesSession)
            {
                Debug.LogWarning(LogPrefix + "request id=" + id + " predates this KSP session; refused");
                WriteRefusal(id!, DevRequestLedger.PredatesSessionMessage, null);
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            double? requestedUt = null;
            try
            {
                var request = TimeRequest.Parse(key => node.GetValue(key), out var error);
                if (request == null)
                {
                    WriteRefusal(id, error ?? "invalid request", null);
                    return;
                }
                requestedUt = request.SetUt;

                if (request.SetUt.HasValue)
                {
                    if (Planetarium.fetch == null)
                    {
                        WriteRefusal(id, "no Planetarium in this scene", requestedUt);
                        return;
                    }

                    var refusal = TimeRequest.RefuseBackwards(Planetarium.GetUniversalTime(), request.SetUt.Value);
                    if (refusal != null)
                    {
                        WriteRefusal(id, refusal, requestedUt);
                        return;
                    }

                    Planetarium.SetUniversalTime(request.SetUt.Value);
                }

                _pendingId = id;
                _pendingRequest = request;
                _pendingPollsLeft = SettlePolls;
                Debug.Log(LogPrefix + "applied id=" + id + "; reporting in " + SettlePolls + " polls");
            }
            catch (Exception ex)
            {
                WriteRefusal(id, "exception: " + ex.Message, requestedUt);
            }
        }

        private void Report(string id, TimeRequest request)
        {
            try
            {
                var achievedUt = Planetarium.GetUniversalTime();
                double? elevation = null;
                double? lat = null;
                double? lon = null;
                string? bodyName = null;
                var message = "ok";
                var ok = true;

                if (request.SunElevation)
                {
                    ok = TryMeasureSun(request, out elevation, out lat, out lon, out bodyName, out var failure);
                    if (!ok)
                    {
                        message = failure;
                    }
                }

                if (ok && request.SetUt.HasValue && Math.Abs(achievedUt - request.SetUt.Value) > 1.0)
                {
                    ok = false;
                    message = "MISSED: asked " + TimeRequest.Number(request.SetUt.Value)
                        + ", running " + TimeRequest.Number(achievedUt);
                }

                WriteResult(id, ok, message, request.SetUt, achievedUt, elevation, lat, lon, bodyName);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed reporting: " + ex.Message);
                WriteRefusal(id, "exception: " + ex.Message, request.SetUt);
            }
        }

        private static bool TryMeasureSun(
            TimeRequest request, out double? elevation, out double? lat, out double? lon,
            out string? bodyName, out string failure)
        {
            elevation = null;
            lat = null;
            lon = null;
            bodyName = null;
            failure = "";

            var vessel = FlightGlobals.ActiveVessel;
            CelestialBody? body = vessel?.mainBody;
            if (body == null)
            {
                body = FlightGlobals.Bodies?.Find(b => b.bodyName == "Kerbin");
            }
            if (body == null)
            {
                failure = "no body to measure the sun on";
                return false;
            }

            if (!TryPosition(request, vessel, out lat, out lon))
            {
                failure = "no lat and lon given and no active vessel to take them from";
                return false;
            }

            bodyName = body.bodyName;
            var sun = Planetarium.fetch?.Sun;
            if (sun == null)
            {
                failure = "no sun in this scene";
                return false;
            }

            var spot = body.GetWorldSurfacePosition(lat.Value, lon.Value, body.TerrainAltitude(lat.Value, lon.Value) + 1.0);
            var up = spot - body.position;
            var towardsSun = sun.position - spot;
            var degrees = SunElevation.Degrees(up.x, up.y, up.z, towardsSun.x, towardsSun.y, towardsSun.z);
            if (double.IsNaN(degrees))
            {
                failure = "the sun's elevation could not be worked out";
                return false;
            }

            elevation = degrees;
            return true;
        }

        private static bool TryPosition(TimeRequest request, Vessel? vessel, out double? lat, out double? lon)
        {
            lat = request.Latitude ?? vessel?.latitude;
            lon = request.Longitude ?? vessel?.longitude;
            return lat.HasValue && lon.HasValue;
        }

        private void WriteRefusal(string id, string message, double? requestedUt)
        {
            WriteResult(id, ok: false, message, requestedUt, CurrentUt(), null, null, null, null);
        }

        private static double? CurrentUt()
        {
            return Planetarium.fetch != null ? Planetarium.GetUniversalTime() : (double?)null;
        }

        private void WriteResult(
            string id, bool ok, string message, double? requestedUt, double? achievedUt,
            double? elevation, double? lat, double? lon, string? body)
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

                File.WriteAllText(_resultPath, TimeResult.Render(
                    id, ok, message, requestedUt, achievedUt, elevation, lat, lon, body, DateTime.UtcNow));
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }
    }
}
