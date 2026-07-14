using System;
using System.IO;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// DEV-ONLY signal-blackout override for <see cref="CommsCoreUplink"/>'s
    /// connectivity capture / reveal-gate source. Lets the GonogoDevTools
    /// mini-mod (Deck-only, never shipped - see its own project comments)
    /// force the active vessel's comms connectivity to CONNECTED or
    /// DISCONNECTED regardless of what the elected <see cref="ICommsBackend"/>
    /// (stock CommNet or RealAntennas) actually reports, so a headless test
    /// run can reproduce signal-loss bugs (e.g. an uplink command like
    /// <c>kos.keystroke</c> that should be gated/dropped during a blackout)
    /// on demand instead of waiting for a real occlusion/range window.
    ///
    /// <para><b>Cross-assembly contract, no reference either direction:</b>
    /// GonogoDevTools deliberately has ZERO reference to Sitrep.*/Gonogo.KSP
    /// (see its own csproj comment), so it cannot call into this type
    /// directly - and this production assembly must never reference the
    /// Deck-only dev tooling either. The two sides communicate only through
    /// a well-known cfg file, the SAME cfg-request-poller pattern
    /// <c>GonogoDevTeleport</c>/<c>GonogoDevAutoLoad</c> already use:
    /// GonogoDevTools' own <c>GonogoDevForceComms</c> addon writes an
    /// acknowledgement/result file for SSH-side visibility, but the actual
    /// override applied here comes from polling the SAME request file
    /// independently - there is no hand-off, just two readers of one file.</para>
    ///
    /// <para><b>Production-safe by construction:</b> a normal player install
    /// never has a <c>GonogoDevTools</c> assembly loaded in the process, so
    /// <see cref="Current"/> resolves <see cref="DevToolsLoaded"/> to
    /// <c>false</c> on the FIRST check (cached forever after) and never even
    /// touches the filesystem. Only when GonogoDevTools IS loaded (Deck test
    /// runs only) does this poll the request file, at a modest 1s cadence.</para>
    /// </summary>
    internal static class DevCommsOverride
    {
        private const string LogPrefix = "[Gonogo] DevCommsOverride: ";

        // Matches GonogoDevTeleport's own poll cadence - comms-blackout
        // testing has no tighter latency requirement than teleport does.
        private const float PollIntervalSeconds = 1f;

        // GonogoDevTools' own GonogoDevForceComms addon resolves this same
        // file relative to ITS executing-assembly location. This side has no
        // assembly under GonogoDevTools to resolve from, so the path is the
        // well-known GameData-relative layout every other GonogoDevTools cfg
        // already deploys to (GameData/GonogoDevTools/Plugins/PluginData/*.cfg).
        private static readonly string RequestPath = Path.Combine(
            KSPUtil.ApplicationRootPath, "GameData", "GonogoDevTools", "Plugins", "PluginData", "force-comms-request.cfg");

        private static bool? _devToolsLoaded;
        private static float _lastPollRealtime = float.MinValue;
        private static bool? _cachedMode;
        private static bool _everLogged;

        /// <summary>
        /// <c>null</c> = no override, use the real elected backend's
        /// connectivity. <c>false</c> = forced DISCONNECTED (blackout).
        /// <c>true</c> = forced CONNECTED (restore).
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
                Debug.LogWarning(LogPrefix + "failed enumerating loaded assemblies (treating as not-dev-tools): " + ex.Message);
                found = false;
            }

            _devToolsLoaded = found;
            if (found)
            {
                Debug.Log(LogPrefix + "GonogoDevTools assembly detected; force-comms override armed, polling " + RequestPath);
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
                    switch (mode)
                    {
                        case "blackout":
                            resolved = false;
                            break;
                        case "restore":
                            resolved = true;
                            break;
                        case "auto":
                        case null:
                        case "":
                            resolved = null;
                            break;
                        default:
                            Debug.LogWarning(LogPrefix + "unrecognized mode '" + mode + "' in " + RequestPath + "; treating as 'auto'");
                            resolved = null;
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning(LogPrefix + "failed reading " + RequestPath + " (treating as 'auto'): " + ex.Message);
                resolved = null;
            }

            if (!_everLogged || resolved != _cachedMode)
            {
                Debug.Log(LogPrefix + "mode -> " + DescribeMode(resolved));
                _everLogged = true;
            }
            _cachedMode = resolved;
        }

        private static string DescribeMode(bool? mode)
        {
            if (mode == false)
            {
                return "BLACKOUT (forced disconnected)";
            }
            if (mode == true)
            {
                return "RESTORE (forced connected)";
            }
            return "AUTO (real backend)";
        }
    }
}
