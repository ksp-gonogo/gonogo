using System;
using System.Collections;
using System.IO;
using System.Reflection;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Automatically loads a named save and enters the
    /// Space Center from the main menu, so a headless automated test run can
    /// reach a live game scene without a human clicking "Resume Saved Game".
    ///
    /// This is <b>NOT</b> production behaviour and MUST never affect a normal
    /// player install. It is gated entirely on a config file
    /// (<c>PluginData/dev-autoload.cfg</c>, next to this assembly) that is
    /// <b>never shipped</b> in any CKAN/SpaceDock/GameData release - the test
    /// controller writes it onto the Deck at test time only. With no file (the
    /// production default) this addon does nothing at all.
    ///
    /// Hard safety rule: the save named "Unnamed" (KSP's default sandbox scratch
    /// save) is off limits and can NEVER be auto-loaded, regardless of config.
    ///
    /// Every decision point below logs with a <c>[GonogoDevAutoLoad]</c> prefix
    /// (via <c>Debug.Log</c> / <c>Debug.LogError</c>) so a failed attempt is
    /// always explained in KSP.log - there must never be a silent "nothing
    /// happened" outcome again (this addon previously instantiated at
    /// MainMenu and never loaded the save, with no log line saying why).
    ///
    /// The cfg is read via a short poll loop rather than a single
    /// <c>File.Exists</c> check: the test controller writes the file into a
    /// syncthing-mirrored GameData tree immediately before launching KSP, and
    /// on a heavily-modded boot (SCANsat, ContractConfigurator, ...) that
    /// write/sync can still be landing when this addon's <c>Start()</c> fires.
    /// A single-shot check racing that write is the leading suspect for the
    /// prior silent failure - polling for up to <see cref="CfgPollTimeoutSeconds"/>
    /// closes that window while still logging loudly if the file never shows up.
    ///
    /// <c>once: false</c> means KSP re-instantiates this every time the main
    /// menu scene loads; a process-wide <see cref="_attempted"/> guard ensures
    /// the auto-load is only ever attempted once per KSP process.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.MainMenu, once: false)]
    public sealed class GonogoDevAutoLoad : MonoBehaviour
    {
        private const string LogPrefix = "[GonogoDevAutoLoad] ";

        /// <summary>
        /// Process-wide guard: even though <c>once: false</c> re-instantiates
        /// this on every return to the main menu, the auto-load is only ever
        /// attempted once per KSP process.
        /// </summary>
        private static bool _attempted;

        private const float CfgPollIntervalSeconds = 0.5f;
        private const float CfgPollTimeoutSeconds = 20f;

        private void Start()
        {
            Debug.Log(LogPrefix + "Start() fired on MainMenu (_attempted=" + _attempted + ")");

            if (_attempted)
            {
                Debug.Log(LogPrefix + "already attempted auto-load this process; skipping");
                return;
            }

            _attempted = true;
            StartCoroutine(AutoLoadRoutine());
        }

        /// <summary>
        /// Resolves the cfg, polls for it to appear, parses it, verifies the
        /// save exists on disk, and hands off to <see cref="LoadSave"/>.
        /// Every branch that used to return silently now logs why.
        /// </summary>
        private IEnumerator AutoLoadRoutine()
        {
            // Let the main menu finish this frame before driving the load
            // machinery - running it directly from Start() throws an NRE
            // inside Game.Start() because the menu isn't fully initialised
            // yet.
            yield return null;

            string? assemblyDir;
            try
            {
                assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed to resolve executing assembly location: " + ex);
                yield break;
            }

            if (string.IsNullOrEmpty(assemblyDir))
            {
                Debug.LogError(LogPrefix + "executing assembly directory resolved empty; cannot locate cfg");
                yield break;
            }

            var configPath = Path.Combine(assemblyDir, "PluginData", "dev-autoload.cfg");
            Debug.Log(LogPrefix + "resolved cfg path: " + configPath);

            var waited = 0f;
            var loggedWaiting = false;
            while (!File.Exists(configPath))
            {
                if (waited >= CfgPollTimeoutSeconds)
                {
                    Debug.Log(LogPrefix + "cfg not found at " + configPath + " after " + CfgPollTimeoutSeconds
                        + "s of polling - giving up (this is the production-safe default: no cfg means no auto-load)");
                    yield break;
                }

                if (!loggedWaiting)
                {
                    Debug.Log(LogPrefix + "cfg not present yet at " + configPath + "; polling up to "
                        + CfgPollTimeoutSeconds + "s in case it's still being written/synced");
                    loggedWaiting = true;
                }

                yield return new WaitForSeconds(CfgPollIntervalSeconds);
                waited += CfgPollIntervalSeconds;
            }

            if (loggedWaiting)
            {
                Debug.Log(LogPrefix + "cfg appeared at " + configPath + " after " + waited + "s of polling");
            }

            string[] lines;
            try
            {
                lines = File.ReadAllLines(configPath);
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed reading cfg at " + configPath + ": " + ex);
                yield break;
            }

            Debug.Log(LogPrefix + "cfg raw contents (" + lines.Length + " line(s)): ["
                + string.Join(" | ", lines) + "]");

            // Line 1 (first non-empty) = save name. An optional later
            // non-empty line of "flight" asks us to resume into the FLIGHT
            // scene focusing the save's active vessel (via
            // FlightDriver.StartAndFocusVessel) instead of the default
            // Space Center - Game.Start() alone always lands at the Space
            // Center even for a save whose active vessel is flyable, so
            // flight-scene Topics (vessel.parts, dv.*, thermal, ...) can't be
            // validated without this. Absent -> Space Center, unchanged.
            string? saveName = null;
            var restoreFlight = false;
            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (trimmed.Length == 0)
                {
                    continue;
                }

                if (saveName == null)
                {
                    saveName = trimmed;
                }
                else if (string.Equals(trimmed, "flight", StringComparison.OrdinalIgnoreCase))
                {
                    restoreFlight = true;
                }
            }

            if (string.IsNullOrEmpty(saveName))
            {
                Debug.LogError(LogPrefix + "cfg at " + configPath + " parsed to no save name (empty or whitespace-only file?)");
                yield break;
            }

            Debug.Log(LogPrefix + "parsed saveName='" + saveName + "' restoreFlight=" + restoreFlight);

            // HARD SAFETY RULE: "Unnamed" is off limits and can never be
            // auto-loaded. This gate is unconditional and must be impossible
            // to bypass via config.
            if (string.Equals(saveName!.Trim(), "Unnamed", StringComparison.OrdinalIgnoreCase))
            {
                Debug.LogError(LogPrefix + "REFUSED: 'Unnamed' save is off limits and can never be auto-loaded, regardless of cfg");
                yield break;
            }

            var savesDir = KSPUtil.ApplicationRootPath + "saves/" + saveName;
            var sfsPath = savesDir + "/persistent.sfs";
            var saveExists = Directory.Exists(savesDir) && File.Exists(sfsPath);
            if (saveExists)
            {
                Debug.Log(LogPrefix + "save found: " + sfsPath);
            }
            else
            {
                Debug.LogError(LogPrefix + "save NOT found at " + sfsPath + " (saves dir exists=" + Directory.Exists(savesDir) + ") - aborting");
                yield break;
            }

            LoadSave(saveName!, restoreFlight);
        }

        /// <summary>
        /// Reproduces KSP's real "Resume Saved Game" sequence, verified against
        /// the decompiled <c>MainMenu.OnLoadDialogPipelineFinished</c>:
        /// <code>
        ///   HighLogic.CurrentGame = GamePersistence.LoadGameCfg(node, save, true, false);
        ///   if (HighLogic.CurrentGame == null) return;
        ///   GamePersistence.UpdateScenarioModules(HighLogic.CurrentGame);
        ///   GamePersistence.SaveGame(HighLogic.CurrentGame, "persistent", save, SaveMode.OVERWRITE);
        ///   GameEvents.onGameStatePostLoad.Fire(node);
        ///   HighLogic.SaveFolder = save;
        ///   HighLogic.CurrentGame.Start();
        /// </code>
        /// The critical fix over the first attempt: the loaded game MUST be
        /// assigned to <c>HighLogic.CurrentGame</c> before <c>Start()</c> is
        /// called - <c>Game.Start()</c> dereferences it internally, which is
        /// why an earlier direct <c>game.Start()</c> threw a NullReference.
        ///
        /// Kept as a plain (non-coroutine) method so the whole sequence is
        /// covered by a single try/catch: any exception is logged WITH its
        /// stack trace and swallowed so nothing ever throws out of the addon.
        /// </summary>
        private static void LoadSave(string saveName, bool restoreFlight)
        {
            try
            {
                Debug.Log(LogPrefix + "invoking GamePersistence.LoadSFSFile for save '" + saveName + "'"
                    + (restoreFlight ? " (restore flight)" : ""));

                var node = GamePersistence.LoadSFSFile("persistent", saveName);
                if (node == null)
                {
                    Debug.LogError(LogPrefix + "LoadSFSFile returned null for save '" + saveName + "'");
                    return;
                }

                Debug.Log(LogPrefix + "LoadSFSFile ok; calling GamePersistence.LoadGameCfg");
                HighLogic.CurrentGame = GamePersistence.LoadGameCfg(node, saveName, nullIfIncompatible: true, suppressIncompatibleMessage: false);
                if (HighLogic.CurrentGame == null)
                {
                    Debug.LogError(LogPrefix + "LoadGameCfg returned null (incompatible save '" + saveName + "')");
                    return;
                }

                if (!HighLogic.CurrentGame.compatible || HighLogic.CurrentGame.flightState == null)
                {
                    Debug.LogError(LogPrefix + "save '" + saveName + "' not compatible / no flight state (compatible="
                        + HighLogic.CurrentGame.compatible + ", flightState=" + (HighLogic.CurrentGame.flightState != null) + ")");
                    HighLogic.CurrentGame = null;
                    return;
                }

                Debug.Log(LogPrefix + "save compatible; updating scenario modules + persisting");
                GamePersistence.UpdateScenarioModules(HighLogic.CurrentGame);
                GamePersistence.SaveGame(HighLogic.CurrentGame, "persistent", saveName, SaveMode.OVERWRITE);
                GameEvents.onGameStatePostLoad.Fire(node);
                HighLogic.SaveFolder = saveName;

                var flightState = HighLogic.CurrentGame.flightState;
                var vesselCount = flightState?.protoVessels?.Count ?? 0;
                Debug.Log(LogPrefix + "flightState has " + vesselCount + " protoVessel(s); restoreFlight=" + restoreFlight);

                if (restoreFlight && vesselCount > 0)
                {
                    // KSP's real "resume into flight" entry point (what
                    // MainMenu uses for a save last left in flight). Focuses the
                    // save's active vessel and loads the FLIGHT scene, running
                    // the full stock restore sequence internally.
                    var focusIdx = flightState!.activeVesselIdx;
                    if (focusIdx < 0 || focusIdx >= vesselCount)
                    {
                        Debug.Log(LogPrefix + "activeVesselIdx " + focusIdx + " out of range for " + vesselCount + " vessel(s); defaulting to 0");
                        focusIdx = 0;
                    }

                    Debug.Log(LogPrefix + "calling FlightDriver.StartAndFocusVessel(idx=" + focusIdx + ")");
                    FlightDriver.StartAndFocusVessel(HighLogic.CurrentGame, focusIdx);
                    Debug.Log(LogPrefix + "entered FLIGHT from save '" + saveName + "' focusing vessel #" + focusIdx);
                }
                else
                {
                    Debug.Log(LogPrefix + "calling HighLogic.CurrentGame.Start()");
                    HighLogic.CurrentGame.Start();
                    Debug.Log(LogPrefix + "entered game from save '" + saveName + "'");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "load failed: " + ex);
            }
        }
    }
}
