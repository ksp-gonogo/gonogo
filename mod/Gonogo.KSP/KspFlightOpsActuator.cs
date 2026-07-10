using System;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IFlightOpsActuator"/> — the KSP-actuation seam for
    /// the game-level flight-ops commands (<c>ksp.*</c>), wired to
    /// <c>FlightDriver</c>/<c>HighLogic</c>/<c>FlightGlobals</c>/<c>GameEvents</c>,
    /// confirmed against this KSP version's actual API shapes via decompile
    /// (see each method's comment for the specific call). Sibling of
    /// <see cref="KspVesselActuator"/> on the actuation side, and — like it —
    /// runs entirely on the Unity main thread: <see cref="ChannelEngine"/> is
    /// constructed with <c>executeCommandsOnMainThread: true</c>, so every
    /// command handler is drained on the main thread in <c>GonogoAddon.FixedUpdate</c>
    /// (see <see cref="KspVesselActuator"/>'s doc comment for the full
    /// marshaling story). Scene loads and revert calls MUST run there.
    ///
    /// <para>Every method returns a typed <see cref="CommandResult"/> failure
    /// rather than throwing when its precondition isn't met — matching the
    /// <see cref="IVesselActuator"/> fail-soft convention.</para>
    /// </summary>
    public sealed class KspFlightOpsActuator : IFlightOpsActuator
    {
        /// <summary>
        /// Reverts the flight to its on-the-pad launch state via
        /// <c>FlightDriver.RevertToLaunch()</c> (static, no args), gated on
        /// <c>FlightDriver.CanRevertToPostInit</c> — the same flag KSP's own
        /// pause menu reads to decide whether to draw the "Revert to Launch"
        /// button (see <c>Sitrep.Contract.RevertAvailability</c>'s field
        /// mapping). Unavailable → <see cref="CommandErrorCode.ModeUnavailable"/>
        /// rather than firing a revert KSP itself would refuse.
        /// </summary>
        public CommandResult RevertToLaunch()
        {
            if (!FlightDriver.CanRevertToPostInit)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            FlightDriver.RevertToLaunch();
            return CommandResult.Ok();
        }

        /// <summary>
        /// Reverts the flight back into the editor via
        /// <c>FlightDriver.RevertToPrelaunch(EditorFacility)</c> — the call
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
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
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
        /// args) — a game-level scene change with no vessel precondition.
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
        /// <c>FlightGlobals.Vessels</c> and matching <c>vessel.id.ToString()</c>
        /// — the identical resolution
        /// <see cref="KspVesselActuator.SetTarget"/> uses, so the client never
        /// needs (or supplies) a live roster index. <c>SetActiveVessel</c>
        /// returns false when KSP refuses the switch (e.g. the vessel isn't in
        /// a switchable state); that surfaces as
        /// <see cref="CommandErrorCode.ModeUnavailable"/>.
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
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        /// <summary>
        /// Recovers the active vessel by firing
        /// <c>GameEvents.OnVesselRecoveryRequested.Fire(FlightGlobals.ActiveVessel)</c>
        /// — the exact call KSP's own recover button makes (decompile-confirmed
        /// against the stock recovery-request path). That path first checks the
        /// vessel is in a recoverable state (<c>FlightGlobals.ClearToSave()</c>
        /// returns <c>ClearToSaveStatus.CLEAR</c>) and that the current game
        /// permits leaving to the space center
        /// (<c>Parameters.Flight.CanLeaveToSpaceCenter</c>); both gates are
        /// mirrored here so recovery is never requested when KSP itself would
        /// refuse it — a failed gate returns
        /// <see cref="CommandErrorCode.ModeUnavailable"/> rather than firing a
        /// destructive recovery.
        /// </summary>
        public CommandResult Recover()
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            if (FlightGlobals.ClearToSave() != ClearToSaveStatus.CLEAR)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var game = HighLogic.CurrentGame;
            if (game?.Parameters?.Flight != null && !game.Parameters.Flight.CanLeaveToSpaceCenter)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            GameEvents.OnVesselRecoveryRequested.Fire(vessel);
            return CommandResult.Ok();
        }
    }
}
