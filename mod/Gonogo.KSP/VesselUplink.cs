using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// M1 Task 1/2/3 — the vessel telemetry uplink foundation. Registers
    /// the M1 vessel/time.warp READ channels with
    /// <see cref="VesselViewProvider"/>'s typed mappers (via its wire-adapter
    /// <c>*Wire</c> overloads — see that class's doc comment), wires the
    /// subject-provenance + epoch mechanism
    /// local_docs/telemetry-mod/m1-provider-taxonomy-design.md §6.1/§8.1 call
    /// "must-ship, unretrofittable": every <c>vessel.*</c> sample already
    /// carries <c>meta.source = "vessel:&lt;guid&gt;"</c> (VesselViewProvider's
    /// job); this uplink additionally registers <see cref="VesselEpochSampler"/>,
    /// which detects an active-vessel GUID change and forces an
    /// unconditional keyframe on every vessel channel for that same tick via
    /// <see cref="IUplinkHost.ForceKeyframe"/>. Task 3 adds the typed
    /// vessel/action COMMANDS (<see cref="VesselCommandProvider"/>'s
    /// <c>Handle*</c> glue against the <see cref="IVesselActuator"/> this
    /// uplink is constructed with — <see cref="KspVesselActuator"/> in
    /// production, <c>Sitrep.Host.Tests.FakeVesselActuator</c> in tests).
    ///
    /// Mirrors <see cref="SystemUplink"/>'s retrofit shape exactly: this
    /// class is thin KSP-adjacent wiring; all the actual mapping/epoching/
    /// command-parsing logic lives in the KSP-free <c>Sitrep.Host</c>
    /// assembly (<see cref="VesselViewProvider"/>/<see cref="VesselEpochSampler"/>/
    /// <see cref="VesselCommandProvider"/>), headlessly testable there. Only
    /// the actuator's REAL implementation (<see cref="KspVesselActuator"/>)
    /// touches KSP directly, exactly like <see cref="KspHost"/> on the read
    /// side.
    /// </summary>
    [SitrepUplink("vessel")]
    public sealed class VesselUplink : ISitrepUplink
    {
        private readonly IVesselActuator _actuator;

        public VesselUplink(IVesselActuator actuator)
        {
            _actuator = actuator;
        }

        /// <summary>
        /// The discovery-required parameterless constructor (see
        /// <c>Sitrep.Host.UplinkDiscovery</c>'s doc comment: a discoverable
        /// Uplink resolves any real dependency itself rather than taking it
        /// as a discovery-time argument). Builds its own
        /// <see cref="KspVesselActuator"/> against the mod-wide SHARED
        /// maneuver-node id registry (<see cref="GonogoAddon.SharedManeuverNodeIdRegistry"/>)
        /// — the same single instance <see cref="KspHost"/> stamps node ids
        /// from, per that registry's own doc comment on why sharing it is
        /// what makes a node id usable in a command at all.
        /// </summary>
        public VesselUplink() : this(new KspVesselActuator(GonogoAddon.SharedManeuverNodeIdRegistry))
        {
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "vessel",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(VesselViewProvider.IdentityTopic),
                // Orbital elements barely move on-rails (maneuver/SOI
                // transitions only) but can move every tick off-rails
                // (powered/atmospheric flight) -- a 30s keyframe cadence
                // follows system.bodies' precedent (SystemUplink). The
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
                // ---- M3 R3 capture-adds -- same cadence/deadband posture
                // as every other structured vessel.* channel above.
                Channel(VesselViewProvider.DockTopic),
                Channel(VesselViewProvider.SurfaceTopic),
            },
            // ==== F2 COMMAND DELAY CLASSIFICATION (the single source of
            // truth — the ONE table to edit) ====================================
            // Rule (F2 Part 2 / delay-architecture-resolution.md §3): a command
            // that is a genuine UPLINK TO THE CRAFT rides the same light-time
            // delay the telemetry model applies (delayed: true) — it takes
            // effect at t0 + uplink light-time when signal delay is enabled,
            // and instantly when it is disabled (delay == 0). A LOCAL/PLAYER or
            // GAME-LEVEL/META action is not a signal to the vessel and executes
            // immediately (delayed: false).
            //
            //   DELAYED  (uplink to the craft):
            //     - vessel.control.*   (actuation: stage/sas/rcs/gear/brakes/
            //                            lights/abort/throttle/actionGroup)
            //     - vessel.maneuver.*  (add/update/remove — the node lives on
            //                            the craft's flight computer, so placing/
            //                            editing/clearing it is an uplink)
            //   INSTANT  (local/player or game-level/meta — NOT an uplink):
            //     - vessel.target.*    (nav aid on the ground station)
            //     - time.*             (warp/pause — sim-meta, never a light-time
            //                            fiction)
            //     - any future game-level command (launch/revert/recover/scene/
            //                            facility/contracts/tech/strategies):
            //                            declare it delayed: false here.
            //
            // Additive by construction: a NEW/unknown command that never reaches
            // this table falls back to CommandDeclaration.Delayed's own default
            // (true) at dispatch time (see ChannelEngine.ProcessDispatchCommand)
            // — the safe "treat an unclassified command as an uplink" bucket.
            // Terminal/kOS uplink delay is a SEPARATE stream, not this table.
            Commands = new List<CommandDeclaration>
            {
                Command(VesselCommandProvider.SetSasCommand, delayed: true),
                Command(VesselCommandProvider.SetSasModeCommand, delayed: true),
                Command(VesselCommandProvider.SetRcsCommand, delayed: true),
                Command(VesselCommandProvider.SetGearCommand, delayed: true),
                Command(VesselCommandProvider.SetBrakesCommand, delayed: true),
                Command(VesselCommandProvider.SetLightsCommand, delayed: true),
                Command(VesselCommandProvider.SetAbortCommand, delayed: true),
                Command(VesselCommandProvider.SetThrottleCommand, delayed: true),
                Command(VesselCommandProvider.StageCommand, delayed: true),
                Command(VesselCommandProvider.SetActionGroupCommand, delayed: true),
                // vessel.maneuver.* — F2 reclassified to delayed:true: a
                // maneuver node is craft-side state, so placing/editing/removing
                // it is an uplink that rides light-time like every other
                // actuation (was delayed:false pre-F2).
                Command(VesselCommandProvider.ManeuverAddCommand, delayed: true),
                Command(VesselCommandProvider.ManeuverUpdateCommand, delayed: true),
                Command(VesselCommandProvider.ManeuverRemoveCommand, delayed: true),
                Command(VesselCommandProvider.TargetSetCommand, delayed: false),
                Command(VesselCommandProvider.TargetClearCommand, delayed: false),
                Command(VesselCommandProvider.SetWarpIndexCommand, delayed: false),
                Command(VesselCommandProvider.SetPausedCommand, delayed: false),
            },
        };

        public void Register(IUplinkHost host)
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
            host.AddChannelSource(VesselViewProvider.DockTopic, VesselViewProvider.BuildDockWire);
            host.AddChannelSource(VesselViewProvider.SurfaceTopic, VesselViewProvider.BuildSurfaceWire);

            host.AddSampler(new VesselEpochSampler(host));

            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetSasCommand, args => VesselCommandProvider.HandleSetSas(_actuator, args));
            host.AddCommandHandler<SetSasModeArgs, CommandResult>(VesselCommandProvider.SetSasModeCommand, args => VesselCommandProvider.HandleSetSasMode(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetRcsCommand, args => VesselCommandProvider.HandleSetRcs(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetGearCommand, args => VesselCommandProvider.HandleSetGear(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetBrakesCommand, args => VesselCommandProvider.HandleSetBrakes(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetLightsCommand, args => VesselCommandProvider.HandleSetLights(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetAbortCommand, args => VesselCommandProvider.HandleSetAbort(_actuator, args));
            host.AddCommandHandler<SetThrottleArgs, CommandResult>(VesselCommandProvider.SetThrottleCommand, args => VesselCommandProvider.HandleSetThrottle(_actuator, args));
            host.AddCommandHandler<object?, CommandResult<int>>(VesselCommandProvider.StageCommand, args => VesselCommandProvider.HandleStage(_actuator, args));
            host.AddCommandHandler<SetActionGroupArgs, CommandResult>(VesselCommandProvider.SetActionGroupCommand, args => VesselCommandProvider.HandleSetActionGroup(_actuator, args));
            host.AddCommandHandler<AddManeuverNodeArgs, CommandResult<string>>(VesselCommandProvider.ManeuverAddCommand, args => VesselCommandProvider.HandleManeuverAdd(_actuator, args));
            host.AddCommandHandler<UpdateManeuverNodeArgs, CommandResult>(VesselCommandProvider.ManeuverUpdateCommand, args => VesselCommandProvider.HandleManeuverUpdate(_actuator, args));
            host.AddCommandHandler<RemoveManeuverNodeArgs, CommandResult>(VesselCommandProvider.ManeuverRemoveCommand, args => VesselCommandProvider.HandleManeuverRemove(_actuator, args));
            host.AddCommandHandler<SetTargetArgs, CommandResult>(VesselCommandProvider.TargetSetCommand, args => VesselCommandProvider.HandleTargetSet(_actuator, args));
            host.AddCommandHandler<object?, CommandResult>(VesselCommandProvider.TargetClearCommand, args => VesselCommandProvider.HandleTargetClear(_actuator, args));
            host.AddCommandHandler<SetWarpIndexArgs, CommandResult>(VesselCommandProvider.SetWarpIndexCommand, args => VesselCommandProvider.HandleSetWarpIndex(_actuator, args));
            host.AddCommandHandler<SetPausedArgs, CommandResult>(VesselCommandProvider.SetPausedCommand, args => VesselCommandProvider.HandleSetPaused(_actuator, args));
        }

        private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            // Explicit retrofit, matching the DelayRole.Delayed default —
            // every vessel.* channel describes the vessel itself, so ground
            // learns about it at UT+delay like everything else vessel-sourced
            // (delay-architecture-resolution.md §3). Stated explicitly here
            // rather than relying on the default so this is provable, not
            // inferred from silence — see ChannelDeclaration.Delay's doc comment.
            Delay = DelayRole.Delayed,
        };

        private static CommandDeclaration Command(string command, bool delayed) => new CommandDeclaration
        {
            Command = command,
            Delayed = delayed,
        };
    }
}
