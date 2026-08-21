using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IFlightOpsActuator"/>: the KSP-actuation seam for
    /// the game-level flight-ops commands (<c>ksp.*</c>), wired to
    /// <c>FlightDriver</c>/<c>HighLogic</c>/<c>FlightGlobals</c>/<c>GameEvents</c>,
    /// confirmed against this KSP version's actual API shapes via decompile
    /// (see each method's comment for the specific call). Sibling of
    /// <see cref="KspVesselActuator"/> on the actuation side, and (like it)
    /// runs entirely on the Unity main thread: <see cref="ChannelEngine"/> is
    /// constructed with <c>executeCommandsOnMainThread: true</c>, so every
    /// command handler is drained on the main thread in <c>GonogoAddon.FixedUpdate</c>
    /// (see <see cref="KspVesselActuator"/>'s doc comment for the full
    /// marshaling story). Scene loads and revert calls MUST run there.
    ///
    /// <para>Every method returns a typed <see cref="CommandResult"/> failure
    /// rather than throwing when its precondition isn't met, matching the
    /// <see cref="IVesselActuator"/> fail-soft convention.</para>
    /// </summary>
    public sealed class KspFlightOpsActuator : IFlightOpsActuator
    {
        /// <summary>
        /// Reverts the flight to its on-the-pad launch state via
        /// <c>FlightDriver.RevertToLaunch()</c> (static, no args), gated on
        /// <c>FlightDriver.CanRevertToPostInit</c>: the same flag KSP's own
        /// pause menu reads to decide whether to draw the "Revert to Launch"
        /// button (see <c>Sitrep.Contract.RevertAvailability</c>'s field
        /// mapping). Unavailable → <see cref="CommandErrorCode.NotClearToProceed"/>
        /// rather than firing a revert KSP itself would refuse.
        /// </summary>
        public CommandResult RevertToLaunch()
        {
            if (!FlightDriver.CanRevertToPostInit)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "this flight cannot be reverted to launch");
            }
            FlightDriver.RevertToLaunch();
            return CommandResult.Ok();
        }

        /// <summary>
        /// Reverts the flight back into the editor via
        /// <c>FlightDriver.RevertToPrelaunch(EditorFacility)</c>: the call
        /// KSP's own pause menu makes for its "Revert to VAB/SPH" buttons
        /// (restoring the pre-launch state), NOT <c>FlightDriver.ReturnToEditor</c>
        /// (which instead saves the CURRENT flight state and returns to the
        /// editor). Gated on <c>FlightDriver.CanRevertToPrelaunch</c>, the flag
        /// the pause menu reads for those same buttons (see
        /// <c>Sitrep.Contract.RevertAvailability</c>). The KSP-free
        /// <see cref="EditorFacilityKind"/> maps straight onto
        /// <c>EditorFacility.VAB</c>/<c>SPH</c> (matching ordinals).
        /// </summary>
        public CommandResult RevertToEditor(EditorFacilityKind facility)
        {
            if (!FlightDriver.CanRevertToPrelaunch)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "this flight cannot be reverted to the editor");
            }

            EditorFacility kspFacility;
            switch (facility)
            {
                case EditorFacilityKind.Vab:
                    kspFacility = EditorFacility.VAB;
                    break;
                case EditorFacilityKind.Sph:
                    kspFacility = EditorFacility.SPH;
                    break;
                default:
                    return CommandResult.Fail(CommandErrorCode.Range);
            }

            FlightDriver.RevertToPrelaunch(kspFacility);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Loads the tracking-station scene via
        /// <c>HighLogic.LoadScene(GameScenes.TRACKSTATION)</c> (static, no
        /// args): a game-level scene change with no vessel precondition.
        /// </summary>
        public CommandResult ToTrackingStation()
        {
            HighLogic.LoadScene(GameScenes.TRACKSTATION);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Makes the vessel with the given STABLE id the active vessel via
        /// <c>FlightGlobals.SetActiveVessel(Vessel)</c>. The opaque
        /// <paramref name="vesselId"/> is resolved server-side by scanning
        /// <c>FlightGlobals.Vessels</c> and matching <c>vessel.id.ToString()</c>,
        /// the identical resolution
        /// <see cref="KspVesselActuator.SetTarget"/> uses, so the client never
        /// needs (or supplies) a live roster index.
        ///
        /// <para><c>FlightGlobals.setActiveVessel</c> switches on
        /// <c>FlightGlobals.ClearToSave()</c> arm by arm, then adds one more
        /// refusal for a vessel that is not <c>DiscoveryLevels.Owned</c>. A
        /// <c>false</c> return discards which of the eight it was, so the arm is
        /// read back here to name it.</para>
        /// </summary>
        public CommandResult SwitchVessel(string vesselId)
        {
            var fetch = FlightGlobals.fetch;
            if (fetch == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            Vessel? found = null;
            foreach (var candidate in FlightGlobals.Vessels)
            {
                if (candidate != null && string.Equals(candidate.id.ToString(), vesselId, StringComparison.OrdinalIgnoreCase))
                {
                    found = candidate;
                    break;
                }
            }
            if (found == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            return FlightGlobals.SetActiveVessel(found)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.NotClearToProceed, SwitchRefusalReason(found));
        }

        /// <summary>
        /// Which of <c>setActiveVessel</c>'s refusals it was, read back after the
        /// bare <c>false</c>.
        ///
        /// <para>Read back rather than pre-checked: a pre-check would be a second
        /// evaluation that can disagree with the one that actually decided, and
        /// this runs only on the branch that already refused. A read that throws
        /// (no flight scene) loses part of a sentence, never the refusal.</para>
        /// </summary>
        private static string SwitchRefusalReason(Vessel vessel)
        {
            try
            {
                if (vessel.DiscoveryInfo != null && vessel.DiscoveryInfo.Level != DiscoveryLevels.Owned)
                {
                    return "the vessel is not tracked as ours";
                }
                var clear = FlightGlobals.ClearToSave();
                return clear == ClearToSaveStatus.CLEAR ? "" : GameWords.Of(clear);
            }
            catch (Exception)
            {
                return "";
            }
        }

        /// <summary>
        /// Recovers the active vessel by firing
        /// <c>GameEvents.OnVesselRecoveryRequested.Fire(FlightGlobals.ActiveVessel)</c>,
        /// the exact call KSP's own recover button makes (decompile-confirmed
        /// against the stock recovery-request path). That path first checks the
        /// vessel is in a recoverable state (<c>FlightGlobals.ClearToSave()</c>
        /// returns <c>ClearToSaveStatus.CLEAR</c>) and that the current game
        /// permits leaving to the space center
        /// (<c>Parameters.Flight.CanLeaveToSpaceCenter</c>); both gates are
        /// mirrored here so recovery is never requested when KSP itself would
        /// refuse it: a failed gate returns
        /// <see cref="CommandErrorCode.NotClearToProceed"/> rather than firing a
        /// destructive recovery, carrying which of
        /// <c>ClearToSaveStatus</c>'s seven arms it was.
        /// </summary>
        public CommandResult Recover()
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var clear = FlightGlobals.ClearToSave();
            if (clear != ClearToSaveStatus.CLEAR)
            {
                return CommandResult.Fail(CommandErrorCode.NotClearToProceed, GameWords.Of(clear));
            }

            var game = HighLogic.CurrentGame;
            if (game?.Parameters?.Flight != null && !game.Parameters.Flight.CanLeaveToSpaceCenter)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "this game does not permit leaving to the space center");
            }

            GameEvents.OnVesselRecoveryRequested.Fire(vessel);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Loads a saved craft onto a launch site via
        /// <c>FlightDriver.StartWithNewLaunch(craftPath, flagUrl, site, manifest)</c>
        /// (decompile-confirmed signature), the same call KSP's own launch path
        /// makes. Runs directly on the main thread: <see cref="ChannelEngine"/>'s
        /// <c>executeCommandsOnMainThread: true</c> drains this handler in
        /// <c>GonogoAddon.FixedUpdate</c>: so no <c>Defer</c> wrapper is needed
        /// (KSP's scene loader is not re-entrant off the main thread).
        ///
        /// <para>Refuses unless the scene is the space center or an editor
        /// (<see cref="CommandErrorCode.WrongScene"/>), and refuses when an
        /// <c>ActiveVessel</c> from a prior flight still exists (launching over
        /// one wedges KSP into a frozen Flight scene:
        /// <see cref="CommandErrorCode.NotClearToProceed"/>). The craft
        /// path is rebuilt server-side from
        /// <c>&lt;AppRoot&gt;/saves/&lt;SaveFolder&gt;/Ships/&lt;facility&gt;/&lt;shipName&gt;.craft</c>;
        /// a missing save is <see cref="CommandErrorCode.NoVessel"/>, a missing
        /// craft file <see cref="CommandErrorCode.NotFound"/>.</para>
        ///
        /// <para>A <c>VesselCrewManifest</c> is ALWAYS built from the craft node
        /// (even unmanned: passing null NREs inside
        /// <c>FlightDriver.setStartupNewVessel</c>, leaving a half-initialised
        /// Flight scene that spams NREs every frame); seats are populated only
        /// when crew names are supplied.</para>
        /// </summary>
        public CommandResult Launch(string shipName, EditorFacilityKind facility, string site, IReadOnlyList<string> crew)
        {
            if (HighLogic.LoadedScene != GameScenes.SPACECENTER &&
                HighLogic.LoadedScene != GameScenes.EDITOR)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongScene, GameWords.Of(HighLogic.LoadedScene));
            }

            // A leftover ActiveVessel from an un-recovered prior flight wedges
            // KSP when a second craft is launched over it, refuse so the
            // operator recovers/reverts the existing vessel first.
            if (FlightGlobals.ActiveVessel != null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "a vessel from the last flight is still in the world");
            }

            string facilityFolder;
            switch (facility)
            {
                case EditorFacilityKind.Vab:
                    facilityFolder = "VAB";
                    break;
                case EditorFacilityKind.Sph:
                    facilityFolder = "SPH";
                    break;
                default:
                    return CommandResult.Fail(CommandErrorCode.Range);
            }

            var saveFolder = HighLogic.SaveFolder;
            if (string.IsNullOrEmpty(saveFolder))
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var craftPath = Path.Combine(KSPUtil.ApplicationRootPath, "saves");
            craftPath = Path.Combine(craftPath, saveFolder);
            craftPath = Path.Combine(craftPath, "Ships");
            craftPath = Path.Combine(craftPath, facilityFolder);
            craftPath = Path.Combine(craftPath, shipName + ".craft");
            if (!File.Exists(craftPath))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            VesselCrewManifest manifest;
            try
            {
                var craftNode = ConfigNode.Load(craftPath);
                if (craftNode == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound);
                }
                manifest = VesselCrewManifest.FromConfigNode(craftNode);
                if (crew != null && crew.Count > 0)
                {
                    AssignCrew(manifest, crew);
                }
            }
            catch (Exception)
            {
                // The ONE genuine attempt-and-see refusal in this assembly. A
                // .craft is only known to be readable by reading it: a malformed
                // file, or one that names parts from a mod this install no longer
                // has, fails inside ConfigNode.Load or VesselCrewManifest with no
                // query that could have said so first. Everything else here is a
                // precheck, so ModeUnavailable means what it says only here.
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable, "the craft file could not be read");
            }

            var flagUrl = HighLogic.CurrentGame?.flagURL ?? "Squad/Flags/default";

            FlightDriver.StartWithNewLaunch(craftPath, flagUrl, site, manifest);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Seats <paramref name="crewNames"/> into the craft's free seats, in
        /// order: probing each part manifest's seats and skipping occupied
        /// ones. Kerbals that aren't in the roster or aren't
        /// <c>RosterStatus.Available</c> are skipped rather than blocking the
        /// launch: a crew list that names someone unavailable seats the rest
        /// instead of failing the whole launch.
        /// </summary>
        private static void AssignCrew(VesselCrewManifest manifest, IReadOnlyList<string> crewNames)
        {
            if (manifest == null || crewNames == null)
            {
                return;
            }
            var roster = HighLogic.CurrentGame?.CrewRoster;
            if (roster == null)
            {
                return;
            }

            var queue = new Queue<string>(crewNames);
            foreach (var partManifest in manifest.PartManifests)
            {
                if (partManifest == null)
                {
                    continue;
                }
                if (queue.Count == 0)
                {
                    return;
                }
                var existing = partManifest.GetPartCrew();
                if (existing == null)
                {
                    continue;
                }
                for (var i = 0; i < existing.Length && queue.Count > 0; i++)
                {
                    if (existing[i] != null)
                    {
                        continue;
                    }
                    var kerbalName = queue.Dequeue();
                    if (string.IsNullOrEmpty(kerbalName))
                    {
                        continue;
                    }
                    var kerbal = roster[kerbalName];
                    if (kerbal == null)
                    {
                        continue;
                    }
                    if (kerbal.rosterStatus != ProtoCrewMember.RosterStatus.Available)
                    {
                        continue;
                    }
                    partManifest.AddCrewToSeat(kerbal, i);
                }
            }
        }
    }
}
