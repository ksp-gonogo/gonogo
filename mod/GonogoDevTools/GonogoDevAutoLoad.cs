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
    /// <c>once: false</c> means KSP re-instantiates this every time the main
    /// menu scene loads; a process-wide <see cref="_loaded"/> guard ensures the
    /// save is only ever auto-loaded once per KSP process.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.MainMenu, once: false)]
    public sealed class GonogoDevAutoLoad : MonoBehaviour
    {
        /// <summary>
        /// Process-wide guard: even though <c>once: false</c> re-instantiates
        /// this on every return to the main menu, the auto-load fires exactly
        /// once per KSP process.
        /// </summary>
        private static bool _loaded;

        private void Start()
        {
            if (_loaded)
            {
                return;
            }

            string? saveName = null;
            var restoreFlight = false;
            try
            {
                var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (string.IsNullOrEmpty(assemblyDir))
                {
                    return;
                }

                var configPath = Path.Combine(assemblyDir, "PluginData", "dev-autoload.cfg");

                // No config file is the PRODUCTION-SAFE default: the file is
                // never shipped, so a normal install does nothing here.
                if (!File.Exists(configPath))
                {
                    return;
                }

                // Line 1 (first non-empty) = save name. An optional later
                // non-empty line of "flight" asks us to resume into the FLIGHT
                // scene focusing the save's active vessel (via
                // FlightDriver.StartAndFocusVessel) instead of the default
                // Space Center — Game.Start() alone always lands at the Space
                // Center even for a save whose active vessel is flyable, so
                // flight-scene Topics (vessel.parts, dv.*, thermal, …) can't be
                // validated without this. Absent → Space Center, unchanged.
                foreach (var line in File.ReadAllLines(configPath))
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
                    return;
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-autoload failed reading config: " + ex.Message);
                return;
            }

            // HARD SAFETY RULE: "Unnamed" is off limits and can never be
            // auto-loaded. This gate is unconditional and must be impossible
            // to bypass via config.
            if (string.Equals(saveName!.Trim(), "Unnamed", StringComparison.OrdinalIgnoreCase))
            {
                Debug.LogError("[Gonogo] dev-autoload REFUSED: 'Unnamed' is off limits");
                return;
            }

            _loaded = true;

            // Defer the actual load off MainMenu.Start(): running it directly
            // from a scene Start() throws an NRE inside Game.Start() because the
            // menu isn't fully initialised yet. A coroutine yielding one frame
            // lets the menu finish before we drive the load machinery.
            StartCoroutine(LoadSaveNextFrame(saveName!, restoreFlight));
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
        /// why the previous direct <c>game.Start()</c> threw a NullReference.
        /// </summary>
        private IEnumerator LoadSaveNextFrame(string saveName, bool restoreFlight)
        {
            // Let the main menu finish this frame before driving the load.
            yield return null;
            LoadSave(saveName, restoreFlight);
        }

        /// <summary>
        /// The synchronous resume work. Kept separate from the coroutine so it
        /// can be wrapped in a try/catch (a catch clause can't span a
        /// <c>yield</c>): any exception is logged and swallowed so nothing ever
        /// throws out of the addon.
        /// </summary>
        private static void LoadSave(string saveName, bool restoreFlight)
        {
            try
            {
                Debug.Log("[Gonogo] dev-autoload: loading save '" + saveName + "'"
                    + (restoreFlight ? " (restore flight)" : ""));

                var node = GamePersistence.LoadSFSFile("persistent", saveName);
                if (node == null)
                {
                    Debug.LogError("[Gonogo] dev-autoload: no persistent.sfs for save '" + saveName + "'");
                    return;
                }

                HighLogic.CurrentGame = GamePersistence.LoadGameCfg(node, saveName, nullIfIncompatible: true, suppressIncompatibleMessage: false);
                if (HighLogic.CurrentGame == null)
                {
                    Debug.LogError("[Gonogo] dev-autoload: LoadGameCfg returned null (incompatible save '" + saveName + "')");
                    return;
                }

                if (!HighLogic.CurrentGame.compatible || HighLogic.CurrentGame.flightState == null)
                {
                    Debug.LogError("[Gonogo] dev-autoload: save '" + saveName + "' not compatible / no flight state");
                    HighLogic.CurrentGame = null;
                    return;
                }

                GamePersistence.UpdateScenarioModules(HighLogic.CurrentGame);
                GamePersistence.SaveGame(HighLogic.CurrentGame, "persistent", saveName, SaveMode.OVERWRITE);
                GameEvents.onGameStatePostLoad.Fire(node);
                HighLogic.SaveFolder = saveName;

                var flightState = HighLogic.CurrentGame.flightState;
                var vesselCount = flightState?.protoVessels?.Count ?? 0;
                if (restoreFlight && vesselCount > 0)
                {
                    // KSP's real "resume into flight" entry point (what
                    // MainMenu uses for a save last left in flight). Focuses the
                    // save's active vessel and loads the FLIGHT scene, running
                    // the full stock restore sequence internally.
                    var focusIdx = flightState!.activeVesselIdx;
                    if (focusIdx < 0 || focusIdx >= vesselCount)
                    {
                        focusIdx = 0;
                    }

                    FlightDriver.StartAndFocusVessel(HighLogic.CurrentGame, focusIdx);
                    Debug.Log("[Gonogo] dev-autoload: entered FLIGHT from save '" + saveName
                        + "' focusing vessel #" + focusIdx);
                }
                else
                {
                    HighLogic.CurrentGame.Start();
                    Debug.Log("[Gonogo] dev-autoload: entered game from save '" + saveName + "'");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] dev-autoload: load failed: " + ex.Message);
            }
        }
    }
}
