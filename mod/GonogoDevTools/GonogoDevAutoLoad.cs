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

        /// <summary>
        /// Poll cadence/timeout for confirming the target scene (FLIGHT or
        /// SPACE CENTER) has actually finished loading after <see cref="LoadSave"/>
        /// triggers it. <c>HighLogic.LoadScene</c>/<c>FlightDriver.StartAndFocusVessel</c>
        /// only queue the transition - Unity's scene load, and for FLIGHT
        /// specifically FlightDriver's own internal vessel-restore coroutine,
        /// both run asynchronously over the following frames. See the doc
        /// comment on <see cref="WaitUntilFlightReady"/> for why this addon
        /// used to declare success before that transition had actually
        /// finished.
        /// </summary>
        private const float FlightReadyPollIntervalSeconds = 0.25f;
        private const float FlightReadyTimeoutSeconds = 60f;

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

            if (!LoadSave(saveName!, restoreFlight, out var enteredFlight))
            {
                yield break;
            }

            // LoadSave only QUEUED the scene transition (HighLogic.LoadScene,
            // reached either directly via FlightDriver.StartAndFocusVessel or
            // indirectly via Game.Start()) - it does not block until the new
            // scene is actually up. The old code returned here and let this
            // MonoBehaviour (and its coroutine) get destroyed with the
            // MainMenu scene the instant Unity tore it down, which raced that
            // transition: on a heavily-modded boot the FLIGHT scene can take
            // many seconds to finish restoring the vessel, and this addon's
            // "auto-load done" log line - the signal the test harness waits
            // on before driving the game further - fired long before that,
            // producing exactly the broken scene this addon exists to avoid
            // (empty space, no vessel, HUD/SAS icons stacked in the corner).
            // Survive the scene swap and wait for the real readiness signal.
            DontDestroyOnLoad(gameObject);
            yield return WaitUntilSceneReady(enteredFlight);

            // Job done either way (confirmed ready, or gave up after logging
            // why) - nothing further for this addon to do. Clean up the
            // DontDestroyOnLoad object rather than leaving an inert
            // MonoBehaviour attached for the rest of the KSP process.
            Destroy(gameObject);
        }

        /// <summary>
        /// Waits for the scene <see cref="LoadSave"/> just triggered to
        /// actually finish loading, dispatching to the FLIGHT- or SPACE
        /// CENTER-specific wait depending on which path <see cref="LoadSave"/>
        /// actually took (its <c>enteredFlight</c> out-param, not the
        /// requested <c>restoreFlight</c> cfg flag - a save with zero
        /// protoVessels falls back to Space Center even when flight was
        /// requested, and waiting on the wrong scene here would just time out).
        /// </summary>
        private IEnumerator WaitUntilSceneReady(bool enteredFlight)
        {
            if (enteredFlight)
            {
                yield return WaitUntilFlightReady();
            }
            else
            {
                yield return WaitUntilSpaceCenterReady();
            }
        }

        /// <summary>
        /// Confirms the FLIGHT scene triggered by <c>FlightDriver.StartAndFocusVessel</c>
        /// has actually finished restoring a vessel, rather than assuming it
        /// the instant the call returned.
        ///
        /// <c>GameEvents.onFlightReady</c> is stock KSP's own "the flight
        /// scene is done" signal - decompiled, it fires from FlightDriver's
        /// internal setup coroutine only after the vessel/UI restore has
        /// completed, so it is the cleanest true-completion hook available.
        /// It is combined with a poll of the same three flags stock's own
        /// <c>FlightGlobals</c> uses internally to track its own readiness
        /// (<c>HighLogic.LoadedSceneIsFlight</c>, <c>FlightGlobals.ready</c>,
        /// <c>FlightGlobals.ActiveVessel</c>) as a belt-and-braces fallback in
        /// case some load path never fires the event, and a hard timeout so a
        /// genuinely broken load is loud in KSP.log instead of hanging this
        /// coroutine forever.
        /// </summary>
        private IEnumerator WaitUntilFlightReady()
        {
            var flightReady = false;
            void OnFlightReady()
            {
                flightReady = true;
            }

            GameEvents.onFlightReady.Add(OnFlightReady);
            var waited = 0f;
            try
            {
                while (!flightReady)
                {
                    if (HighLogic.LoadedSceneIsFlight && FlightGlobals.ready && FlightGlobals.ActiveVessel != null)
                    {
                        flightReady = true;
                        break;
                    }

                    if (waited >= FlightReadyTimeoutSeconds)
                    {
                        Debug.LogError(LogPrefix + "FLIGHT scene did not report ready within " + FlightReadyTimeoutSeconds
                            + "s of triggering the load (no onFlightReady; LoadedSceneIsFlight=" + HighLogic.LoadedSceneIsFlight
                            + ", FlightGlobals.ready=" + FlightGlobals.ready + ") - scene is likely broken (no vessel, "
                            + "empty space); giving up");
                        yield break;
                    }

                    yield return new WaitForSeconds(FlightReadyPollIntervalSeconds);
                    waited += FlightReadyPollIntervalSeconds;
                }
            }
            finally
            {
                GameEvents.onFlightReady.Remove(OnFlightReady);
            }

            Debug.Log(LogPrefix + "FLIGHT scene confirmed ready after " + waited + "s (vessel='"
                + FlightGlobals.ActiveVessel!.vesselName + "')");
        }

        /// <summary>
        /// Confirms the SPACE CENTER scene triggered (indirectly, via
        /// <c>Game.Start()</c>) by the non-restoreFlight path has actually
        /// finished loading. Lighter-weight than <see cref="WaitUntilFlightReady"/>
        /// since Space Center doesn't restore a vessel, but still avoids
        /// declaring success before <c>HighLogic.LoadScene</c>'s async
        /// transition has landed.
        /// </summary>
        private IEnumerator WaitUntilSpaceCenterReady()
        {
            var waited = 0f;
            while (HighLogic.LoadedScene != GameScenes.SPACECENTER)
            {
                if (waited >= FlightReadyTimeoutSeconds)
                {
                    Debug.LogError(LogPrefix + "SPACE CENTER scene did not become ready within " + FlightReadyTimeoutSeconds
                        + "s of calling HighLogic.CurrentGame.Start() (LoadedScene=" + HighLogic.LoadedScene + ") - giving up");
                    yield break;
                }

                yield return new WaitForSeconds(FlightReadyPollIntervalSeconds);
                waited += FlightReadyPollIntervalSeconds;
            }

            Debug.Log(LogPrefix + "SPACE CENTER scene confirmed ready after " + waited + "s");
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
        ///
        /// Only QUEUES the scene transition (via <c>FlightDriver.StartAndFocusVessel</c>
        /// or <c>Game.Start()</c>, both of which just call <c>HighLogic.LoadScene</c>
        /// under the hood, decompiled) - it does not wait for the new scene
        /// to actually finish loading. The caller is responsible for that;
        /// see <see cref="WaitUntilSceneReady"/>.
        ///
        /// Returns <c>false</c> if the load was aborted before any scene
        /// transition was triggered (bad/incompatible save, exception) - the
        /// caller should not wait for scene readiness in that case, there is
        /// nothing to wait for. On <c>true</c>, <paramref name="enteredFlight"/>
        /// reports which scene was ACTUALLY queued, which is not always what
        /// was requested: a save with zero protoVessels falls back to Space
        /// Center even when <paramref name="restoreFlight"/> was true.
        /// </summary>
        private static bool LoadSave(string saveName, bool restoreFlight, out bool enteredFlight)
        {
            enteredFlight = false;
            try
            {
                Debug.Log(LogPrefix + "invoking GamePersistence.LoadSFSFile for save '" + saveName + "'"
                    + (restoreFlight ? " (restore flight)" : ""));

                var node = GamePersistence.LoadSFSFile("persistent", saveName);
                if (node == null)
                {
                    Debug.LogError(LogPrefix + "LoadSFSFile returned null for save '" + saveName + "'");
                    return false;
                }

                Debug.Log(LogPrefix + "LoadSFSFile ok; calling GamePersistence.LoadGameCfg");
                HighLogic.CurrentGame = GamePersistence.LoadGameCfg(node, saveName, nullIfIncompatible: true, suppressIncompatibleMessage: false);
                if (HighLogic.CurrentGame == null)
                {
                    Debug.LogError(LogPrefix + "LoadGameCfg returned null (incompatible save '" + saveName + "')");
                    return false;
                }

                if (!HighLogic.CurrentGame.compatible || HighLogic.CurrentGame.flightState == null)
                {
                    Debug.LogError(LogPrefix + "save '" + saveName + "' not compatible / no flight state (compatible="
                        + HighLogic.CurrentGame.compatible + ", flightState=" + (HighLogic.CurrentGame.flightState != null) + ")");
                    HighLogic.CurrentGame = null;
                    return false;
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
                    Debug.Log(LogPrefix + "queued FLIGHT load from save '" + saveName + "' focusing vessel #" + focusIdx
                        + " - waiting for the scene to actually finish loading");
                    enteredFlight = true;
                }
                else
                {
                    Debug.Log(LogPrefix + "calling HighLogic.CurrentGame.Start()");
                    HighLogic.CurrentGame.Start();
                    Debug.Log(LogPrefix + "queued scene load from save '" + saveName
                        + "' - waiting for the scene to actually finish loading");
                }

                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "load failed: " + ex);
                return false;
            }
        }
    }
}
