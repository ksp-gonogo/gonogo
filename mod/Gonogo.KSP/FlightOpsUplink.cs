using System;
using System.Collections.Generic;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>ksp</c> uplink's command half: the game-level flight-ops
    /// actions (<c>ksp.revertToLaunch</c>/<c>ksp.revertToEditor</c>/
    /// <c>ksp.toTrackingStation</c>/<c>ksp.switchVessel</c>/<c>ksp.recover</c>).
    /// These are player/scene/game-level operations, not actuation uplinked to
    /// a craft, so they live on their own uplink rather than on
    /// <see cref="VesselUplink"/> (whose commands are all craft actuation) and
    /// are declared instant on their args types, a scene load or a revert is a
    /// local game action, never a signal that rides signal delay (see
    /// <see cref="VesselUplink"/>'s command-classification table).
    ///
    /// <para>Read topics for the same domain (<c>ksp.revertAvailability</c>,
    /// <c>ksp.scene</c>, ...) are produced elsewhere; this uplink's own channels
    /// are the save slots and the result of a quickload, which only it knows.
    /// Mirrors <see cref="VesselUplink"/>'s KSP-free-provider / real-actuator
    /// split exactly: all the arg-parsing lives in the headlessly-testable
    /// <see cref="FlightOpsCommandProvider"/> (<c>Sitrep.Host</c>); only
    /// <see cref="KspFlightOpsActuator"/> touches KSP directly.</para>
    /// </summary>
    [SitrepUplink("ksp")]
    public sealed class FlightOpsUplink : ISitrepUplink, IUplinkCapabilityDeclarer
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
            Bundled = true,
            Version = "1.0.0",
            // Every one of these is instant, and each says so on its own args
            // type in the contract, which is where the client reads it from too
            // (SitrepCommandAttribute.Delay).
            Commands = new List<CommandDeclaration>
            {
                // The reverts, recover and launch carry declared gates (see
                // GateDeclarations): the flight scene for both reverts,
                // ClearToSaveStatus for recover, the scene rule and the two
                // ship-free PreFlightTests for launch. All are answerable with
                // no arguments, so the control can be dark with a reason.
                Command(FlightOpsCommandProvider.RevertToLaunchCommand),
                Command(FlightOpsCommandProvider.RevertToEditorCommand),
                Command(FlightOpsCommandProvider.ToTrackingStationCommand),
                Command(FlightOpsCommandProvider.ToSpaceCenterCommand),
                Command(FlightOpsCommandProvider.SwitchVesselCommand),
                Command(FlightOpsCommandProvider.RecoverCommand),
                Command(FlightOpsCommandProvider.RecoverVesselCommand),
                Command(FlightOpsCommandProvider.LaunchCommand),
                Command(FlightOpsCommandProvider.QuicksaveCommand),
                Command(FlightOpsCommandProvider.QuickloadCommand),
            },
            Channels = new List<ChannelDeclaration>
            {
                TrueNowChannel(SavesTopic, SampleKind.Discrete),
                TrueNowChannel(GameLoadedTopic, SampleKind.Event),
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void DeclareCapabilities(Kernel kernel) =>
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = SaveGuardCapability.Id,
                Exclusive = false,
                SpineCritical = false,
            });

        public void Register(IUplinkHost host)
        {
            CommandResult Guarded(Func<CommandResult> run) => FlightOpsCommandProvider.UnlessLoadScheduled(_actuator, run);

            host.AddCommandHandler<object?, CommandResult>(FlightOpsCommandProvider.RevertToLaunchCommand, args => Guarded(() => FlightOpsCommandProvider.HandleRevertToLaunch(_actuator, args)));
            host.AddCommandHandler<RevertToEditorArgs, CommandResult>(FlightOpsCommandProvider.RevertToEditorCommand, args => Guarded(() => FlightOpsCommandProvider.HandleRevertToEditor(_actuator, args)));
            host.AddCommandHandler<object?, CommandResult>(FlightOpsCommandProvider.ToTrackingStationCommand, args => Guarded(() => FlightOpsCommandProvider.HandleToTrackingStation(_actuator, args)));
            host.AddCommandHandler<object?, CommandResult>(FlightOpsCommandProvider.ToSpaceCenterCommand, args => Guarded(() => FlightOpsCommandProvider.HandleToSpaceCenter(_actuator, args)));
            host.AddCommandHandler<SwitchVesselArgs, CommandResult>(FlightOpsCommandProvider.SwitchVesselCommand, args => Guarded(() => FlightOpsCommandProvider.HandleSwitchVessel(_actuator, args)));
            host.AddCommandHandler<object?, CommandResult>(FlightOpsCommandProvider.RecoverCommand, args => Guarded(() => FlightOpsCommandProvider.HandleRecover(_actuator, args)));
            host.AddCommandHandler<RecoverVesselArgs, CommandResult>(FlightOpsCommandProvider.RecoverVesselCommand, args => Guarded(() => FlightOpsCommandProvider.HandleRecoverVessel(_actuator, args)));
            host.AddCommandHandler<LaunchArgs, CommandResult>(FlightOpsCommandProvider.LaunchCommand, args => Guarded(() => FlightOpsCommandProvider.HandleLaunch(_actuator, args)));
            host.AddCommandHandler<object?, CommandResult<SaveWritten>>(FlightOpsCommandProvider.QuicksaveCommand, args => FlightOpsCommandProvider.HandleQuicksave(_actuator, args));
            host.AddCommandHandler<QuickloadArgs, CommandResult<LoadScheduled>>(FlightOpsCommandProvider.QuickloadCommand, args => FlightOpsCommandProvider.HandleQuickload(_actuator, args));

            Gates.QuickSaveRules.QuicksaveAllowedNow = KspQuicksaves.QuicksaveAllowedNow;
            Gates.QuickSaveRules.QuickloadRefusal = KspQuicksaves.QuickloadRefusal;
            KspQuicksaves.Kernel = host.Kernel;
            KspQuicksaves.Publisher = host.Publisher(GameLoadedTopic);
            (host as Sitrep.Host.Comms.ICraftStateHost)?.OnTimelineReset(KspQuicksaves.OnTimelineReset);
            var savesPublisher = host.Publisher(SavesTopic);
            host.AddSampledSource(_ => { KspQuicksaves.PublishSlotsIfChanged(savesPublisher); return null; }, _ => { });
        }

        private const string SavesTopic = "ksp.saves";
        private const string GameLoadedTopic = "ksp.gameLoaded";

        private static ChannelDeclaration TrueNowChannel(string topic, SampleKind kind) => new ChannelDeclaration
        {
            Kind = kind,
            Topic = topic,
            Requires = Requirement.None,
            Delay = DelayRole.TrueNow,
            Delivery = Delivery.ReliableOrdered,
            Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
        };

        private static CommandDeclaration Command(string command) => new CommandDeclaration
        {
            Requires = GateDeclarations.For(command),
            Command = command,
        };
    }
}
