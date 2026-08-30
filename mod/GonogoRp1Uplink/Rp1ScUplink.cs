using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// GonogoRp1Uplink: RP-1's space centre on the wire. The build queue, the
    /// launch complexes and their pads, the rollout and reconditioning
    /// operations, the construction queue, the research queue, the payroll,
    /// Confidence, the Programs the career's funding is committed against, and
    /// the crew schedule: retirement dates, training courses and the training an
    /// operator is about to lose.
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
        public const string BuildableTopic = "rp1.buildable";
        public const string PadsTopic = "rp1.pads";
        public const string OperationsTopic = "rp1.operations";
        public const string ConstructionsTopic = "rp1.constructions";
        public const string ResearchTopic = "rp1.research";
        public const string PersonnelTopic = "rp1.personnel";
        public const string RushTermsTopic = "rp1.rushTerms";
        public const string ConfidenceTopic = "rp1.confidence";
        public const string ProgramsTopic = "rp1.programs";
        public const string ProgramSlotsTopic = "rp1.programSlots";
        public const string ProgramFundingCurvesTopic = "rp1.programFundingCurves";
        public const string CrewTopic = "rp1.crew";
        public const string CrewProgramTopic = "rp1.crewProgram";

        /// <summary>
        /// Rows published per second across every rp1.* channel. One capture per
        /// tick emits one row per centre, complex, queued vehicle, pad, operation,
        /// construction, research node and Program, so this counts the thing that actually
        /// grows: a mature RP-1 career with several centres, a full tech queue and
        /// the whole thirty-seven Program catalogue is a few hundred rows a tick, and
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
        /// thirty-seven row list that changes when an operator visits the
        /// Administration building. Kept apart, a dashboard watching only the
        /// build queue never pays for the Program walk, which is what the
        /// subscription gate is for.
        /// </summary>
        private readonly Rp1ProgramsReflection _programs = new Rp1ProgramsReflection();

        /// <summary>
        /// RP-1's crew bookkeeping, on its own reader for the same reason Programs
        /// are: it answers an unrelated question off an unrelated object, at the
        /// cadence an operator visits the Astronaut Complex rather than the cadence
        /// a launch complex is watched.
        ///
        /// <para>It is ALSO the reader behind the crew-standing backend below, and
        /// that half is not sampled at all: it is asked one name at a time by
        /// core's own space-centre capture. That is deliberate, and the whole
        /// reason the reader is shared rather than duplicated: the retiree set both
        /// halves consult must be the same set.</para>
        /// </summary>
        private readonly Rp1CrewReflection _crew = new Rp1CrewReflection();

        /// <summary>
        /// RP-1's answer to whether a kerbal off the flight roster is dead, offered
        /// to the exclusive <c>"crewStanding"</c> capability. Its own provider, like
        /// the economy backend, because its consumer is core's own crew roster
        /// rather than any channel of ours.
        /// </summary>
        private readonly Rp1CrewStandingBackend _crewStanding;

        /// <summary>
        /// RP-1's answer to what a career's money is doing, offered to the
        /// exclusive <c>"economy"</c> capability. Its own reader, not part of the
        /// space-centre capture: the two share nothing but the assembly, and the
        /// capability's consumer is core's own career channel.
        /// </summary>
        private readonly Rp1EconomyUpkeepQuery _upkeepQuery = new Rp1EconomyUpkeepQuery();

        private readonly Rp1EconomyBackend _economy;

        /// <summary>Set when the provider registration threw, so Health can say so rather than nothing.</summary>
        private string? _economyRegistrationError;

        /// <summary>
        /// RP-1's launch rules, contributed to core's own <c>ksp.launch</c>. Its
        /// own reader, not part of the space-centre capture: the capture is
        /// subscription-gated and one tick stale, and a gate has to answer from
        /// the model as it stands at the moment of the dispatch.
        /// </summary>
        private readonly Rp1LaunchGate _launch = new Rp1LaunchGate();

        /// <summary>Set when the launch-gate registration threw, so Health can say so rather than nothing.</summary>
        private string? _launchGateRegistrationError;

        /// <summary>
        /// The two stock career purchases RP-1 re-models as queued projects,
        /// contributed to core's own <c>career.facility.upgrade</c> and
        /// <c>career.tech.unlock</c>. Its own reader, like the launch gate above
        /// and for the same reason.
        /// </summary>
        private readonly Rp1CareerProjectGate _careerProjects = new Rp1CareerProjectGate();

        /// <summary>Set when that contribution threw, so Health can say so rather than nothing.</summary>
        private string? _careerProjectGateRegistrationError;

        /// <summary>
        /// The write half of RP-1's build queue: the repeat-build command and the
        /// gate that darkens it. Its own reader, like the launch gate beside it
        /// and for the same reason: a command answers from the model as it stands
        /// at the moment of the dispatch, and the space-centre capture is
        /// subscription-gated and one tick stale.
        /// </summary>
        private readonly Rp1BuildCommands _build = new Rp1BuildCommands();

        /// <summary>
        /// The rest of that write half: roll out, roll back, scrap, and a
        /// complex's rush mode. A second reader for the same reason
        /// <see cref="_build"/> is one, and it borrows that one's gate rather
        /// than declaring a second kind, because all five commands turn on the
        /// same single question.
        /// </summary>
        private readonly Rp1VehicleCommands _vehicles = new Rp1VehicleCommands();

        /// <summary>
        /// The staffing write. Its own class rather than a sixth vehicle command,
        /// because it is the one write here that touches no vehicle at all: it
        /// moves engineers between a centre's pool and a launch complex, and a
        /// complex is infrastructure.
        /// </summary>
        private readonly Rp1PersonnelCommands _staffing = new Rp1PersonnelCommands();

        /// <summary>
        /// The facility upgrade RP-1 turns into a construction project, which is
        /// the command <see cref="Rp1CareerProjectGate"/> refuses core's
        /// <c>career.facility.upgrade</c> in favour of. Its own reader for the
        /// reason the writes above have one, and its own class because it shares
        /// nothing with them: it touches no vehicle and no launch complex, only
        /// the space centre's own buildings.
        /// </summary>
        private readonly Rp1FacilityUpgradeCommands _facilities = new Rp1FacilityUpgradeCommands();
        /// The command that starts a design the space centre has never held, from
        /// one of the save's own craft files. Its own reader for the reason the two
        /// above are, and it holds a LAZY route to core's craft catalogue rather
        /// than the catalogue itself: providers register during registration and
        /// the Kernel elects afterwards, so anything resolved in a constructor
        /// would be null for the life of the game.
        /// </summary>
        private readonly Rp1BuildStartCommands _start;

        /// <summary>
        /// The Kernel, kept so the craft catalogue can be resolved at the moment
        /// it is needed. Set in <see cref="Register"/>; null before then, which
        /// makes the catalogue absent and the start command's gate say so.
        /// </summary>
        private Kernel? _kernel;

        /// <summary>Set when the command registration threw, so Health can say so rather than nothing.</summary>
        private string? _buildCommandRegistrationError;

        /// <summary>
        /// The command RP-1's launch rules are contributed to. Spelled out rather
        /// than referenced: <c>FlightOpsCommandProvider</c> lives in
        /// <c>Sitrep.Host</c>, which an Uplink may not reference, and a
        /// third-party author naming somebody else's command is in exactly this
        /// position.
        /// </summary>
        private const string FlightOpsLaunchCommand = "ksp.launch";

        /// <summary>The facility upgrade RP-1 turns into a construction project. Spelled out for the reason above.</summary>
        private const string CareerFacilityUpgradeCommand = "career.facility.upgrade";

        /// <summary>The tech unlock RP-1 turns into a research project. Spelled out for the reason above.</summary>
        private const string CareerTechUnlockCommand = "career.tech.unlock";
        /// <summary>The same, for the simulation provider. Separate field because the two register independently.</summary>
        private string? _simulationRegistrationError;

        /// <summary>Set when the crew-standing provider registration threw; see <see cref="_economyRegistrationError"/>.</summary>
        private string? _crewStandingRegistrationError;

        /// <summary>
        /// RP-1's arm of the derived-currency capability: keeps confidence (and the
        /// science-points total its price is read off) withheld for as long as the
        /// science credit they were derived from is. Held as a field rather than
        /// built in the factory closure because its failure counters are read back
        /// out on <see cref="Health"/>.
        /// </summary>
        private readonly Rp1DerivedCurrencyWithholder _confidenceWithhold = new Rp1DerivedCurrencyWithholder();

        private string? _derivedCurrencyRegistrationError;

        private IChannelPublisher? _centres;
        private IChannelPublisher? _complexes;
        private IChannelPublisher? _buildQueue;
        private IChannelPublisher? _warehouse;
        private IChannelPublisher? _buildable;
        private IChannelPublisher? _pads;
        private IChannelPublisher? _operations;
        private IChannelPublisher? _constructions;
        private IChannelPublisher? _research;
        private IChannelPublisher? _personnel;
        private IChannelPublisher? _rushTerms;
        private IChannelPublisher? _confidence;
        private IChannelPublisher? _programList;
        private IChannelPublisher? _programSlots;
        private IChannelPublisher? _programCurves;
        private IChannelPublisher? _crewList;
        private IChannelPublisher? _crewProgram;

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

        /// <summary>
        /// Assigned from a constructor rather than a field initialiser because
        /// the command list is CONDITIONAL on RP-1's build model resolving, and a
        /// field initialiser may not read another instance field.
        ///
        /// <para>Conditional because a declared requirement whose evaluator never
        /// registers is a startup failure by design, and the evaluator registers
        /// only when RP-1 is present. A stock install would otherwise declare a
        /// command it cannot gate and take the whole mod down at load.</para>
        /// </summary>
        public UplinkManifest Manifest { get; }

        public Rp1ScUplink()
        {
            _start = new Rp1BuildStartCommands(Catalogue);
            Manifest = BuildManifest(
                _build.IsAvailable, _vehicles.IsAvailable, _vehicles.IsMoveAvailable,
                _staffing.IsAvailable, _start.IsAvailable, _facilities.IsAvailable);
            _crewStanding = new Rp1CrewStandingBackend(_crew);
            _economy = new Rp1EconomyBackend(_upkeepQuery);
        }

        private static UplinkManifest BuildManifest(
            bool buildModelResolved,
            bool queueModelResolved,
            bool moveModelResolved,
            bool staffingModelResolved,
            bool startModelResolved,
            bool facilityModelResolved) => new UplinkManifest
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
                // An EMPTY list is a real answer here, unlike the singletons
                // below: a career with no craft saved has nothing to start,
                // and so does an install whose core cannot open craft files.
                // Both are things an operator needs told rather than left to
                // read as silence.
                Ground(BuildableTopic),
                Ground(PadsTopic),
                Ground(OperationsTopic),
                Ground(ConstructionsTopic),
                Ground(ResearchTopic),
                // Both singletons are legitimately absent from the first tick:
                // a stock install has no payroll and no Confidence module, and
                // without this the client would wait for a value that is never
                // coming instead of being told there is none.
                Ground(PersonnelTopic, absenceIsData: true),
                // The rush terms come out of RP-1's own settings, so an install
                // whose settings could not be read publishes nothing rather than
                // the shipped defaults. Quoting a price the career does not
                // charge is worse than declining to quote one.
                Ground(RushTermsTopic, absenceIsData: true),
                Ground(ConfidenceTopic, absenceIsData: true),
                // All three Program channels publish NOTHING rather than an
                // empty list when RP-1's ProgramHandler is not live. The
                // distinction matters more here than anywhere else on this
                // Uplink: RP-1's catalogue is never empty, so an empty list can
                // only mean "this career has been offered nothing", which is a
                // claim about the career rather than about the install. The
                // curve table is the same shape one layer down: RP-1 ships
                // twelve curves and pays every Program on one of them, so an
                // empty table could only say it pays on none.
                Ground(ProgramsTopic, absenceIsData: true),
                Ground(ProgramSlotsTopic, absenceIsData: true),
                Ground(ProgramFundingCurvesTopic, absenceIsData: true),
                // Both crew channels publish NOTHING rather than an empty list or
                // a bag of falses when RP-1's CrewHandler is not live. An empty
                // crew list would say "RP-1 is scheduling nobody" and a false
                // retirementEnabled would say retirement is switched OFF, and both
                // are claims about a career on a save RP-1 is not managing at all.
                Ground(CrewTopic, absenceIsData: true),
                Ground(CrewProgramTopic, absenceIsData: true),
            },
            // Delayed: false, the same disposition every ground-side career write
            // takes and for the same reason core's own nine give: light-time is
            // what separates a command centre from a CRAFT, and there is no craft
            // in this one. Telling a launch complex to integrate another vehicle
            // is KSC bookkeeping that happens where the KSC is, so a delayed
            // dispatch would invent a lag the model does not claim exists. The
            // client still routes it through the delay-aware command hooks, which
            // is what makes that answer visible rather than assumed: an operator
            // sees a command that confirms at once, not a control that quietly
            // has no delay UX.
            Commands = DeclareCommands(
                buildModelResolved, queueModelResolved, moveModelResolved,
                staffingModelResolved, startModelResolved, facilityModelResolved),
        };

        /// <summary>
        /// The seven write commands, each declared only when the types its own
        /// handler needs resolved.
        ///
        /// <para>Four conditions rather than one, because the dependencies
        /// genuinely differ: the repeat build needs RP-1's currency query,
        /// correcting a queue needs none of it, moving a vehicle needs the
        /// rollout type neither of the others touches, and staffing a complex
        /// needs none of the three. Declaring all six off one flag would cost
        /// five commands for a rename that broke one.</para>
        ///
        /// <para>Nearly all of them declare the SAME requirement, which is why
        /// there is one gate evaluator between them: the only condition
        /// evaluable before the press is that RP-1 is managing the save, and each
        /// command's own conditions are about a complex or a vehicle nobody has
        /// named yet. The facility upgrade is the exception and adds a second,
        /// because the facilities it prices exist in one scene only and that is
        /// answerable before anyone names a building.</para>
        /// </summary>
        private static IReadOnlyList<CommandDeclaration> DeclareCommands(
            bool buildModelResolved,
            bool queueModelResolved,
            bool moveModelResolved,
            bool staffingModelResolved,
            bool startModelResolved,
            bool facilityModelResolved)
        {
            var commands = new List<CommandDeclaration>();
            if (buildModelResolved)
            {
                commands.Add(Declare(Rp1BuildCommands.RepeatCommand));
            }
            if (startModelResolved)
            {
                // TWO requirements rather than one, and the second is the only
                // place in this Uplink where a command's addressability turns on
                // something that is not RP-1's: whether this install can open a
                // craft file at all. Both are static, so the engine decides both
                // with an empty argument bag and the control is dark with its
                // reason before anyone presses it.
                commands.Add(new CommandDeclaration
                {
                    Command = Rp1BuildStartCommands.StartCommand,
                    Delayed = false,
                    Requires = new[]
                    {
                        Rp1BuildCommands.Requirements()[0],
                        Rp1BuildStartCommands.Requirement(),
                    },
                });
            }
            if (moveModelResolved)
            {
                commands.Add(Declare(Rp1VehicleCommands.RolloutCommand));
                commands.Add(Declare(Rp1VehicleCommands.RollbackCommand));
            }
            if (queueModelResolved)
            {
                commands.Add(Declare(Rp1VehicleCommands.ScrapCommand));
                commands.Add(Declare(Rp1VehicleCommands.RushCommand));
            }
            // Its own flag rather than sharing the queue's, even though today the
            // two resolve the same two types: a rename that cost one of them
            // should cost one of them.
            if (staffingModelResolved)
            {
                commands.Add(Declare(Rp1PersonnelCommands.AssignCommand));
            }
            if (facilityModelResolved)
            {
                // TWO requirements, and the second is the only condition in this
                // Uplink that is about the SCENE: the live UpgradeableFacility
                // objects carrying a tier and a price exist at the space centre
                // only, which was confirmed against the running game rather than
                // inferred (see Rp1FacilityUpgradeCommands' header). Declaring it
                // means the control is dark with that reason from anywhere else,
                // instead of answering a press with an empty list.
                commands.Add(new CommandDeclaration
                {
                    Command = Rp1FacilityUpgradeCommands.UpgradeCommand,
                    Delayed = false,
                    Requires = new[]
                    {
                        Rp1BuildCommands.Requirements()[0],
                        Rp1FacilityUpgradeCommands.FacilitiesRequirement(),
                    },
                });
            }
            return commands;
        }

        private static CommandDeclaration Declare(string command) => new CommandDeclaration
        {
            Command = command,
            Delayed = false,
            Requires = Rp1BuildCommands.Requirements(),
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
            _kernel = host.Kernel;

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

            // RP-1's launch rules, contributed to the command core owns. Same
            // registering-IS-the-gate discipline as the economy provider above,
            // and separately fail-softed for the same reason: a launch gate that
            // fails to register must not cost this Uplink its read surface, and a
            // read surface that fails must not silently unguard the launch.
            //
            // Contributed rather than elected. Preconditions compose: these are
            // ADDED to the scene rule and the two pre-flight tests core declares
            // on ksp.launch, and a second installed mod with its own launch
            // condition adds more rather than displacing these.
            try
            {
                if (_launch.IsAvailable)
                {
                    host.AddGateEvaluator(_launch);
                    foreach (var requirement in Rp1LaunchGate.Requirements())
                    {
                        host.AddCommandRequirement(FlightOpsLaunchCommand, requirement);
                    }
                }
            }
            catch (Exception ex)
            {
                _launchGateRegistrationError = ex.Message;
            }

            // The two career purchases RP-1 owns as queued projects, contributed
            // to the commands core declares for the stock versions. Same
            // contributed-not-elected discipline as the launch rules above: these
            // are ADDED to core's career-mode and facility-cap requirements, and
            // a second installed mod with its own condition adds more rather than
            // displacing these.
            //
            // Fail-softed separately for the same reason the registrations around
            // it are: a contribution that fails must not cost this Uplink its
            // read surface, and a read surface that fails must not leave the
            // stock write silently unguarded.
            try
            {
                if (_careerProjects.IsAvailable)
                {
                    host.AddGateEvaluator(_careerProjects);
                    host.AddCommandRequirement(
                        CareerFacilityUpgradeCommand, Rp1CareerProjectGate.FacilityRequirement());
                    host.AddCommandRequirement(
                        CareerTechUnlockCommand, Rp1CareerProjectGate.TechRequirement());
                }
            }
            catch (Exception ex)
            {
                _careerProjectGateRegistrationError = ex.Message;
            }

            // The build queue's write half. Registered on the SAME condition the
            // manifest declared the command on, and that pairing is the whole
            // reason both are conditional: the engine validates once, after every
            // Uplink has registered, that a declared requirement has an evaluator,
            // so declaring the command without registering this would be a
            // startup failure rather than a missing button.
            //
            // Fail-softed separately, like the two registrations above: a command
            // that cannot register must not cost this Uplink its read surface, and
            // a read surface that fails must not leave a command half-registered.
            try
            {
                // The evaluator goes up when ANY of the seven commands is
                // declared, not when the repeat build is: it answers the one
                // requirement they all declare, and a declaration without its
                // evaluator is a startup failure.
                if (_build.IsAvailable || _vehicles.IsAvailable || _staffing.IsAvailable
                    || _facilities.IsAvailable)
                {
                    host.AddGateEvaluator(_build);
                }
                if (_build.IsAvailable)
                {
                    host.AddCommandHandler<Rp1BuildRepeatArgs, CommandResult>(
                        Rp1BuildCommands.RepeatCommand, _build.Repeat);
                }
                if (_start.IsAvailable)
                {
                    host.AddGateEvaluator(_start);
                    host.AddCommandHandler<Rp1BuildStartArgs, CommandResult>(
                        Rp1BuildStartCommands.StartCommand, _start.Start);
                }
                if (_vehicles.IsMoveAvailable)
                {
                    host.AddCommandHandler<Rp1RolloutArgs, CommandResult>(
                        Rp1VehicleCommands.RolloutCommand, _vehicles.Rollout);
                    host.AddCommandHandler<Rp1VehicleArgs, CommandResult>(
                        Rp1VehicleCommands.RollbackCommand, _vehicles.Rollback);
                }
                if (_vehicles.IsAvailable)
                {
                    host.AddCommandHandler<Rp1VehicleArgs, CommandResult>(
                        Rp1VehicleCommands.ScrapCommand, _vehicles.Scrap);
                    host.AddCommandHandler<Rp1ComplexRushArgs, CommandResult>(
                        Rp1VehicleCommands.RushCommand, _vehicles.Rush);
                }
                if (_staffing.IsAvailable)
                {
                    host.AddCommandHandler<Rp1PersonnelAssignArgs, CommandResult>(
                        Rp1PersonnelCommands.AssignCommand, _staffing.Assign);
                }
                if (_facilities.IsAvailable)
                {
                    // Its own evaluator beside the shared one, because it is the
                    // only command here whose availability turns on something the
                    // build gate has no opinion about: whether the space centre's
                    // facilities are loaded at all.
                    host.AddGateEvaluator(_facilities);
                    host.AddCommandHandler<Rp1FacilityUpgradeArgs, CommandResult<Dictionary<string, object?>>>(
                        Rp1FacilityUpgradeCommands.UpgradeCommand, _facilities.Upgrade);
                }
            }
            catch (Exception ex)
            {
                _buildCommandRegistrationError = ex.Message;
            }

            // The simulation provider: whether the flight on screen is one of
            // RP-1's rehearsals. Registered on the same gate and for the same
            // reason as the economy provider above, and separately from it so
            // neither failure costs the other. Core cuts the signal delay for a
            // simulation off this answer (SimulationDelayPolicy), which is why
            // it is a capability rather than an rp1.* channel.
            try
            {
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = "simulation",
                    Id = "rp1",
                    Priority = 10.0,
                    Factory = _ => new Rp1SimulationBackend(_rp1),
                });
            }
            catch (Exception ex)
            {
                _simulationRegistrationError = ex.Message;
            }

            // The crew standing: whether a kerbal off the flight roster is dead or
            // retired. Registered separately from the economy provider and from the
            // channels for the same reason they are separate from each other, and
            // with a sharper edge here: this correction is the difference between
            // telling an operator their astronaut retired and telling them their
            // astronaut was killed, and it must not be lost because a build-queue
            // reader or an economy provider failed.
            try
            {
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CrewStandingCapability.Id,
                    Id = "rp1",
                    Priority = 10.0,
                    Factory = _ => _crewStanding,
                });
            }
            catch (Exception ex)
            {
                _crewStandingRegistrationError = ex.Message;
            }

            // Confidence is DERIVED from a science credit, and the currency-delay
            // subsystem withholds the credit by writing the balance back, which
            // fires no currency event, so RP-1 is never told to revisit the award it
            // has already banked. Without this arm the confidence moves at earn
            // while the science waits out its light-time, and an operator watching a
            // currency that gates real career decisions knows the science arrived
            // before the model says they can (rig run conf-leak-1, 2026-08-27).
            //
            // Registering IS the gate, same discipline as the three providers above,
            // and fail-softed separately for the same reason: an arm that fails to
            // register must not cost this Uplink its read surface, and a read surface
            // that fails must not silently reopen the leak.
            try
            {
                if (_confidenceWithhold.Available)
                {
                    host.Kernel.RegisterProvider(new ProviderRegistration
                    {
                        Capability = DerivedCurrencyCapability.CapabilityId,
                        Id = "rp1",
                        Factory = _ => _confidenceWithhold,
                    });
                }
            }
            catch (Exception ex)
            {
                _derivedCurrencyRegistrationError = ex.Message;
            }

            _centres = host.Publisher(CentresTopic);
            _complexes = host.Publisher(ComplexesTopic);
            _buildQueue = host.Publisher(BuildQueueTopic);
            _warehouse = host.Publisher(WarehouseTopic);
            _buildable = host.Publisher(BuildableTopic);
            _pads = host.Publisher(PadsTopic);
            _operations = host.Publisher(OperationsTopic);
            _constructions = host.Publisher(ConstructionsTopic);
            _research = host.Publisher(ResearchTopic);
            _personnel = host.Publisher(PersonnelTopic);
            _rushTerms = host.Publisher(RushTermsTopic);
            _confidence = host.Publisher(ConfidenceTopic);
            _programList = host.Publisher(ProgramsTopic);
            _programSlots = host.Publisher(ProgramSlotsTopic);
            _programCurves = host.Publisher(ProgramFundingCurvesTopic);
            _crewList = host.Publisher(CrewTopic);
            _crewProgram = host.Publisher(CrewProgramTopic);

            host.AddSampledSource(
                CaptureOnMain,
                HandleOnCourier,
                CentresTopic,
                ComplexesTopic,
                BuildQueueTopic,
                WarehouseTopic,
                BuildableTopic,
                PadsTopic,
                OperationsTopic,
                ConstructionsTopic,
                ResearchTopic,
                PersonnelTopic,
                RushTermsTopic,
                ConfidenceTopic);

            // Gated, and safe to gate: this capture's ENTIRE effect is its
            // return value. It stashes nothing, elects nothing, and no command
            // pre-filter reads it, so a tick nobody is watching skips a walk over
            // thirty-seven Programs and starves nothing downstream.
            host.AddSampledSource(
                CaptureProgramsOnMain,
                HandleProgramsOnCourier,
                ProgramsTopic,
                ProgramSlotsTopic,
                ProgramFundingCurvesTopic);

            // Gated, and safe to gate, on the same test the Programs capture
            // passes: this capture's ENTIRE effect is its return value. It stashes
            // nothing and elects nothing.
            //
            // The crew-standing correction is NOT fed by it, which is the point
            // worth being explicit about. The backend registered above reads RP-1's
            // retiree set itself, one name at a time, from core's space-centre
            // capture. If it read state this capture stashed, a dashboard watching
            // the roster but no rp1.* topic would skip the capture and go on
            // reporting retirees as fatalities: the gated-capture starvation shape
            // three channels have already shipped with.
            host.AddSampledSource(
                CaptureCrewOnMain,
                HandleCrewOnCourier,
                CrewTopic,
                CrewProgramTopic);

            // UNGATED, and the two captures above say why by contrast: their whole
            // effect is their return value, and this one's is not. It feeds the
            // economy backend, whose consumer is core's career.status, so gating
            // it on any rp1.* prefix would starve an operator watching the funding
            // panel and nothing else, silently and with no degraded mode. Gating
            // it on career.status would work and is not worth the coupling: the
            // capture throttles itself on RP-1's own inputs, so a tick where
            // nothing moved costs eight cached-MemberInfo reads.
            host.AddSampledSource(_upkeepQuery.CaptureOnMain, _upkeepQuery.HandleOnCourier);
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
            // The craft listing joins the walk HERE rather than in the reflection
            // reader, because it is core's rather than RP-1's and the reader holds
            // no Kernel. Main thread, which is where the catalogue's own contract
            // says it must be asked: it walks the save's craft folders and reads
            // part prefabs.
            raw.Buildable = Rp1Buildable.Rows(CraftListing(), raw.Complexes);
            return raw;
        }

        /// <summary>
        /// The save's craft files, or null when this install cannot open them.
        /// Fail-soft: a catalogue that throws costs the buildable preview and
        /// nothing else, because every other channel on this Uplink is RP-1's.
        /// </summary>
        private IReadOnlyList<CraftFileRecord>? CraftListing()
        {
            try
            {
                return Catalogue()?.Craft();
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Core's craft catalogue, elected through the Kernel, or null before
        /// registration and on an install whose core does not declare it.
        /// </summary>
        private ICraftCatalogue? Catalogue()
        {
            if (_kernel == null)
            {
                return null;
            }
            try
            {
                return _kernel.Query<ICraftCatalogue>(CraftCatalogueCapability.Id);
            }
            catch (Exception)
            {
                return null;
            }
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
            var constructions = Rp1ScCapture.BuildConstructions(raw);
            var research = Rp1ScCapture.BuildResearch(raw);
            var buildable = Rp1ScCapture.Buildable(raw);

            Rp1RowBudget.Record(
                centres.Count + complexes.Count + buildQueue.Count + warehouse.Count
                + pads.Count + operations.Count + constructions.Count + research.Count
                + buildable.Count,
                raw.Ut);

            _centres?.Publish(centres, raw.Ut);
            _complexes?.Publish(complexes, raw.Ut);
            _buildQueue?.Publish(buildQueue, raw.Ut);
            _warehouse?.Publish(warehouse, raw.Ut);
            _pads?.Publish(pads, raw.Ut);
            _operations?.Publish(operations, raw.Ut);
            _constructions?.Publish(constructions, raw.Ut);
            _research?.Publish(research, raw.Ut);
            _buildable?.Publish(buildable, raw.Ut);
            _personnel?.Publish(Rp1ScCapture.BuildPersonnel(raw), raw.Ut);
            _rushTerms?.Publish(Rp1ScCapture.BuildRushTerms(raw), raw.Ut);
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
            var curves = Rp1ProgramsCapture.BuildFundingCurves(raw);
            Rp1RowBudget.Record((rows?.Count ?? 0) + (curves?.Count ?? 0), raw?.Ut ?? 0.0);
            _programList?.Publish(rows, raw?.Ut ?? 0.0);
            _programSlots?.Publish(Rp1ProgramsCapture.BuildSlots(raw), raw?.Ut ?? 0.0);
            _programCurves?.Publish(curves, raw?.Ut ?? 0.0);
        }

        /// <summary>
        /// MAIN-THREAD capture of RP-1's crew schedule. On the main thread because
        /// it walks live scenario-module state; see
        /// <see cref="Rp1CrewReflection"/>'s header for the audit of every member
        /// it reads and the four it refuses to call.
        /// </summary>
        internal object? CaptureCrewOnMain(KspSnapshot? snapshot) =>
            _crew.IsAvailable ? _crew.Read(snapshot?.Ut ?? 0.0) : null;

        /// <summary>COURIER-THREAD handle: map to wire dicts and publish. No game API.</summary>
        internal void HandleCrewOnCourier(object? captured)
        {
            var raw = captured as Rp1CrewRaw;
            var rows = Rp1CrewCapture.BuildCrew(raw);
            Rp1RowBudget.Record(rows?.Count ?? 0, raw?.Ut ?? 0.0);
            _crewList?.Publish(rows, raw?.Ut ?? 0.0);
            _crewProgram?.Publish(Rp1CrewCapture.BuildProgram(raw), raw?.Ut ?? 0.0);
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
                new UplinkHealthFact("CrewHandler", _crew.IsAvailable ? "resolved" : "type not found"),
                new UplinkHealthFact("save mode", EnabledForSave ? "enabled" : "not enabled for this save"),
                new UplinkHealthFact("read against", "RP-1 v4.6.0.0"),
                new UplinkHealthFact(
                    "economy provider",
                    _economyRegistrationError != null
                        ? "registration failed: " + _economyRegistrationError
                        : _economy.IsAvailable ? "registered" : "maintenance types not found"),
                new UplinkHealthFact(
                    "confidence withholding",
                    _derivedCurrencyRegistrationError != null
                        ? "not registered: " + _derivedCurrencyRegistrationError
                        : !_confidenceWithhold.Available
                            ? "Confidence type not found"
                            : _confidenceWithhold.WithholdFailures == 0
                                ? "registered"
                                : _confidenceWithhold.WithholdFailures
                                  + " delayed credit(s) left their derived confidence credited: "
                                  + _confidenceWithhold.LastWithholdFailure),
                new UplinkHealthFact(
                    "launch rules",
                    _launchGateRegistrationError != null
                        ? "not contributed: " + _launchGateRegistrationError
                        : _launch.IsAvailable
                            ? "contributed to ksp.launch"
                            : "space centre types not found"),
                new UplinkHealthFact(
                    "career project rules",
                    _careerProjectGateRegistrationError != null
                        ? "not contributed: " + _careerProjectGateRegistrationError
                        : _careerProjects.IsAvailable
                            ? "contributed to career.facility.upgrade and career.tech.unlock"
                            : "space centre types not found"),
                new UplinkHealthFact(
                    "build commands",
                    _buildCommandRegistrationError != null
                        ? "not registered: " + _buildCommandRegistrationError
                        : _build.IsAvailable
                            ? "rp1.build.repeat registered"
                            : "build or currency types not found"),
                // The fact the first rig run could not get at. Four commands were
                // absent from the manifest with health 0 and no reason anywhere,
                // which is indistinguishable from their never having been
                // written. Says which commands are declared AND which invoked
                // members resolved, because those are different questions and the
                // second is the one that explains a refusal at the press.
                new UplinkHealthFact(
                    "vehicle commands",
                    !_vehicles.IsAvailable
                        ? "not registered: RP-1 space-centre types not found"
                        : (_vehicles.IsMoveAvailable
                            ? "rollout, rollback, scrap and complex rush registered"
                            : "scrap and complex rush registered; rollout and rollback withheld, "
                              + "ReconRolloutProject not resolved")
                          + " (" + _vehicles.MethodDiagnosis() + ")"),
                // Separate from the vehicle commands, because it is the one write
                // that can leave a career's build rates wrong without touching a
                // vehicle: a complex whose crew this command could not move
                // builds at whatever rate its old crew set.
                new UplinkHealthFact(
                    "staffing command",
                    !_staffing.IsAvailable
                        ? "not registered: RP-1 space-centre types not found"
                        : "rp1.personnel.assign registered (" + _staffing.MethodDiagnosis() + ")"),
                // Its own fact rather than a line on the build commands, and the
                // diagnosis matters more here than anywhere else on this list:
                // the one non-public member this Uplink reaches is the tech gate
                // behind it, on a Harmony patch class, and a rename there takes
                // the command out at the press with nothing else noticing.
                new UplinkHealthFact(
                    "facility upgrade command",
                    !_facilities.IsAvailable
                        ? "not registered: RP-1 facility-construction types not found"
                        : "rp1.facility.upgrade registered, space centre only ("
                          + _facilities.MethodDiagnosis() + ")"),
                new UplinkHealthFact(
                    "simulation provider",
                    _simulationRegistrationError != null
                        ? "registration failed: " + _simulationRegistrationError
                        : "registered"),
                // The live answer, because "is this a rehearsal" is the one
                // fact on this list an operator may need to check mid-flight
                // against a board that looks like a mission.
                new UplinkHealthFact(
                    "simulated flight",
                    _rp1.IsSimulatedFlight() switch
                    {
                        true => "yes",
                        false => "no",
                        _ => "cannot say",
                    }),
                // Named on the roster because a failure here is invisible in the
                // data: the roster keeps publishing, with stock's answer, and
                // stock's answer about an RP-1 retiree is "killed".
                new UplinkHealthFact(
                    "crew-standing provider",
                    _crewStandingRegistrationError != null
                        ? "registration failed: " + _crewStandingRegistrationError
                        : _crewStanding.IsAvailable ? "registered" : "CrewHandler type not found"),
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
