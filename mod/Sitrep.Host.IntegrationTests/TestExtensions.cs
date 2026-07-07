using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The integration-test project's own tiny <see cref="ISitrepExtension"/>
    /// — NOT a copy of <c>Gonogo.KSP.SystemExtension</c> (this project can't
    /// reference the net472/KSP-referencing <c>Gonogo.KSP</c> assembly at
    /// all, per this project's own csproj comment), but a few lines instead
    /// of the ~300-line hand-copied <c>ReplayBodiesServer</c> the previous
    /// design required. Registers TWO channels against the same
    /// <see cref="ChannelEngine"/> the production mod uses:
    ///
    /// <list type="bullet">
    /// <item><description><c>system.bodies</c> — the REAL retrofit, using
    /// <see cref="SystemViewProvider.BuildSystemBodies"/> verbatim, exercised
    /// by <see cref="ReplayToWebSocketEndToEndTests"/>'s payload-shape
    /// assertions.</description></item>
    /// <item><description><c>test.raw</c> — a trivial passthrough mapper
    /// (reads <c>snapshot.Values["raw"]</c>) used by the low-level
    /// engine-mechanics tests (rewind, zero-subscriber gating) that push
    /// arbitrary dictionaries through the pipeline without caring about the
    /// real system.bodies schema — proof the engine handles more than one
    /// registered channel at once.</description></item>
    /// </list>
    /// </summary>
    internal sealed class TestSystemExtension : ISitrepExtension
    {
        public const string RawTopic = "test.raw";

        public ExtensionManifest Manifest { get; } = new ExtensionManifest
        {
            Id = "test-system",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.Topic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = RawTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IExtensionHost host)
        {
            host.AddChannelSource(SystemViewProvider.Topic, SystemViewProvider.BuildSystemBodies);
            host.AddChannelSource(RawTopic, RawPassthrough);
        }

        private static object? RawPassthrough(KspSnapshot? snapshot)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue("raw", out var value))
            {
                return null;
            }
            return value;
        }

        public static KspSnapshot RawSnapshot(double ut, object? rawPayload)
        {
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["raw"] = rawPayload },
            };
        }
    }

    /// <summary>
    /// M1 Task 4a milestone test's KSP-free replica of
    /// <c>Gonogo.KSP.VesselExtension</c> — same cross-project rationale as
    /// <see cref="TestSystemExtension"/>'s own doc comment: this project
    /// cannot reference the net472 <c>Gonogo.KSP</c> assembly, so the
    /// manifest/wiring (17 channels + 17 commands, verbatim from the real
    /// extension) is duplicated here against a trivial
    /// <see cref="NoOpVesselActuator"/> rather than the real
    /// <c>KspVesselActuator</c>. This milestone suite replays a REAL
    /// recording (snapshots + lifecycle events only — no client ever
    /// dispatches a command against it), so a no-op actuator is sufficient:
    /// what's under test here is the READ pipeline (mapper -> channel ->
    /// courier -> transport -> client) for every declared channel, not
    /// command actuation (already covered by <c>VesselCommandProviderTests</c>
    /// and this project's own command-dispatch tests). <c>FakeVesselActuator</c>
    /// itself is `internal` to <c>Sitrep.Host.Tests</c> and unreachable from
    /// here for the same reason <c>Gonogo.KSP</c> is.
    /// </summary>
    internal sealed class TestVesselExtension : ISitrepExtension
    {
        private readonly IVesselActuator _actuator;

        public TestVesselExtension(IVesselActuator? actuator = null)
        {
            _actuator = actuator ?? new NoOpVesselActuator();
        }

        public ExtensionManifest Manifest { get; } = new ExtensionManifest
        {
            Id = "vessel",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(VesselViewProvider.IdentityTopic),
                Channel(VesselViewProvider.OrbitTopic),
                Channel(VesselViewProvider.OrbitTruthTopic),
                Channel(VesselViewProvider.FlightTopic),
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
                Channel(VesselViewProvider.WarpTopic),
                // ---- M3 R3 capture-adds ----
                Channel(VesselViewProvider.DockTopic),
                Channel(VesselViewProvider.SurfaceTopic),
            },
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
            host.AddChannelSource(VesselViewProvider.DockTopic, VesselViewProvider.BuildDockWire);
            host.AddChannelSource(VesselViewProvider.SurfaceTopic, VesselViewProvider.BuildSurfaceWire);

            host.AddSampler(new VesselEpochSampler(host));

            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetSasCommand, args => VesselCommandProvider.HandleSetSas(_actuator, args));
            host.AddCommandHandler<SetSasModeArgs, Ack>(VesselCommandProvider.SetSasModeCommand, args => VesselCommandProvider.HandleSetSasMode(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetRcsCommand, args => VesselCommandProvider.HandleSetRcs(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetGearCommand, args => VesselCommandProvider.HandleSetGear(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetBrakesCommand, args => VesselCommandProvider.HandleSetBrakes(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetLightsCommand, args => VesselCommandProvider.HandleSetLights(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, Ack>(VesselCommandProvider.SetAbortCommand, args => VesselCommandProvider.HandleSetAbort(_actuator, args));
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

    /// <summary>
    /// Trivial no-op <see cref="IVesselActuator"/> for <see cref="TestVesselExtension"/>
    /// — every call succeeds and does nothing observable. Sufficient for this
    /// project's replay-driven tests, none of which dispatch a vessel command
    /// against the real recording (it contains only snapshots/lifecycle
    /// events — see <see cref="TestVesselExtension"/>'s own doc comment).
    /// </summary>
    internal sealed class NoOpVesselActuator : IVesselActuator
    {
        public Ack SetSas(bool enabled) => Ack.Ok();
        public Ack SetSasMode(SasMode mode) => Ack.Ok();
        public Ack SetRcs(bool enabled) => Ack.Ok();
        public Ack SetGear(bool enabled) => Ack.Ok();
        public Ack SetBrakes(bool enabled) => Ack.Ok();
        public Ack SetLights(bool enabled) => Ack.Ok();
        public Ack SetAbort(bool enabled) => Ack.Ok();
        public Ack SetThrottle(double value) => Ack.Ok();
        public StageResult Stage() => new StageResult { Success = true, NewStage = 1 };
        public Ack SetActionGroup(int group, bool state) => Ack.Ok();
        public AddManeuverNodeResult AddManeuverNode(double ut, double prograde, double normal, double radialOut) =>
            new AddManeuverNodeResult { Success = true, NodeId = "node-1" };
        public Ack UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut) => Ack.Ok();
        public Ack RemoveManeuverNode(string nodeId) => Ack.Ok();
        public Ack SetTarget(TargetKind kind, string? vesselId, int? bodyIndex) => Ack.Ok();
        public Ack ClearTarget() => Ack.Ok();
        public Ack SetWarp(int index) => Ack.Ok();
        public Ack SetPause(bool paused) => Ack.Ok();
    }
}
