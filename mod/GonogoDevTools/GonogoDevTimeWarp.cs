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
    /// Request format (mirrors <see cref="GonogoDevTeleport"/>'s teleport node):
    /// <code>
    /// TIMEWARP
    /// {
    ///     id = &lt;unique string, e.g. a timestamp&gt;
    ///     index = 5
    ///     mode = rails   // rails | physics, optional; absent leaves the mode alone
    /// }
    /// </code>
    ///
    /// <para><b>The result reports what the game achieved, never what was
    /// asked.</b> KSP refuses warp rates it considers unsafe for the vessel's
    /// altitude and situation, and it does so by clamping rather than by
    /// failing, so a result echoing the request would report a rate the game is
    /// not running at. <c>achievedIndex</c> and <c>achievedRate</c> are read
    /// back from <c>TimeWarp</c> after a settle delay, and
    /// <c>maxRateIndexForAltitude</c> says what the ceiling was.</para>
    ///
    /// <para>KSP also re-checks an on-rails warp every physics frame and lowers
    /// it at once, so the read-back alone cannot say whether a rung was reached.
    /// <c>peakIndex</c> is the highest rung the game ran at after the request,
    /// <c>changes</c> lists every rate change with its time since the request
    /// and the reason KSP's limit check gave, and <c>message</c> says when and
    /// why a reached rung was lowered.</para>
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
        private WarpTrace? _trace;
        private float _requestedAt;

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
                GameEvents.onTimeWarpRateChanged.Add(OnRateChanged);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void OnDestroy()
        {
            GameEvents.onTimeWarpRateChanged.Remove(OnRateChanged);
        }

        /*
         * Fires from the game's own rate assignment, so it sees the changes that
         * happen between polls: KSP re-checks an on-rails warp every physics
         * frame and lowers it at once, which a read-back seconds later cannot
         * tell from a rung that was never reached.
         */
        private void OnRateChanged()
        {
            var trace = _trace;
            var fetch = TimeWarp.fetch;
            if (trace == null || fetch == null)
            {
                return;
            }

            try
            {
                var index = TimeWarp.CurrentRateIndex;
                var rungs = fetch.Mode == TimeWarp.Modes.LOW ? fetch.physicsWarpRates : fetch.warpRates;
                var rate = rungs != null && index >= 0 && index < rungs.Length ? rungs[index] : TimeWarp.CurrentRate;
                var reason = index < trace.RequestedIndex && fetch.Mode == TimeWarp.Modes.HIGH
                    ? LimitReason(fetch, trace.RequestedIndex)
                    : null;
                trace.Record(Time.realtimeSinceStartup - _requestedAt, index, rate, reason);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "could not record a rate change: " + ex.Message);
            }
        }

        /*
         * KSP's limit check is private and answers with an enum the game only
         * turns into a screen message, so it is asked again through reflection
         * with the rung the request wanted.
         */
        private static string? LimitReason(TimeWarp fetch, int requestedIndex)
        {
            var method = typeof(TimeWarp).GetMethod(
                "getMaxOnRailsRateIdx", BindingFlags.Instance | BindingFlags.NonPublic);
            if (method == null)
            {
                return null;
            }

            var args = new object?[] { requestedIndex, true, null };
            method.Invoke(fetch, args);
            var status = args[2]?.ToString();
            return status == "CLEAR" ? null : status;
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
                if (!string.IsNullOrEmpty(mode) && !TrySetMode(mode))
                {
                    WriteResult(id, ok: false, "unknown mode '" + mode + "', expected rails or physics", index, null);
                    return;
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

                _trace = new WarpTrace(index);
                _requestedAt = Time.realtimeSinceStartup;

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

        private static bool TrySetMode(string mode)
        {
            if (string.Equals(mode, "rails", StringComparison.OrdinalIgnoreCase))
            {
                TimeWarp.fetch.Mode = TimeWarp.Modes.HIGH;
                return true;
            }
            if (!string.Equals(mode, "physics", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            TimeWarp.fetch.Mode = TimeWarp.Modes.LOW;
            return true;
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

                var trace = _trace ?? new WarpTrace(requestedIndex);
                var (ok, message) = trace.Verdict(TimeWarp.CurrentRateIndex);
                WriteResult(id, ok, message, requestedIndex, maxForAltitude, trace.Describe());
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed reading back the rate: " + ex.Message);
            }
        }

        private void WriteResult(string id, bool ok, string message, int requestedIndex, int? maxRateIndexForAltitude, string? changes = null)
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
                sb.AppendLine("\tpeakIndex = " + (_trace?.PeakIndex ?? -1).ToString(CultureInfo.InvariantCulture));
                sb.AppendLine("\tchanges = " + (changes ?? ""));
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
