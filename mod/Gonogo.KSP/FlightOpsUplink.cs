using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>ksp</c> uplink's COMMAND half — the game-level flight-ops
    /// actions (<c>ksp.revertToLaunch</c>/<c>ksp.revertToEditor</c>/
    /// <c>ksp.toTrackingStation</c>/<c>ksp.switchVessel</c>/<c>ksp.recover</c>).
    /// These are player/scene/game-level operations, NOT actuation uplinked to
    /// a craft, so they live on their own uplink rather than on
    /// <see cref="VesselUplink"/> (whose commands are all craft actuation) and
    /// are declared <c>delayed: false</c> — a scene load or a revert is a local
    /// game action, never a signal that rides light-time (see
    /// <c>local_docs/telemetry-mod/delay-architecture-resolution.md</c> §3 and
    /// <see cref="VesselUplink"/>'s command-classification table).
    ///
    /// <para>Read topics for the same domain (<c>ksp.revertAvailability</c>,
    /// <c>ksp.scene</c>, …) are produced elsewhere; this uplink declares NO
    /// channels — it exists purely to carry the flight-ops command handlers.
    /// Mirrors <see cref="VesselUplink"/>'s KSP-free-provider / real-actuator
    /// split exactly: all the arg-parsing lives in the headlessly-testable
    /// <see cref="FlightOpsCommandProvider"/> (<c>Sitrep.Host</c>); only
    /// <see cref="KspFlightOpsActuator"/> touches KSP directly.</para>
    /// </summary>
    [SitrepUplink("ksp")]
    public sealed class FlightOpsUplink : ISitrepUplink
    {
        private readonly IFlightOpsActuator _actuator;

        public FlightOpsUplink(IFlightOpsActuator actuator)
        {
            _actuator = actuator;
        }

        /// <summary>
        /// The discovery-required parameterless constructor (see
        /// <c>Sitrep.Host.UplinkDiscovery</c>): builds its own real
        /// <see cref="KspFlightOpsActuator"/>, exactly as
        /// <see cref="VesselUplink"/> builds its <see cref="KspVesselActuator"/>.
        /// </summary>
        public FlightOpsUplink() : this(new KspFlightOpsActuator())
        {
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "ksp",
            Version = "1.0.0",
            // No channels — this uplink is command-only (see the class doc
            // comment). Every command is delayed:false: a game-level/player/
            // scene action is not a signal to the craft, so it executes
            // immediately rather than riding the Courier's light-time delay.
            Commands = new List<CommandDeclaration>
            {
                Command(FlightOpsCommandProvider.RevertToLaunchCommand, delayed: false),
                Command(FlightOpsCommandProvider.RevertToEditorCommand, delayed: false),
                Command(FlightOpsCommandProvider.ToTrackingStationCommand, delayed: false),
                Command(FlightOpsCommandProvider.SwitchVesselCommand, delayed: false),
                Command(FlightOpsCommandProvider.RecoverCommand, delayed: false),
                Command(FlightOpsCommandProvider.LaunchCommand, delayed: false),
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddCommandHandler<object?, CommandResult>(FlightOpsCommandProvider.RevertToLaunchCommand, args => FlightOpsCommandProvider.HandleRevertToLaunch(_actuator, args));
            host.AddCommandHandler<RevertToEditorArgs, CommandResult>(FlightOpsCommandProvider.RevertToEditorCommand, args => FlightOpsCommandProvider.HandleRevertToEditor(_actuator, args));
            host.AddCommandHandler<object?, CommandResult>(FlightOpsCommandProvider.ToTrackingStationCommand, args => FlightOpsCommandProvider.HandleToTrackingStation(_actuator, args));
            host.AddCommandHandler<SwitchVesselArgs, CommandResult>(FlightOpsCommandProvider.SwitchVesselCommand, args => FlightOpsCommandProvider.HandleSwitchVessel(_actuator, args));
            host.AddCommandHandler<object?, CommandResult>(FlightOpsCommandProvider.RecoverCommand, args => FlightOpsCommandProvider.HandleRecover(_actuator, args));
            host.AddCommandHandler<LaunchArgs, CommandResult>(FlightOpsCommandProvider.LaunchCommand, args => FlightOpsCommandProvider.HandleLaunch(_actuator, args));
        }

        private static CommandDeclaration Command(string command, bool delayed) => new CommandDeclaration
        {
            Command = command,
            Delayed = delayed,
        };
    }
}
