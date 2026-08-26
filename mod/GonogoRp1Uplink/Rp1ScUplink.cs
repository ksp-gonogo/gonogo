using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// GonogoRp1Uplink: RP-1's space centre on the wire. The build queue, the
    /// launch complexes and their pads, the rollout and reconditioning
    /// operations, the research queue, the payroll, Confidence, and the
    /// Programs the career's funding is committed against.
    ///
    /// <para><b>A sibling of GonogoAvionicsUplink, never merged into it.</b> Both
    /// read RP-1 by reflection, and one probe and one health row would be
    /// tidier, but <c>AddSampledSource</c>'s contract is that a capture which
    /// throws takes its OWNING Uplink inert from the next tick. Merged, a
    /// null-deref in build-queue reflection against an RP-1 build nobody here has
    /// seen would take the avionics controllable-mass go/no-go dark on the pad.
    /// That readout is a launch-safety surface and must not depend on the health
    /// of a build-queue reader. The duplicated probe and the second
    /// NOTICE-RP1.txt are that rule working, not a lapse: an Uplink may reference
    /// only Sitrep.Contract and its own contract slice, so a shared helper
    /// assembly is no more available to us than to a third party.</para>
    ///
    /// <para>Every channel is <see cref="DelayRole.TrueNow"/>. This is state at a
    /// space centre, read at KSC cadence, and it has no analogue in flight: the
    /// same disposition the stock <c>spaceCenter.*</c> and <c>career.*</c>
    /// channels take.</para>
    ///
    /// <para>The capture/handle split is load-bearing rather than ceremony. The
    /// reflection walk reads a live object graph, which is only legal on the main
    /// thread; <see cref="HandleOnCourier"/> receives plain data and publishes,
    /// touching no game API at all.</para>
    /// </summary>
    [SitrepUplink("rp1")]
    public sealed class Rp1ScUplink : ISitrepUplink
    {
        public const string AvailableTopic = "rp1.available";
        public const string CentresTopic = "rp1.centres";
        public const string ComplexesTopic = "rp1.complexes";
        public const string BuildQueueTopic = "rp1.buildQueue";
        public const string WarehouseTopic = "rp1.warehouse";
        public const string PadsTopic = "rp1.pads";
        public const string OperationsTopic = "rp1.operations";
        public const string ResearchTopic = "rp1.research";
        public const string PersonnelTopic = "rp1.personnel";
        public const string ConfidenceTopic = "rp1.confidence";
        public const string ProgramsTopic = "rp1.programs";
        public const string ProgramSlotsTopic = "rp1.programSlots";

        /// <summary>
        /// Rows published per second across every rp1.* channel. One capture per
        /// tick emits one row per centre, complex, queued vehicle, pad, operation,
        /// research node and Program, so this counts the thing that actually
        /// grows: a mature RP-1 career with several centres, a full tech queue and
        /// the whole forty-one Program catalogue is a few hundred rows a tick, and
        /// a runaway means the subscription gate stopped gating rather than that
        /// the career got big.
        /// </summary>
        private static readonly PerfBudget Rp1RowBudget = new PerfBudget(
            "Rp1ScUplink rows published", threshold: 5000, windowSec: 1.0, unit: "rows");

        private readonly Rp1ScReflection _rp1 = new Rp1ScReflection();

        /// <summary>
        /// RP-1's Programs, on their own reader and their own sampled source.
        /// Separate from the space-centre walk because the two answer unrelated
        /// questions at unrelated rates and share no object: the space centre is
        /// read per launch complex every tick, the Program catalogue is a
        /// forty-one row list that changes when an operator visits the
        /// Administration building. Kept apart, a dashboard watching only the
        /// build queue never pays for the Program walk, which is what the
        /// subscription gate is for.
        /// </summary>
        private readonly Rp1ProgramsReflection _programs = new Rp1ProgramsReflection();

        /// <summary>
        /// RP-1's answer to what a career's money is doing, offered to the
        /// exclusive <c>"economy"</c> capability. Its own reader, not part of the
        /// space-centre capture: the two share nothing but the assembly, and the
        /// capability's consumer is core's own career channel.
        /// </summary>
        private readonly Rp1EconomyBackend _economy = new Rp1EconomyBackend();

        /// <summary>Set when the provider registration threw, so Health can say so rather than nothing.</summary>
        private string? _economyRegistrationError;

        private IChannelPublisher? _centres;
        private IChannelPublisher? _complexes;
        private IChannelPublisher? _buildQueue;
        private IChannelPublisher? _warehouse;
        private IChannelPublisher? _pads;
        private IChannelPublisher? _operations;
        private IChannelPublisher? _research;
        private IChannelPublisher? _personnel;
        private IChannelPublisher? _confidence;
        private IChannelPublisher? _programList;
        private IChannelPublisher? _programSlots;

        /// <summary>
        /// Whether RP-1 is managing this save, asked fresh rather than remembered
        /// from the last capture.
        ///
        /// <para>It used to be a field the capture wrote, and that made the answer
        /// depend on somebody watching an <c>rp1.*</c> topic: the capture is
        /// subscription-gated, so on an unwatched career the field stayed false and
        /// the roster reported the Uplink Degraded, with "RP-1 is loaded but not
        /// enabled for this save", about a save RP-1 was managing throughout. The
        /// roster is polled whether or not anything of ours is subscribed, so it
        /// cannot be answered from gated state.</para>
        ///
        /// <para>Safe from the Courier thread, where <see cref="Health"/> runs: it
        /// is a reflected read of a managed static's bool field and touches no Unity
        /// object. The <c>rp1.available</c> channel source makes the identical read
        /// from that thread already.</para>
        /// </summary>
        private bool EnabledForSave => _rp1.IsEnabledForSave();

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "rp1",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Ground(AvailableTopic),
                Ground(CentresTopic),
                Ground(ComplexesTopic),
                Ground(BuildQueueTopic),
                Ground(WarehouseTopic),
                Ground(PadsTopic),
                Ground(OperationsTopic),
                Ground(ResearchTopic),
                // Both singletons are legitimately absent from the first tick:
                // a stock install has no payroll and no Confidence module, and
                // without this the client would wait for a value that is never
                // coming instead of being told there is none.
                Ground(PersonnelTopic, absenceIsData: true),
                Ground(ConfidenceTopic, absenceIsData: true),
                // Both Program channels publish NOTHING rather than an empty
                // list when RP-1's ProgramHandler is not live. The distinction
                // matters more here than anywhere else on this Uplink: RP-1's
                // catalogue is never empty, so an empty list can only mean "this
                // career has been offered nothing", which is a claim about the
                // career rather than about the install.
                Ground(ProgramsTopic, absenceIsData: true),
                Ground(ProgramSlotsTopic, absenceIsData: true),
            },
        };

        private static ChannelDeclaration Ground(string topic, bool absenceIsData = false) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.TrueNow,
            AbsenceIsData = absenceIsData,
        };

        public void Register(IUplinkHost host)
        {
            // Presence is always sourced with the real answer, even when RP-1 is
            // absent, so a client can gate on it definitively rather than
            // inferring absence from silence.
            host.AddChannelSource(AvailableTopic, _ => _rp1.IsAvailable && _rp1.IsEnabledForSave());

            if (!_rp1.IsAvailable)
            {
                host.SetAvailability(Availability.Unavailable("RP-1 (RP0) assembly not loaded"));
                return;
            }

            // The economy provider: what RP-1 makes of the reputation core already
            // publishes. Registered from here, gated on the probe, because
            // registering IS the election gate; a stock install never sees this
            // line run and keeps the vanilla backend's truthful zeros.
            //
            // Registered SEPARATELY from the channels below and deliberately
            // before them: an economy provider that fails to register must not
            // cost this Uplink its own read surface, and vice versa. A failure is
            // surfaced on Health rather than swallowed.
            try
            {
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = "economy",
                    Id = "rp1",
                    Priority = 10.0,
                    Factory = _ => _economy,
                });
            }
            catch (Exception ex)
            {
                _economyRegistrationError = ex.Message;
            }

            _centres = host.Publisher(CentresTopic);
            _complexes = host.Publisher(ComplexesTopic);
            _buildQueue = host.Publisher(BuildQueueTopic);
            _warehouse = host.Publisher(WarehouseTopic);
            _pads = host.Publisher(PadsTopic);
            _operations = host.Publisher(OperationsTopic);
            _research = host.Publisher(ResearchTopic);
            _personnel = host.Publisher(PersonnelTopic);
            _confidence = host.Publisher(ConfidenceTopic);
            _programList = host.Publisher(ProgramsTopic);
            _programSlots = host.Publisher(ProgramSlotsTopic);

            host.AddSampledSource(
                CaptureOnMain,
                HandleOnCourier,
                CentresTopic,
                ComplexesTopic,
                BuildQueueTopic,
                WarehouseTopic,
                PadsTopic,
                OperationsTopic,
                ResearchTopic,
                PersonnelTopic,
                ConfidenceTopic);

            // Gated, and safe to gate: this capture's ENTIRE effect is its
            // return value. It stashes nothing, elects nothing, and no command
            // pre-filter reads it, so a tick nobody is watching skips a walk over
            // forty-one Programs and starves nothing downstream.
            host.AddSampledSource(
                CaptureProgramsOnMain,
                HandleProgramsOnCourier,
                ProgramsTopic,
                ProgramSlotsTopic);
        }

        /// <summary>
        /// MAIN-THREAD capture: the whole reflection walk, returning plain data
        /// with no live RP-1 object in it.
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (!_rp1.IsAvailable)
            {
                return null;
            }
            var raw = _rp1.Read(snapshot?.Ut ?? 0.0);
            return raw;
        }

        /// <summary>COURIER-THREAD handle: map to wire dicts and publish. No game API.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (!(captured is Rp1ScRaw raw))
            {
                return;
            }

            var centres = Rp1ScCapture.BuildCentres(raw);
            var complexes = Rp1ScCapture.BuildComplexes(raw);
            var buildQueue = Rp1ScCapture.BuildQueue(raw);
            var warehouse = Rp1ScCapture.BuildWarehouse(raw);
            var pads = Rp1ScCapture.BuildPads(raw);
            var operations = Rp1ScCapture.BuildOperations(raw);
            var research = Rp1ScCapture.BuildResearch(raw);

            Rp1RowBudget.Record(
                centres.Count + complexes.Count + buildQueue.Count + warehouse.Count
                + pads.Count + operations.Count + research.Count,
                raw.Ut);

            _centres?.Publish(centres, raw.Ut);
            _complexes?.Publish(complexes, raw.Ut);
            _buildQueue?.Publish(buildQueue, raw.Ut);
            _warehouse?.Publish(warehouse, raw.Ut);
            _pads?.Publish(pads, raw.Ut);
            _operations?.Publish(operations, raw.Ut);
            _research?.Publish(research, raw.Ut);
            _personnel?.Publish(Rp1ScCapture.BuildPersonnel(raw), raw.Ut);
            _confidence?.Publish(Rp1ScCapture.BuildConfidence(raw), raw.Ut);
        }

        /// <summary>
        /// MAIN-THREAD capture of RP-1's Programs. On the main thread because
        /// the requirement and objective predicates it evaluates reach KSP's own
        /// tech, contract and facility state; see
        /// <see cref="Rp1ProgramsReflection"/>'s header for the audit of every
        /// one of them.
        /// </summary>
        internal object? CaptureProgramsOnMain(KspSnapshot? snapshot) =>
            _programs.IsAvailable ? _programs.Read(snapshot?.Ut ?? 0.0) : null;

        /// <summary>COURIER-THREAD handle: map to wire dicts and publish. No game API.</summary>
        internal void HandleProgramsOnCourier(object? captured)
        {
            var raw = captured as Rp1ProgramsRaw;
            var rows = Rp1ProgramsCapture.BuildPrograms(raw);
            Rp1RowBudget.Record(rows?.Count ?? 0, raw?.Ut ?? 0.0);
            _programList?.Publish(rows, raw?.Ut ?? 0.0);
            _programSlots?.Publish(Rp1ProgramsCapture.BuildSlots(raw), raw?.Ut ?? 0.0);
        }

        /// <summary>
        /// Health, and WHICH RP-1. The version caveat at the top of
        /// <see cref="Rp1ScReflection"/> is why these facts are load-bearing
        /// rather than decorative: RP-1 ships roughly monthly, this Uplink is
        /// locked against one build's disassembly, and an operator reporting "the
        /// build queue is empty" can be asked to quote a row instead of guessing.
        /// </summary>
        public UplinkHealth Health()
        {
            var facts = new List<UplinkHealthFact>
            {
                new UplinkHealthFact("RP0 assembly", _rp1.AssemblyIdentity),
                new UplinkHealthFact("SpaceCenterManagement", _rp1.IsAvailable ? "resolved" : "type not found"),
                new UplinkHealthFact("Confidence", _rp1.ConfidenceTypeResolved ? "present" : "absent"),
                new UplinkHealthFact("ProgramHandler", _programs.IsAvailable ? "resolved" : "type not found"),
                new UplinkHealthFact("save mode", EnabledForSave ? "enabled" : "not enabled for this save"),
                new UplinkHealthFact("read against", "RP-1 v4.6.0.0"),
                new UplinkHealthFact(
                    "economy provider",
                    _economyRegistrationError != null
                        ? "registration failed: " + _economyRegistrationError
                        : _economy.IsAvailable ? "registered" : "maintenance types not found"),
            };

            if (!_rp1.IsAvailable)
            {
                return new UplinkHealth(UplinkHealthState.Unavailable, "RP-1 (RP0) assembly not loaded", facts);
            }
            if (!EnabledForSave)
            {
                // Degraded rather than Unavailable: RP-1 is installed and the
                // Uplink is working, the save simply is not one RP-1 manages, and
                // that distinction is what an operator needs to see.
                return new UplinkHealth(
                    UplinkHealthState.Degraded,
                    "RP-1 is loaded but not enabled for this save",
                    facts);
            }
            return new UplinkHealth(UplinkHealthState.Healthy, null, facts);
        }
    }
}
