using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls a request file
    /// (<c>PluginData/timewarp-request.cfg</c>, next to this assembly) and sets
    /// the game's warp rate, so an SSH-only test controller can measure the
    /// sampling cadence at rates a human would otherwise have to click through.
    ///
    /// Request format (mirrors <see cref="GonogoDevTeleport"/>'s TELEPORT node):
    /// <code>
    /// TIMEWARP
    /// {
    ///     id = &lt;unique string, e.g. a timestamp&gt;
    ///     index = 5
    ///     mode = rails   // rails | physics, optional; absent leaves the mode alone
    /// }
    /// </code>
    ///
    /// <para><b>The result reports what the game ACHIEVED, never what was
    /// asked.</b> KSP refuses warp rates it considers unsafe for the vessel's
    /// altitude and situation, and it does so by clamping rather than by
    /// failing, so a result echoing the request would report a rate the game is
    /// not running at. <c>achievedIndex</c> and <c>achievedRate</c> are read
    /// back from <c>TimeWarp</c> after a settle delay, and
    /// <c>maxRateIndexForAltitude</c> says what the ceiling was, so a clamp is
    /// visible as a clamp rather than as a mystery.</para>
    ///
    /// <para>Rails and physics warp are different regimes and the caller has to
    /// say which it wants: rails skips physics entirely and is what high rates
    /// mean, physics keeps the simulation running and stops at 4x.</para>
    ///
    /// With no request file, the production-safe default, nothing here does
    /// anything at all.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevTimeWarp : MonoBehaviour
    {
        private const string LogPrefix = "[Gonogo] dev-timewarp: ";
        private const float PollIntervalSeconds = 1f;

        /// <summary>
        /// Polls to wait after applying before reading the rate back. KSP ramps
        /// through the intervening rungs rather than jumping, so reading in the
        /// same frame reports the rate it was leaving rather than the one it
        /// settled at.
        /// </summary>
        private const int SettlePolls = 3;

        private float _sinceLastPoll;
        private string? _requestPath;
        private string? _resultPath;
        private DevRequestLedger? _ledger;

        private string? _pendingId;
        private int _pendingRequestedIndex;
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
                _requestPath = Path.Combine(pluginData, "timewarp-request.cfg");
                _resultPath = Path.Combine(pluginData, "timewarp-result.cfg");
                _ledger = new DevRequestLedger(Path.Combine(pluginData, "timewarp-applied.cfg"));
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
                        ReportAchieved(_pendingId!, _pendingRequestedIndex);
                        _pendingId = null;
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
            var node = root?.GetNode("TIMEWARP");
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
                WriteResult(id!, ok: false, DevRequestLedger.PredatesSessionMessage, -1, null);
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            try
            {
                var rawIndex = node.GetValue("index");
                if (string.IsNullOrEmpty(rawIndex)
                    || !int.TryParse(rawIndex, NumberStyles.Integer, CultureInfo.InvariantCulture, out var index)
                    || index < 0)
                {
                    WriteResult(id, ok: false, "missing/invalid 'index'", -1, null);
                    return;
                }

                if (TimeWarp.fetch == null)
                {
                    WriteResult(id, ok: false, "no TimeWarp in this scene", index, null);
                    return;
                }

                var mode = node.GetValue("mode");
                if (!string.IsNullOrEmpty(mode))
                {
                    if (string.Equals(mode, "rails", StringComparison.OrdinalIgnoreCase))
                    {
                        TimeWarp.fetch.Mode = TimeWarp.Modes.HIGH;
                    }
                    else if (string.Equals(mode, "physics", StringComparison.OrdinalIgnoreCase))
                    {
                        TimeWarp.fetch.Mode = TimeWarp.Modes.LOW;
                    }
                    else
                    {
                        WriteResult(id, ok: false, "unknown mode '" + mode + "', expected rails or physics", index, null);
                        return;
                    }
                }

                var rungs = TimeWarp.fetch.Mode == TimeWarp.Modes.LOW
                    ? TimeWarp.fetch.physicsWarpRates
                    : TimeWarp.fetch.warpRates;
                if (rungs == null || index >= rungs.Length)
                {
                    WriteResult(id, ok: false,
                        "index " + index + " is off the ladder (" + (rungs?.Length ?? 0) + " rungs in this mode)",
                        index, null);
                    return;
                }

                // Not instant: letting KSP ramp is what makes a refusal show up
                // as a clamp we can report rather than as a rate it never held.
                TimeWarp.SetRate(index, false);

                _pendingId = id;
                _pendingRequestedIndex = index;
                _pendingPollsLeft = SettlePolls;
                Debug.Log(LogPrefix + "requested index " + index + "; reporting achieved rate in "
                    + SettlePolls + " polls");
            }
            catch (Exception ex)
            {
                WriteResult(id, ok: false, "exception: " + ex.Message, -1, null);
            }
        }

        private void ReportAchieved(string id, int requestedIndex)
        {
            try
            {
                int? maxForAltitude = null;
                var vessel = FlightGlobals.ActiveVessel;
                if (vessel != null && vessel.mainBody != null && TimeWarp.fetch != null)
                {
                    maxForAltitude = TimeWarp.fetch.GetMaxRateForAltitude(vessel.altitude, vessel.mainBody);
                }

                var achieved = TimeWarp.CurrentRateIndex;
                var ok = achieved == requestedIndex;
                var message = ok
                    ? "achieved the requested rung"
                    : "CLAMPED: asked " + requestedIndex + ", running " + achieved;
                WriteResult(id, ok, message, requestedIndex, maxForAltitude);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed reading back the rate: " + ex.Message);
            }
        }

        private void WriteResult(string id, bool ok, string message, int requestedIndex, int? maxRateIndexForAltitude)
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
                sb.AppendLine("\trequestedIndex = " + requestedIndex.ToString(CultureInfo.InvariantCulture));
                sb.AppendLine("\tachievedIndex = " + TimeWarp.CurrentRateIndex.ToString(CultureInfo.InvariantCulture));
                sb.AppendLine("\tachievedRate = " + TimeWarp.CurrentRate.ToString("R", CultureInfo.InvariantCulture));
                sb.AppendLine("\tmode = " + TimeWarp.WarpMode);
                sb.AppendLine("\tmaxRateIndexForAltitude = "
                    + (maxRateIndexForAltitude.HasValue
                        ? maxRateIndexForAltitude.Value.ToString(CultureInfo.InvariantCulture)
                        : "unknown"));
                sb.AppendLine("\tmessage = " + message);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }
    }
}
