using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Sitrep.Host.Science;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled CORE science registration: the science analogue of
    /// <see cref="CommsCoreUplink"/> / <see cref="ReliabilityCoreUplink"/>. It
    /// OWNS the exclusive <c>"science"</c> capability (registering
    /// <see cref="StockScienceBackend"/> as the always-present Vanilla factory),
    /// declares the five <c>science.*</c> channels and the two
    /// <c>science.experiment.*</c> commands ONCE, and sources them from whichever
    /// backend the election picked, resolved at map/dispatch time via
    /// <c>host.Kernel.Query&lt;IScienceBackend&gt;("science")</c>. A
    /// science-modelling mod registers a provider from its OWN
    /// uplink's Register and declares none of these channels itself: that is the
    /// shared-namespace-single-declaration rule comms.*/reliability.* follow.
    ///
    /// <para>Before the election existed this class wired
    /// <see cref="ScienceViewProvider"/>'s builders straight into
    /// <c>AddChannelSource</c>. It still does, one indirection later: the elected
    /// backend is asked for the payload, and the vanilla backend delegates to the
    /// very same builders. Nothing else changed, which is why the stock wire is
    /// byte-identical (<c>Sitrep.Host.Tests.ScienceElectionWireTests</c> pins it
    /// as bytes through the real codec).</para>
    ///
    /// <para>One channel per science sub-group, rather than one combined
    /// topic: experiments/instruments/lab/sensors/experimentBreakdown
    /// genuinely change at different cadences (an experiment's data changes
    /// on run/collect; a lab processes continuously), and
    /// ScienceOfficer/ScienceBench each only need a subset. The Breaking
    /// Ground deployed-experiment channel that used to live here (placed
    /// once and then mostly idling, a genuinely different cadence again)
    /// moved to the bundled, DLC-gated <see cref="BreakingGroundUplink"/>:
    /// deployed science is a Serenity-specific surface, not vanilla onboard
    /// science, and it stays outside the capability for the reason
    /// <see cref="ScienceElection"/>'s doc comment gives.
    /// <see cref="BreakingGroundUplink"/> still reads the same raw
    /// <c>Values["science"]["deployed"]</c> snapshot key <c>KspHost.BuildScience</c>
    /// populates.</para>
    ///
    /// <para>Experiment actuation rides here too: <c>science.experiment.deploy</c>
    /// and <c>science.experiment.transmit</c>, dispatched to the elected backend
    /// (the vanilla one is <see cref="ScienceCommandProvider"/>'s <c>Handle*</c>
    /// glue against the <see cref="IScienceActuator"/> this uplink is constructed
    /// with, <see cref="KspScienceActuator"/> in production). Both are genuine
    /// uplinks to the craft (they actuate an experiment ON the vessel), so both
    /// are declared <c>delayed: true</c>. Reset/collect remain a follow-up.</para>
    /// </summary>
    [SitrepUplink("science")]
    public sealed class ScienceCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        private readonly IScienceActuator _actuator;

        /// <summary>
        /// The vanilla backend this uplink falls back to when the Kernel has not
        /// resolved (or never registered) the capability: stock science, the
        /// same instance shape <see cref="ScienceElection"/>'s Vanilla factory
        /// builds. <see cref="ReliabilityCoreUplink"/> publishes nothing in that
        /// window instead, which it can afford because it has no pre-election
        /// behaviour to preserve; science does, so it keeps serving stock rather
        /// than going silent on a channel a client is already subscribed to.
        /// </summary>
        private readonly IScienceBackend _vanilla;

        private Kernel? _kernel;

        public ScienceCoreUplink(IScienceActuator actuator)
        {
            _actuator = actuator;
            _vanilla = new StockScienceBackend(actuator);
        }

        /// <summary>
        /// The discovery-required parameterless constructor (see
        /// <c>Sitrep.Host.UplinkDiscovery</c>: a discoverable Uplink resolves
        /// its own real dependency rather than taking it as a discovery-time
        /// argument). Builds its own <see cref="KspScienceActuator"/>, mirroring
        /// <see cref="VesselUplink"/>'s parameterless-ctor shape.
        /// </summary>
        public ScienceCoreUplink() : this(new KspScienceActuator())
        {
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "science",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.ExperimentsTopic,
                    Delivery = Delivery.LossyLatest,
                    // Same 30s-keyframe + "fresh Dictionary every call reads
                    // as changed" cadence CareerUplink/SystemUplink
                    // already use for structured, not-every-tick data.
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit: vessel/experiment-sourced, rides the delay clock.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.InstrumentsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit: active-vessel instrument inventory, rides the delay clock.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.LabTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit: same as ExperimentsTopic above.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.SensorsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit: active-vessel environmental-sensor
                    // readouts, rides the delay clock like the rest of science.*.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.ExperimentBreakdownTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Per-subject rollup of the same onboard science data,
                    // rides the delay clock like the rest of science.*.
                    Delay = DelayRole.Delayed,
                },
            },
            // Experiment actuation is a genuine uplink to the craft (deploy runs
            // an experiment ON the vessel; transmit drives its onboard
            // transmitter), so both ride the same light-time delay every other
            // vessel actuation does, delayed: true. See VesselUplink's command
            // table for the full delay-classification rule.
            Commands = new List<CommandDeclaration>
            {
                Command(ScienceCommandProvider.DeployCommand, delayed: true),
                Command(ScienceCommandProvider.TransmitCommand, delayed: true),
            },
        };

        /// <summary>
        /// Declared HERE in the pre-Register capability pass (two-pass fix, same
        /// as CommsCoreUplink/ReliabilityCoreUplink), so the capability exists
        /// before any provider uplink's Register runs: a provider's
        /// registration can never race ahead of this declaration regardless of
        /// assembly-scan order.
        /// </summary>
        public void DeclareCapabilities(Kernel kernel) => ScienceElection.RegisterCapability(kernel, _actuator);

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error. Unlike
        /// <see cref="ReliabilityCoreUplink"/> this never reports Unavailable on an
        /// unresolved capability, because it always has a backend to serve from
        /// (see <see cref="_vanilla"/>).</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;

            // COURIER-THREAD mappers, unchanged in shape from the pre-election
            // wiring: the elected backend maps that tick's already-captured
            // snapshot. A backend whose data is not on the shared snapshot reads
            // it on the main thread through its own AddSampledSource capture (see
            // IScienceBackend's doc comment); nothing here may touch live KSP.
            //
            // ATTRIBUTION wraps every one of them: all five topics are fixed-name
            // active-vessel reads on a Delayed channel, so a delivered sample must
            // name the vessel it describes or a value cached across a vessel switch
            // reads as the new ship's science. The subject is the identity on the
            // very snapshot the entries were mapped off, never
            // FlightGlobals.ActiveVessel: this runs on the Courier thread, where
            // touching KSP is illegal, and the two can differ exactly when it
            // matters. Stamped here rather than in the backend because this uplink
            // owns the topic declaration; see Sitrep.Host.VesselAttribution.
            host.AddChannelSource(ScienceViewProvider.ExperimentsTopic, s => Attribute(Backend().Experiments(s), s));
            host.AddChannelSource(ScienceViewProvider.InstrumentsTopic, s => Attribute(Backend().Instruments(s), s));
            host.AddChannelSource(ScienceViewProvider.LabTopic, s => Attribute(Backend().Lab(s), s));
            host.AddChannelSource(ScienceViewProvider.SensorsTopic, s => Attribute(Backend().Sensors(s), s));
            host.AddChannelSource(ScienceViewProvider.ExperimentBreakdownTopic, s => Attribute(Backend().ExperimentBreakdown(s), s));

            host.AddCommandHandler<ExperimentActionArgs, CommandResult>(ScienceCommandProvider.DeployCommand, args => Backend().DeployExperiment(args));
            host.AddCommandHandler<ExperimentActionArgs, CommandResult>(ScienceCommandProvider.TransmitCommand, args => Backend().TransmitExperiment(args));
        }

        /// <summary>
        /// The elected backend, or stock when the capability has not resolved.
        /// Resolved per call rather than cached at Register: capability
        /// resolution happens AFTER every uplink's Register, and a quickload can
        /// re-resolve.
        /// </summary>
        private IScienceBackend Backend() =>
            (_kernel != null ? ScienceElection.Elected(_kernel) : null) ?? _vanilla;

        /// <summary>
        /// Names the vessel a mapped payload describes, whichever backend produced
        /// it and whichever shape it came back in (dictionary entries or typed
        /// POCOs). Attribution only: it adds a subject to the entries the backend
        /// already built and changes nothing else about them.
        /// </summary>
        private static object? Attribute(object? payload, KspSnapshot? snapshot) =>
            VesselAttribution.Stamp(payload, VesselAttribution.VesselIdOf(snapshot));

        private static CommandDeclaration Command(string command, bool delayed) => new CommandDeclaration
        {
            Command = command,
            Delayed = delayed,
        };
    }
}
