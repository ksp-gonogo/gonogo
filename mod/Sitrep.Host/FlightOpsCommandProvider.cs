using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command-handling logic for the game-level flight-ops commands
    /// (<c>ksp.*</c>): the command-side twin of the <c>ksp</c> uplink's
    /// read topics. Each <c>Handle*</c> method is the exact delegate
    /// <c>Gonogo.KSP.FlightOpsUplink.Register</c> hands to
    /// <see cref="IUplinkHost.AddCommandHandler{TArgs,TResult}"/>: parse the
    /// already-typed args, do any check that doesn't need live game state, then
    /// call the one matching <see cref="IFlightOpsActuator"/> method. No
    /// KSP/Unity type appears here: every check that needs live state (is a
    /// revert currently available, does a vessel id resolve, is there an active
    /// vessel) is the actuator's job and comes back as a typed
    /// <see cref="CommandResult.ErrorCode"/>.
    ///
    /// <para>These commands are game-level/player/scene actions, not uplinks to
    /// a craft, so they are declared <see cref="DelayRole.TrueNow"/>; see
    /// <c>FlightOpsUplink</c>'s command table.</para>
    /// </summary>
    public static class FlightOpsCommandProvider
    {
        public const string RevertToLaunchCommand = "ksp.revertToLaunch";
        public const string RevertToEditorCommand = "ksp.revertToEditor";
        public const string ToTrackingStationCommand = "ksp.toTrackingStation";
        public const string SwitchVesselCommand = "ksp.switchVessel";
        public const string RecoverCommand = "ksp.recover";
        public const string LaunchCommand = "ksp.launch";

        /// <summary>
        /// How far, in one-way light-seconds, a vantage may be from a launch site
        /// and still launch from it. A launch is instant, because a scene change is
        /// a fact about the one simulation every vantage shares, so it cannot be
        /// held for light-time; what stops a vantage launching from a pad on
        /// another world is being refused, not being delayed.
        /// </summary>
        public const double LaunchProximitySeconds = 10.0;

        public static CommandResult HandleRevertToLaunch(IFlightOpsActuator actuator, object? _) =>
            actuator.RevertToLaunch();

        /// <summary>
        /// Bridges the opaque <c>"vab"</c>/<c>"sph"</c> wire string to the
        /// KSP-free <see cref="EditorFacilityKind"/> HERE, before the actuator
        /// is ever called, an unrecognised facility is an out-of-range arg,
        /// rejected as <see cref="CommandErrorCode.Range"/> without touching the
        /// game (the same admission-gate split every arg-validated command in
        /// this contract uses).
        /// </summary>
        public static CommandResult HandleRevertToEditor(IFlightOpsActuator actuator, RevertToEditorArgs args)
        {
            var facility = ParseEditorFacility(args.Editor);
            if (facility == EditorFacilityKind.Unknown)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            return actuator.RevertToEditor(facility);
        }

        public static CommandResult HandleToTrackingStation(IFlightOpsActuator actuator, object? _) =>
            actuator.ToTrackingStation();

        /// <summary>
        /// A missing/empty vessel id can never resolve to a live vessel, so it
        /// fails fast as <see cref="CommandErrorCode.NotFound"/> here, mirroring
        /// <see cref="VesselCommandProvider.HandleTargetSet"/>'s null-id guard.
        /// A well-formed id that simply doesn't match a live vessel is the
        /// actuator's own <see cref="CommandErrorCode.NotFound"/> to return
        /// (it's the one with <c>FlightGlobals</c> in hand).
        /// </summary>
        public static CommandResult HandleSwitchVessel(IFlightOpsActuator actuator, SwitchVesselArgs args)
        {
            if (string.IsNullOrEmpty(args.VesselId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SwitchVessel(args.VesselId);
        }

        public static CommandResult HandleRecover(IFlightOpsActuator actuator, object? _) =>
            actuator.Recover();

        /// <summary>
        /// Arg-gates a launch without touching KSP: an empty ship name can
        /// never resolve to a craft file
        /// (<see cref="CommandErrorCode.NotFound"/>), and an unrecognised
        /// facility is an out-of-range arg (<see cref="CommandErrorCode.Range"/>),
        /// both rejected here, before the actuator (the one with the scene /
        /// save folder / craft file in hand) is ever called. The
        /// <c>"VAB"</c>/<c>"SPH"</c> wire string bridges to the KSP-free
        /// <see cref="EditorFacilityKind"/> via the same
        /// <see cref="ParseEditorFacility"/> helper <see cref="HandleRevertToEditor"/>
        /// uses. A null crew list is normalised to empty (launch unmanned).
        ///
        /// <para>Then held to where the order came from: <paramref name="reach"/>
        /// says how <paramref name="vantage"/> stands relative to the named site,
        /// and <see cref="ProximityRefusal"/> refuses anything further than
        /// <see cref="LaunchProximitySeconds"/>. Asked only after the arguments
        /// pass, so a malformed launch is refused for being malformed.</para>
        /// </summary>
        public static CommandResult HandleLaunch(
            IFlightOpsActuator actuator,
            LaunchArgs args,
            string vantage,
            Func<string, string, LaunchSiteReach> reach)
        {
            if (args == null || string.IsNullOrEmpty(args.ShipName))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            var facility = ParseEditorFacility(args.Facility);
            if (facility == EditorFacilityKind.Unknown)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            var refusal = ProximityRefusal(reach(vantage, args.Site));
            if (refusal != null)
            {
                return refusal;
            }
            return actuator.Launch(args.ShipName, facility, args.Site, args.Crew ?? new List<string>());
        }

        /// <summary>
        /// Why a launch from where the vantage stands is refused, or null when it
        /// may go ahead.
        ///
        /// <para>Only a vantage that is somewhere may launch. The meta vantage is a
        /// delay exemption for program acts rather than a place, and an operator in
        /// ordinary play is never dispatching from it: a connection that has chosen
        /// nothing stands at home or at a ground station, both command centres. So
        /// a vantage with no place is refused, because being unable to say where
        /// the launch was ordered from is not evidence that it was ordered from
        /// beside the pad. The one exception is a save with no comms network,
        /// where no centre exists to stand at and no light-time separates any two
        /// places, so there is no distance for the rule to hold anyone to.</para>
        /// </summary>
        private static CommandResult? ProximityRefusal(LaunchSiteReach where)
        {
            switch (where.Kind)
            {
                case LaunchSiteReach.Standing.Unconstrained:
                    return null;
                case LaunchSiteReach.Standing.NoPlace:
                    return CommandResult.Fail(
                        CommandErrorCode.NotAtSite,
                        where.VantageName + " is not a command centre, so it is not near " + where.SiteName);
                case LaunchSiteReach.Standing.NoSuchSite:
                    return CommandResult.Fail(CommandErrorCode.NotFound, "no launch site is named " + where.SiteName);
                case LaunchSiteReach.Standing.Unread:
                    return CommandResult.Fail(
                        CommandErrorCode.Unreadable,
                        "where " + where.VantageName + " stands relative to " + where.SiteName + " could not be read");
                case LaunchSiteReach.Standing.SiteUnplaced:
                    return CommandResult.Fail(
                        CommandErrorCode.Unreadable,
                        where.SiteName + " has no placed spawn point to measure to");
                default:
                    return where.Seconds > LaunchProximitySeconds
                        ? CommandResult.Fail(
                            CommandErrorCode.NotAtSite,
                            where.VantageName + " is "
                                + where.Seconds.ToString("0.#", CultureInfo.InvariantCulture)
                                + " light-seconds from " + where.SiteName)
                        : null;
            }
        }

        private static EditorFacilityKind ParseEditorFacility(string? editor)
        {
            if (string.IsNullOrEmpty(editor))
            {
                return EditorFacilityKind.Unknown;
            }
            switch (editor!.Trim().ToLowerInvariant())
            {
                case "vab":
                    return EditorFacilityKind.Vab;
                case "sph":
                    return EditorFacilityKind.Sph;
                default:
                    return EditorFacilityKind.Unknown;
            }
        }
    }
}
