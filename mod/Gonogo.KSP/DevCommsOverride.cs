using System;
using System.IO;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// DEV-ONLY signal-blackout override for <see cref="CommsCoreUplink"/>'s
    /// connectivity capture / reveal-gate source. Lets the GonogoDevTools
    /// mini-mod (Deck-only, never shipped - see its own project comments)
    /// force the active vessel's comms connectivity to disconnected
    /// regardless of what the elected <see cref="ICommsBackend"/>
    /// (stock CommNet or RealAntennas) actually reports, so a headless test
    /// run can reproduce signal-loss bugs (e.g. an uplink command like
    /// <c>kos.keystroke</c> that should be gated/dropped during a blackout)
    /// on demand instead of waiting for a real occlusion/range window.
    ///
    /// <para><b>Cross-assembly contract, no reference either direction:</b>
    /// GonogoDevTools deliberately has zero reference to Sitrep.*/Gonogo.KSP
    /// (see its own csproj comment), so it cannot call into this type
    /// directly - and this production assembly must never reference the
    /// Deck-only dev tooling either. The two sides communicate only through
    /// a well-known cfg file, the same cfg-request-poller pattern
    /// <c>GonogoDevTeleport</c>/<c>GonogoDevAutoLoad</c> already use:
    /// GonogoDevTools' own <c>GonogoDevForceComms</c> addon writes an
    /// acknowledgement/result file for SSH-side visibility, but the actual
    /// override applied here comes from polling the same request file
    /// independently - there is no hand-off, just two readers of one file.</para>
    ///
    /// <para><b>Production-safe by construction:</b> a normal player install
    /// never has a <c>GonogoDevTools</c> assembly loaded in the process, so
    /// <see cref="Current"/> resolves <see cref="DevToolsLoaded"/> to
    /// <c>false</c> on the first check (cached forever after) and never even
    /// touches the filesystem. Only when GonogoDevTools is loaded (Deck test
    /// runs only) does this poll the request file, at a modest 1s cadence.</para>
    /// </summary>
    internal static class DevCommsOverride
    {

        // Matches GonogoDevTeleport's own poll cadence - comms-blackout
        // testing has no tighter latency requirement than teleport does.
        private const float PollIntervalSeconds = 1f;

        // GonogoDevTools' own GonogoDevForceComms addon resolves this same
        // file relative to ITS executing-assembly location. This side has no
        // assembly under GonogoDevTools to resolve from, so the path is the
        // well-known GameData-relative layout every other GonogoDevTools cfg
        // already deploys to (GameData/GonogoDevTools/Plugins/PluginData/*.cfg).
        // Built when read, never in the type initializer: KSPUtil asks Unity
        // for the root path, which throws outside the game, and the type is
        // touched headless whenever the comms Uplink reports its health.
        private static string RequestPath => Path.Combine(
            KSPUtil.ApplicationRootPath, "GameData", "GonogoDevTools", "Plugins", "PluginData", "force-comms-request.cfg");

        private static bool? _devToolsLoaded;
        private static float _lastPollRealtime = float.MinValue;
        private static bool? _cachedMode;
        private static bool _everLogged;
        private static volatile bool _forcingBlackout;

        /// <summary>
        /// Whether the last poll found a blackout forced. Read from any thread
        /// without polling, so the Uplink's health can say so off the main thread.
        /// </summary>
        internal static bool ForcingBlackout => _forcingBlackout;

        /// <summary>
        /// <c>null</c> = no override, use the real elected backend's
        /// connectivity. <c>false</c> = forced disconnected (blackout). Never
        /// <c>true</c>: see <see cref="ModeOf"/>.
        /// </summary>
        internal static bool? Current
        {
            get
            {
                if (!DevToolsLoaded())
                {
                    return null;
                }

                Poll();
                return _cachedMode;
            }
        }

        private static bool DevToolsLoaded()
        {
            if (_devToolsLoaded.HasValue)
            {
                return _devToolsLoaded.Value;
            }

            var found = false;
            try
            {
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    if (string.Equals(asm.GetName().Name, "GonogoDevTools", StringComparison.Ordinal))
                    {
                        found = true;
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                GonogoLog.Warn("dev-comms", "failed enumerating loaded assemblies (treating as not-dev-tools): " + PathRedactor.Redact(ex.Message));
                found = false;
            }

            _devToolsLoaded = found;
            if (found)
            {
                GonogoLog.Info("dev-comms", "GonogoDevTools assembly detected; force-comms override armed, polling " + PathRedactor.Redact(RequestPath));
            }
            return found;
        }

        private static void Poll()
        {
            var now = Time.realtimeSinceStartup;
            if (now - _lastPollRealtime < PollIntervalSeconds)
            {
                return;
            }
            _lastPollRealtime = now;

            bool? resolved;
            try
            {
                if (!File.Exists(RequestPath))
                {
                    resolved = null;
                }
                else
                {
                    var root = ConfigNode.Load(RequestPath);
                    var node = root?.GetNode("FORCECOMMS");
                    var mode = node?.GetValue("mode")?.Trim().ToLowerInvariant();
                    resolved = ModeOf(mode, out var recognised);
                    if (!recognised)
                    {
                        GonogoLog.Warn("dev-comms", "unrecognized mode '" + mode + "' in " + PathRedactor.Redact(RequestPath) + "; treating as 'auto'");
                    }
                }
            }
            catch (Exception ex)
            {
                GonogoLog.Warn("dev-comms", "failed reading " + PathRedactor.Redact(RequestPath) + " (treating as 'auto'): " + PathRedactor.Redact(ex.Message));
                resolved = null;
            }

            if (!_everLogged || resolved != _cachedMode)
            {
                if (resolved == false)
                {
                    GonogoLog.Warn("dev-comms", "mode -> " + DescribeMode(resolved) + ", from " + PathRedactor.Redact(RequestPath) + "; every craft reads out of contact until the request is set to restore");
                }
                else
                {
                    GonogoLog.Info("dev-comms", "mode -> " + DescribeMode(resolved));
                }
                _everLogged = true;
            }
            _cachedMode = resolved;
            _forcingBlackout = resolved == false;
        }

        /// <summary>
        /// The override a request's <c>mode</c> asks for: <c>false</c> for
        /// <c>blackout</c>, and none for everything else.
        ///
        /// <para><c>restore</c> ends a blackout by handing the link back to the
        /// real backend, the same as <c>auto</c>. It used to force connected,
        /// and a request file left at <c>restore</c> then kept the reveal gate
        /// open over a craft that had really lost its path: the path measured
        /// zero, the gate did not hold the last signal delay, and telemetry and
        /// commands crossed at no delay at all. Nothing honest can be forced
        /// connected, so no mode does it.</para>
        /// </summary>
        /// <param name="mode">The request's mode, trimmed and lower-cased, or null when it states none.</param>
        /// <param name="recognised">False for a mode this does not know, which reads as <c>auto</c>.</param>
        internal static bool? ModeOf(string? mode, out bool recognised)
        {
            recognised = true;
            switch (mode)
            {
                case "blackout":
                    return false;
                case "restore":
                case "auto":
                case null:
                case "":
                    return null;
                default:
                    recognised = false;
                    return null;
            }
        }

        private static string DescribeMode(bool? mode) =>
            mode == false ? "BLACKOUT (forced disconnected)" : "AUTO (real backend)";
    }
}
