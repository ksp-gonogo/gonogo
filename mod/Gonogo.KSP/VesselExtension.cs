using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// M1 Task 1/2/3 — the vessel telemetry extension foundation. Registers
    /// the M1 vessel/time.warp READ channels with
    /// <see cref="VesselViewProvider"/>'s typed mappers (via its wire-adapter
    /// <c>*Wire</c> overloads — see that class's doc comment), wires the
    /// subject-provenance + epoch mechanism
    /// local_docs/telemetry-mod/m1-provider-taxonomy-design.md §6.1/§8.1 call
    /// "must-ship, unretrofittable": every <c>vessel.*</c> sample already
    /// carries <c>meta.source = "vessel:&lt;guid&gt;"</c> (VesselViewProvider's
    /// job); this extension additionally registers <see cref="VesselEpochSampler"/>,
    /// which detects an active-vessel GUID change and forces an
    /// unconditional keyframe on every vessel channel for that same tick via
    /// <see cref="IExtensionHost.ForceKeyframe"/>. Task 3 adds the typed
    /// vessel/action COMMANDS (<see cref="VesselCommandProvider"/>'s
    /// <c>Handle*</c> glue against the <see cref="IVesselActuator"/> this
    /// extension is constructed with — <see cref="KspVesselActuator"/> in
    /// production, <c>Sitrep.Host.Tests.FakeVesselActuator</c> in tests).
    ///
    /// Mirrors <see cref="SystemExtension"/>'s retrofit shape exactly: this
    /// class is thin KSP-adjacent wiring; all the actual mapping/epoching/
    /// command-parsing logic lives in the KSP-free <c>Sitrep.Host</c>
    /// assembly (<see cref="VesselViewProvider"/>/<see cref="VesselEpochSampler"/>/
    /// <see cref="VesselCommandProvider"/>), headlessly testable there. Only
    /// the actuator's REAL implementation (<see cref="KspVesselActuator"/>)
    /// touches KSP directly, exactly like <see cref="KspHost"/> on the read
    /// side.
    /// </summary>
    public sealed class VesselExtension : ISitrepExtension
    {
        private readonly IVesselActuator _actuator;

        public VesselExtension(IVesselActuator actuator)
        {
            _actuator = actuator;
        }

        public ExtensionManifest Manifest { get; } = new ExtensionManifest
        {
            Id = "vessel",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(VesselViewProvider.IdentityTopic),
                // Orbital elements barely move on-rails (maneuver/SOI
                // transitions only) but can move every tick off-rails
                // (powered/atmospheric flight) -- a 30s keyframe cadence
                // follows system.bodies' precedent (SystemExtension). The
                // payload is a Dictionary tree (see VesselViewProvider's
                // wire-adapter doc comment), so ChannelEmitter's change-gate
                // falls back to reference/Equals comparison exactly like
                // system.bodies -- deadband refinement for these structured
                // channels is a follow-up, not required for this
                // foundation.
                Channel(VesselViewProvider.OrbitTopic),
                // Dev-gated debug channel (design doc §6.5) -- same cadence
                // as orbit. There is no engine-level "hide from the picker"
                // flag yet (a future SDK/picker concern), so this is
                // dev-only BY CONVENTION: never bind it from a widget.
                Channel(VesselViewProvider.OrbitTruthTopic),
                Channel(VesselViewProvider.FlightTopic),
                // ---- M1 Task 2 channels -- same pattern, same cadence;
                // per-channel deadband/rate-clamp tuning is deferred exactly
                // like Task 1's (see the OrbitTopic comment above).
                Channel(VesselViewProvider.AttitudeTopic),
                Channel(VesselViewProvider.ResourcesTopic),
                Channel(VesselViewProvider.ThermalTopic),
                Channel(VesselViewProvider.ControlTopic),
                Channel(VesselViewProvider.CommsTopic),
                Channel(VesselViewProvider.PropulsionTopic),
                Channel(VesselViewProvider.ManeuverTopic),
                Channel(VesselViewProvider.TargetTopic),
                Channel(VesselViewProvider.CrewTopic),
                Channel(VesselViewProvider.StructureTopic),
                // time.warp -- see WarpState's doc comment for why this
                // vessel-gated channel is still declared/registered here
                // alongside the genuinely vessel-scoped ones.
                Channel(VesselViewProvider.WarpTopic),
            },
            // ---- M1 Task 3 commands -- see local_docs/telemetry-mod/
            // m1-provider-taxonomy-design.md §3 for the full ruling this
            // Delayed split follows: actuation rides light-time (true);
            // planning/designation/sim-meta do not (false) -- a ground-side
            // maneuver plan or a warp/pause toggle isn't a signal TO the
            // vessel, so delaying it would double planner-iteration latency
            // for zero realism.
            Commands = new List<CommandDeclaration>
            {
                Command(VesselCommandProvider.SetSasCommand, delayed: true),
                Command(VesselCommandProvider.SetSasModeCommand, delayed: true),
                Command(VesselCommandProvider.SetRcsCommand, delayed: true),
                Command(VesselCommandProvider.SetGearCommand, delayed: true),
                Command(VesselCommandProvider.SetBrakesCommand, delayed: true),
                Command(VesselCommandProvider.SetLightsCommand, delayed: true),
                Command(VesselCommandProvider.SetThrottleCommand, delayed: true),
                Command(VesselCommandProvider.StageCommand, delayed: true),
                Command(VesselCommandProvider.SetActionGroupCommand, delayed: true),
                Command(VesselCommandProvider.ManeuverAddCommand, delayed: false),
                Command(VesselCommandProvider.ManeuverUpdateCommand, delayed: false),
                Command(VesselCommandProvider.ManeuverRemoveCommand, delayed: false),
                Command(VesselCommandProvider.TargetSetCommand, delayed: false),
                Command(VesselCommandProvider.TargetClearCommand, delayed: false),
                Command(VesselCommandProvider.SetWarpIndexCommand, delayed: false),
                Command(VesselCommandProvider.SetPausedCommand, delayed: false),
            },
        };

        public void Register(IExtensionHost host)
        {
            host.AddChannelSource(VesselViewProvider.IdentityTopic, VesselViewProvider.BuildIdentityWire);
            host.AddChannelSource(VesselViewProvider.OrbitTopic, VesselViewProvider.BuildOrbitWire);
            host.AddChannelSource(VesselViewProvider.OrbitTruthTopic, VesselViewProvider.BuildOrbitTruthWire);
            host.AddChannelSource(VesselViewProvider.FlightTopic, VesselViewProvider.BuildFlightWire);
            host.AddChannelSource(VesselViewProvider.AttitudeTopic, VesselViewProvider.BuildAttitudeWire);
            host.AddChannelSource(VesselViewProvider.ResourcesTopic, VesselViewProvider.BuildResourcesWire);
            host.AddChannelSource(VesselViewProvider.ThermalTopic, VesselViewProvider.BuildThermalWire);
            host.AddChannelSource(VesselViewProvider.ControlTopic, VesselViewProvider.BuildControlWire);
            host.AddChannelSource(VesselViewProvider.CommsTopic, VesselViewProvider.BuildCommsWire);
            host.AddChannelSource(VesselViewProvider.PropulsionTopic, VesselViewProvider.BuildPropulsionWire);
            host.AddChannelSource(VesselViewProvider.ManeuverTopic, VesselViewProvider.BuildManeuverWire);
            host.AddChannelSource(VesselViewProvider.TargetTopic, VesselViewProvider.BuildTargetWire);
            host.AddChannelSource(VesselViewProvider.CrewTopic, VesselViewProvider.BuildCrewWire);
            host.AddChannelSource(VesselViewProvider.StructureTopic, VesselViewProvider.BuildStructureWire);
            host.AddChannelSource(VesselViewProvider.WarpTopic, VesselViewProvider.BuildWarpWire);

            host.AddSampler(new VesselEpochSampler(host));

            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetSasCommand, args => VesselCommandProvider.HandleSetSas(_actuator, args));
            host.AddCommandHandler<SetSasModeArgs, Ack>(VesselCommandProvider.SetSasModeCommand, args => VesselCommandProvider.HandleSetSasMode(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetRcsCommand, args => VesselCommandProvider.HandleSetRcs(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetGearCommand, args => VesselCommandProvider.HandleSetGear(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetBrakesCommand, args => VesselCommandProvider.HandleSetBrakes(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetLightsCommand, args => VesselCommandProvider.HandleSetLights(_actuator, args));
            host.AddCommandHandler<SetThrottleArgs, Ack>(VesselCommandProvider.SetThrottleCommand, args => VesselCommandProvider.HandleSetThrottle(_actuator, args));
            host.AddCommandHandler<object?, StageResult>(VesselCommandProvider.StageCommand, args => VesselCommandProvider.HandleStage(_actuator, args));
            host.AddCommandHandler<SetActionGroupArgs, Ack>(VesselCommandProvider.SetActionGroupCommand, args => VesselCommandProvider.HandleSetActionGroup(_actuator, args));
            host.AddCommandHandler<AddManeuverNodeArgs, AddManeuverNodeResult>(VesselCommandProvider.ManeuverAddCommand, args => VesselCommandProvider.HandleManeuverAdd(_actuator, args));
            host.AddCommandHandler<UpdateManeuverNodeArgs, Ack>(VesselCommandProvider.ManeuverUpdateCommand, args => VesselCommandProvider.HandleManeuverUpdate(_actuator, args));
            host.AddCommandHandler<RemoveManeuverNodeArgs, Ack>(VesselCommandProvider.ManeuverRemoveCommand, args => VesselCommandProvider.HandleManeuverRemove(_actuator, args));
            host.AddCommandHandler<SetTargetArgs, Ack>(VesselCommandProvider.TargetSetCommand, args => VesselCommandProvider.HandleTargetSet(_actuator, args));
            host.AddCommandHandler<object?, Ack>(VesselCommandProvider.TargetClearCommand, args => VesselCommandProvider.HandleTargetClear(_actuator, args));
            host.AddCommandHandler<SetWarpIndexArgs, Ack>(VesselCommandProvider.SetWarpIndexCommand, args => VesselCommandProvider.HandleSetWarpIndex(_actuator, args));
            host.AddCommandHandler<SetPausedArgs, Ack>(VesselCommandProvider.SetPausedCommand, args => VesselCommandProvider.HandleSetPaused(_actuator, args));
        }

        private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        private static CommandDeclaration Command(string command, bool delayed) => new CommandDeclaration
        {
            Command = command,
            Delayed = delayed,
        };
    }
}
