using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>career.status</c> capture surface — added THIS session so a
    /// live recording carries KSC/career state (funds/reputation/science,
    /// facility levels+costs, contracts, strategies, unlocked tech count)
    /// alongside <c>system.*</c>/<c>vessel.*</c>. Mirrors
    /// <see cref="SystemUplink"/>'s retrofit shape exactly: this class is
    /// thin KSP-adjacent wiring; the actual mapping lives in the KSP-free
    /// <c>Sitrep.Host</c> assembly (<see cref="CareerViewProvider"/>),
    /// headlessly testable there. No <see cref="ISnapshotSampler"/> is
    /// registered because <c>KspHost.Sample</c> already populates the raw
    /// <c>"career"</c> snapshot key unconditionally (guarded to career mode
    /// only — see <c>KspHost.BuildCareer</c>'s doc comment).
    ///
    /// <para>Alongside the read capture this uplink also carries the
    /// career-write COMMANDS (accept/decline/cancel contract, upgrade facility,
    /// unlock tech, activate/deactivate strategy) — <see cref="CareerCommandProvider"/>'s
    /// KSP-free <c>Handle*</c> glue against the <see cref="ICareerActuator"/>
    /// this uplink is constructed with (<see cref="KspCareerActuator"/> in
    /// production, <c>Sitrep.Host.Tests.FakeCareerActuator</c> in tests). All
    /// seven are ground-side KSC bookkeeping, not an uplink to a craft, so each
    /// is declared <c>delayed: false</c> (see the command list below).</para>
    /// </summary>
    [SitrepUplink("career")]
    public sealed class CareerUplink : ISitrepUplink
    {
        private readonly ICareerActuator _actuator;

        public CareerUplink(ICareerActuator actuator)
        {
            _actuator = actuator;
        }

        /// <summary>
        /// The discovery-required parameterless constructor (see
        /// <c>Sitrep.Host.UplinkDiscovery</c>: a discoverable Uplink resolves any
        /// real dependency itself). Builds its own <see cref="KspCareerActuator"/>,
        /// which needs no external state — every entity it touches is resolved
        /// live off the KSC singletons at command time.
        /// </summary>
        public CareerUplink() : this(new KspCareerActuator())
        {
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "career",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = CareerViewProvider.Topic,
                    Delivery = Delivery.LossyLatest,
                    // Career state changes on player action (accept a
                    // contract, spend funds, activate a strategy), not per
                    // frame - same 30s keyframe + "re-emit every sample tick
                    // reads as changed" cadence system.bodies uses (the
                    // payload is a fresh Dictionary tree every call, so
                    // ChannelEmitter's change-gate falls back to
                    // reference/Equals comparison).
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit, judgment call documented in
                    // contract-dynamic-delay-report.md: career state (funds,
                    // contracts, strategies) is KSC/ground-side bookkeeping,
                    // not something learned over a vessel's comms link, so
                    // TrueNow — same class as system.bodies/scansat.available.
                    Delay = DelayRole.TrueNow,
                },
                new ChannelDeclaration
                {
                    Topic = CareerViewProvider.ModeTopic,
                    Delivery = Delivery.LossyLatest,
                    // The save's game mode changes only on load (a new save /
                    // switching saves), so the same low-churn 30s keyframe +
                    // change-gate cadence career.status uses fits - the wire
                    // dict is a fresh object each call, so the change-gate
                    // falls back to reference/Equals comparison.
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Ground-side game-global fact (which mode the save is in),
                    // not something learned over a vessel's comms link, so
                    // TrueNow - same class as career.status/system.bodies.
                    Delay = DelayRole.TrueNow,
                },
            },
            // Every career-write command is ground-side KSC bookkeeping, not a
            // signal to a craft, so all seven are delayed: false — they take
            // effect immediately rather than at UT + uplink light-time. Only
            // commands sent to a vessel ride light-time.
            Commands = new List<CommandDeclaration>
            {
                Command(CareerCommandProvider.ActivateStrategyCommand, delayed: false),
                Command(CareerCommandProvider.DeactivateStrategyCommand, delayed: false),
                Command(CareerCommandProvider.UnlockTechCommand, delayed: false),
                Command(CareerCommandProvider.AcceptContractCommand, delayed: false),
                Command(CareerCommandProvider.DeclineContractCommand, delayed: false),
                Command(CareerCommandProvider.CancelContractCommand, delayed: false),
                Command(CareerCommandProvider.UpgradeFacilityCommand, delayed: false),
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(CareerViewProvider.Topic, CareerViewProvider.BuildCareer);
            host.AddChannelSource(CareerViewProvider.ModeTopic, CareerViewProvider.BuildCareerMode);

            host.AddCommandHandler<ActivateStrategyArgs, CommandResult>(CareerCommandProvider.ActivateStrategyCommand, args => CareerCommandProvider.HandleActivateStrategy(_actuator, args));
            host.AddCommandHandler<DeactivateStrategyArgs, CommandResult>(CareerCommandProvider.DeactivateStrategyCommand, args => CareerCommandProvider.HandleDeactivateStrategy(_actuator, args));
            host.AddCommandHandler<UnlockTechArgs, CommandResult>(CareerCommandProvider.UnlockTechCommand, args => CareerCommandProvider.HandleUnlockTech(_actuator, args));
            host.AddCommandHandler<ContractActionArgs, CommandResult>(CareerCommandProvider.AcceptContractCommand, args => CareerCommandProvider.HandleAcceptContract(_actuator, args));
            host.AddCommandHandler<ContractActionArgs, CommandResult>(CareerCommandProvider.DeclineContractCommand, args => CareerCommandProvider.HandleDeclineContract(_actuator, args));
            host.AddCommandHandler<ContractActionArgs, CommandResult>(CareerCommandProvider.CancelContractCommand, args => CareerCommandProvider.HandleCancelContract(_actuator, args));
            host.AddCommandHandler<UpgradeFacilityArgs, CommandResult>(CareerCommandProvider.UpgradeFacilityCommand, args => CareerCommandProvider.HandleUpgradeFacility(_actuator, args));
        }

        private static CommandDeclaration Command(string command, bool delayed) => new CommandDeclaration
        {
            Command = command,
            Delayed = delayed,
        };
    }
}
