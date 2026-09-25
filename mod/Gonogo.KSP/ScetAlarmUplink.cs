using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.ActionGroups;
using Sitrep.Host.Alarms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The SCET alarm arm: alarms an operator sets against the craft's OWN
    /// clock, evaluated here rather than on the client, and stopping the game's
    /// warp when they come due.
    ///
    /// <para><b>Why this is core and not an Uplink-shaped concern.</b> Stopping
    /// warp means <see cref="IVesselActuator.SetWarp"/>, which lives in
    /// <c>Sitrep.Host</c>, an assembly no Uplink may reference. An Uplink could
    /// declare its own warp interface in the contract and resolve it through the
    /// kernel, which is the sanctioned escape hatch and the right move for a
    /// genuinely third-party need; it is the wrong one here, because the alarm
    /// list is app-wide and a SCET arm that lived in an optional assembly would
    /// make a core delay feature depend on that assembly being installed.</para>
    ///
    /// <para><b>Why a separate uplink rather than a fold into
    /// <see cref="VesselUplink"/>.</b> Fail-soft is per-uplink: an alarm
    /// evaluator that throws should not take twenty <c>vessel.*</c> channels
    /// inert with it, and that uplink's manifest is already the largest in the
    /// tree.</para>
    ///
    /// <para>The evaluation runs in an UNGATED sampled source. It must: the
    /// gated overload skips the capture entirely on a tick where nothing is
    /// subscribed, and this capture's whole effect is stopping the warp, not its
    /// return value. A SCET alarm that only worked while somebody was watching
    /// its roster would be exactly the feature it is not. The same argument is
    /// why a THRESHOLD's reading is taken here, off the snapshot, rather than
    /// tapped off the values the channel loop emits: that loop skips any Topic
    /// nothing is subscribed to, so a threshold read through it would fire or
    /// not depending on which widgets the operator happened to have open.</para>
    ///
    /// <para>An AUDIENCE threshold cannot read the snapshot, because the whole
    /// question is what one place has been TOLD, and that lives in the archive.
    /// It meets the same hole one layer down, since the archive records only
    /// what something is subscribed to. So every armed threshold's Topic is
    /// held on the record by a standing subscription of its own
    /// (<see cref="ScetAlarmSubscriptions"/>), and the dashboard stops being
    /// part of the answer.</para>
    ///
    /// <para><b>One roster, one tick, a pass per place its alarms read.</b> An
    /// alarm at its subject's own vantage is judged against the simulation,
    /// through <see cref="SnapshotScetStateReader"/> on this tick's snapshot, and
    /// its stop is universal. An alarm at a command centre is judged against what
    /// THAT PLACE HAS BEEN TOLD, through <see cref="RevealedScetStateReader"/>
    /// over the Courier's archive, and its verdict stops nothing. The only
    /// difference between the two is where the reading comes FROM, which is why
    /// one <see cref="ScetAlarmRoster"/> holds both: everything an alarm latches
    /// is already per-entry, and the two things that are genuinely per-tick, the
    /// rewind clear and the off-tick change flag, happen once in
    /// <see cref="ScetAlarmRoster.BeginTick"/>.</para>
    ///
    /// <para><b>The audience verdict is SHADOW.</b> It goes on the same two
    /// channels as the simulation's, tagged with the audience it belongs to, and
    /// nothing in the game or the client latches from it yet: the client still
    /// evaluates its own command-vantage alarms and compares. Running both
    /// evaluators live against one latch field is unsafe in the exact way the
    /// client's own <c>AlarmStateMachine.updateThresholdTracking</c> comment
    /// describes.</para>
    ///
    /// <para>The decision-making is in <see cref="ScetAlarmRoster"/> (what is
    /// due) and <see cref="ScetRosterAudience"/> (when the roster goes on the
    /// wire), both KSP-free and clock-free and unit-tested headlessly. This
    /// class is the live read, the actuator call and the publishes.</para>
    /// </summary>
    [SitrepUplink("alarm")]
    public sealed class ScetAlarmUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        /// <summary>The roster of armed SCET alarms.</summary>
        public const string RosterTopic = "alarm.scet";

        /// <summary>The notice that one of them fired and the warp was stopped.</summary>
        public const string FiredTopic = "alarm.scet.fired";

        public const string ArmCommand = "alarm.scet.arm";
        public const string DisarmCommand = "alarm.scet.disarm";

        /// <summary>
        /// Soft cap on warp STOPS, which is the thing worth budgeting rather
        /// than the evaluation rate: evaluating costs a comparison per armed
        /// alarm, and commanding the game's warp to zero costs a scene-affecting
        /// call. A condition that chattered would issue one every tick. The
        /// roster latches each alarm's stop, so a breach here means either an
        /// operator with a great many alarms coming due together or a latch that
        /// has stopped latching.
        /// </summary>
        private static readonly PerfBudget WarpStopBudget = new PerfBudget(
            "ScetAlarmUplink warp stops", threshold: 5, windowSec: 10.0, unit: "stops");

        /// <summary>
        /// Guards <see cref="_roster"/>. The capture runs on the Unity main
        /// thread and the command handlers are dispatched off the Courier, and
        /// while the engine is built to marshal command handlers back to the main
        /// thread, the roster is not worth making that fact load-bearing for: the
        /// lock is held for a list walk over a handful of entries.
        /// </summary>
        private readonly object _gate = new object();

        private readonly ScetAlarmRoster _roster = new ScetAlarmRoster();

        /// <summary>
        /// How to read what a vantage has been told, or null on an install where
        /// nothing wired it (every headless test that builds this uplink
        /// directly). Null is not an error: an audience roster with no reader
        /// evaluates every threshold as unreadable, and an alarm that cannot be
        /// read does not fire, which is the same posture the snapshot reader
        /// takes for a tick with no snapshot.
        ///
        /// <para>Static for the same reason
        /// <c>CommsCoreUplink.ConfigureSignalDelay</c> is: this uplink is found
        /// by assembly-scan discovery and constructed by the engine, so nothing
        /// outside holds the instance to configure. The read itself goes through
        /// <c>ChannelEngine.ReadTopicAtVantage</c>, which is COURIER-THREAD
        /// ONLY, which is why the audience evaluation lives in the handle and
        /// not in the capture.</para>
        /// </summary>
        private static Func<string, string, double, object?>? _revealedRead;

        /// <summary>
        /// Point the audience evaluation at an engine's archive; pass null to
        /// take it away again, which a test doing so must, because this outlives
        /// any one engine.
        /// </summary>
        public static void ConfigureRevealedRead(Func<string, string, double, object?>? read) =>
            _revealedRead = read;

        /// <summary>
        /// How to keep a Topic on the record while an alarm needs it, or null on
        /// an install where nothing wired it. Null costs the audience rosters
        /// their readings on any Topic no widget happens to be showing, which is
        /// the state this whole seam exists to leave behind.
        ///
        /// <para>Static, late-bound and taken away at shutdown, for the same
        /// reasons <see cref="_revealedRead"/> is: the engine does not exist when
        /// this uplink is constructed, and nothing outside holds the instance.
        /// Both calls are safe from any thread; the engine queues them onto the
        /// Courier itself.</para>
        /// </summary>
        private static Action<string, string>? _openStanding;
        private static Action<string, string>? _closeStanding;

        /// <summary>
        /// Point the standing subscriptions at an engine; pass nulls to take it
        /// away again, which a test doing so must, because this outlives any one
        /// engine.
        /// </summary>
        public static void ConfigureStandingSubscriptions(
            Action<string, string>? open, Action<string, string>? close)
        {
            _openStanding = open;
            _closeStanding = close;
        }

        /// <summary>
        /// Whether a vantage names an active command centre, null while the
        /// simulation knows of none, or null throughout on an install where
        /// nothing wired it. An unwired install arms whatever it is asked to,
        /// which is the behaviour every headless test that builds this uplink
        /// directly already has.
        ///
        /// <para>Static and late-bound for the same reasons
        /// <see cref="_revealedRead"/> is, and reachable from no other route:
        /// the engine's own predicate is private to it, and a
        /// selectable-vantage question is not an Uplink author surface.</para>
        /// </summary>
        private static Func<string, bool?>? _selectableVantage;

        /// <summary>
        /// Point the arm's vantage check at an engine; pass null to take it away
        /// again, which a test doing so must, because this outlives any one
        /// engine.
        /// </summary>
        public static void ConfigureSelectableVantage(Func<string, bool?>? selectable) =>
            _selectableVantage = selectable;

        /// <summary>
        /// How the handle reaches the Unity main thread, or null on an install
        /// where nothing wired it. See <see cref="StopWarpFromHandle"/>.
        /// </summary>
        private static Action<Action>? _runOnMainThread;

        /// <summary>
        /// Point the handle's warp stop at an engine's main-thread pump; pass
        /// null to take it away again, which a test doing so must, because this
        /// outlives any one engine.
        /// </summary>
        public static void ConfigureMainThreadRunner(Action<Action>? run) =>
            _runOnMainThread = run;

        private readonly IVesselActuator _actuator;

        /// <summary>The elected action-groups backend, resolved per call. Null until <see cref="Register"/>.</summary>
        private Func<IActionGroupsBackend?>? _actionGroups;

        private IUplinkHost? _host;

        /// <summary>
        /// What a threshold may be armed against: core's table plus whatever the
        /// Kernel's <c>scetThresholdSources</c> providers contribute.
        ///
        /// <para>Bound at Register, which is before capability resolution, and
        /// that is fine: it holds the Kernel rather than a merged copy of the
        /// answer, and asks it at each use. Core-only until then, which is what
        /// it should be, since nothing can have armed anything yet.</para>
        /// </summary>
        private ScetThresholdSources _thresholds = ScetThresholdSources.CoreOnly;

        private IChannelPublisher? _rosterPublisher;
        private IChannelPublisher? _firedPublisher;

        /// <summary>
        /// When the roster goes on the wire. Its whole job is that a client
        /// subscribing to an EMPTY roster is told it is empty, rather than left
        /// on "subscribed" with nothing to reconcile against, which is what
        /// stopped a cold client arming anything at all.
        /// </summary>
        private readonly ScetRosterAudience _audience = new ScetRosterAudience();

        /// <summary>
        /// Which Topics the armed thresholds need kept on the record. Guarded by
        /// <see cref="_gate"/>, and asked only when the roster moved: a
        /// reconciliation against an unchanged roster answers nothing.
        /// </summary>
        private readonly ScetAlarmSubscriptions _subscriptions = new ScetAlarmSubscriptions(
            (topic, holder) => _openStanding?.Invoke(topic, holder),
            (topic, holder) => _closeStanding?.Invoke(topic, holder));

        /// <summary>
        /// The discovery-required parameterless constructor: a discoverable
        /// uplink resolves its own dependencies rather than taking them as
        /// discovery-time arguments. Same shape, and the same shared maneuver-node
        /// id registry, as <see cref="VesselUplink()"/>.
        /// </summary>
        public ScetAlarmUplink()
            : this(new KspVesselActuator(GonogoAddon.SharedManeuverNodeIdRegistry))
        {
        }

        public ScetAlarmUplink(IVesselActuator actuator) => _actuator = actuator;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "alarm",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = RosterTopic,
                    // ReliableOrdered, not LossyLatest: reconciling a client's own
                    // list against the roster is the only thing that clears an arm
                    // nobody remembers making, so no roster frame may be coalesced
                    // away. What gets a RECONNECTING client its first frame is the
                    // audience check on the publish (see ScetRosterAudience), not
                    // this: keyframe-on-subscribe can only replay a value that has
                    // already been emitted at least once.
                    Delivery = Delivery.ReliableOrdered,
                    // Ground-side bookkeeping: a list of things the operator asked
                    // for, not a reading of any craft. The same class
                    // commandCentre.roster sits in.
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = FiredTopic,
                    // A one-shot event, and the same replay argument CrashUplink
                    // makes: a client that reconnects a second after the fire must
                    // still learn why its warp stopped.
                    Delivery = Delivery.ReliableOrdered,
                    // THE leak, and the only one. The operator accepted seeing
                    // their alarm fire while the readings beside it still show the
                    // craft a light-time ago; a delayed notice would instead halt
                    // the warp and say nothing at all for minutes. The payload
                    // carries the alarm's id and the instant and nothing about the
                    // craft: see ScetAlarmFired.
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                },
            },
            Commands = new List<CommandDeclaration>
            {
                // Both INSTANT, declared on their args types in the contract
                // (see SitrepCommandAttribute.Delay) because that is what the
                // client reads too. Arming registers an intention with the
                // simulation host and changes nothing aboard the craft, so there
                // is no light-time fiction to honour: the same bucket
                // time.setWarpIndex has always been in. Delayed, an alarm for an
                // event less than one light-time away could never be armed in
                // time, and the command would be dropped outright during a
                // blackout, which is when a SCET alarm is worth the most.
                new CommandDeclaration { Command = ArmCommand },
                new CommandDeclaration { Command = DisarmCommand },
            },
        };

        /// <summary>Mandatory health self-report: a plain channel-and-command uplink is healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        /// <summary>
        /// Declares <c>scetThresholdSources</c>, the seam an installed mod adds
        /// its own threshold Topics through.
        ///
        /// <para>Owned by THIS uplink because it owns the arm that refuses a
        /// Topic and the capture that reads one. Declared rather than left to
        /// whoever registers first: a provider's <c>RegisterProvider</c> throws
        /// against a capability that does not exist yet, and assembly-scan
        /// discovery fixes no order between uplinks, so the declaration has to
        /// happen in the pre-Register pass that runs for every uplink before any
        /// of them registers anything.</para>
        ///
        /// <para>Shared, so every installed mod with a quantity worth stopping a
        /// warp for is asked. No vanilla: a stock install contributes nothing and
        /// core's own Topics are the table in <see cref="ScetThresholdSources"/>
        /// rather than a provider.</para>
        /// </summary>
        public void DeclareCapabilities(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = ScetThresholdCapability.Id,
                Exclusive = false,
                SpineCritical = false,
            });
        }

        public void Register(IUplinkHost host)
        {
            _host = host;
            _thresholds = new ScetThresholdSources(host.Kernel);

            // The same elected backend the vessel uplink's actuator writes
            // through, so an alarm's custom group means the group a button of
            // the same index would press. Resolved per call: the election runs
            // after every uplink has registered.
            var kernel = host.Kernel;
            _actionGroups = () => ActionGroupsElection.Elected(kernel);
            (_actuator as KspVesselActuator)?.SetActionGroupsBackendSource(_actionGroups);
            _rosterPublisher = host.Publisher(RosterTopic);
            _firedPublisher = host.Publisher(FiredTopic);

            // Vantage-resolved, so the roster records WHERE an alarm was armed
            // from rather than where a payload claimed it was: a client that
            // named its own vantage in its arguments could name another one.
            // Provenance only, because a SCET stop is universal.
            host.AddVantageCommandHandler<ScetAlarmArmArgs, CommandResult>(
                ArmCommand, (args, vantage) => HandleArm(args, vantage));
            host.AddVantageCommandHandler<ScetAlarmDisarmArgs, CommandResult>(
                DisarmCommand, (args, _) => HandleDisarm(args));

            // UNGATED, deliberately. See the class comment: the capture's effect
            // is the warp stop, and a gate that skipped it while nobody watched
            // would silently unmake the feature.
            host.AddSampledSource(CaptureOnMain, HandleOnCourier);
        }

        private CommandResult HandleArm(ScetAlarmArmArgs? args, string vantage)
        {
            if (args == null || string.IsNullOrEmpty(args.Id))
            {
                // The id is the client's own handle and the only thing a disarm
                // can name, so an arm without one is an alarm nobody could ever
                // cancel. Refused rather than assigned one here.
                return CommandResult.Fail(CommandErrorCode.Range, "a SCET alarm needs the client's own id");
            }

            // A threshold against a Topic the simulation cannot resolve is
            // REFUSED rather than accepted, because the alternative is an alarm
            // that sits armed and never fires, and an operator has no way to tell
            // that apart from one whose condition simply has not come due. See
            // ScetThresholdSources for what is addressable and why the set is a
            // written-down table rather than everything on the wire.
            // A vantage no command centre corresponds to is refused for the same
            // reason, and it is the one the operator can most easily get wrong:
            // the field is theirs to fill, so a stale one from another save names
            // a place this one has never heard of.
            //
            // Asked once, here, and never again. A crewed centre stops being one
            // the moment its crew leaves, and re-asking on a later tick would kill
            // a standing alarm for a reason the operator never acted on.
            var wanted = ScetAlarmVantage.Of(args);
            switch (ScetAlarmVantage.VerdictFor(
                wanted, ScetAlarmVantage.SubjectOf(args), _selectableVantage?.Invoke(wanted)))
            {
                case ScetVantageVerdict.NoSuchPlace:
                    return CommandResult.Fail(
                        CommandErrorCode.Range, "'" + wanted + "' is not an active command centre");
                case ScetVantageVerdict.NoPlacesKnown:
                    // A different refusal, because it is a different claim: the
                    // simulation has not been told what places exist, which is
                    // what the main menu and the ticks before the first capture
                    // look like. Saying "no such place" there would state
                    // something nothing has established.
                    //
                    // NotClearToProceed rather than Range, on the axis the enum
                    // already divides: this one resolves by waiting and the one
                    // above it does not. Sharing a code with NoSuchPlace left
                    // the two separable only by their prose, which is what a
                    // typed code exists to avoid, and left a client unable to
                    // tell a refusal worth retrying from one that is final.
                    return CommandResult.Fail(
                        CommandErrorCode.NotClearToProceed,
                        "no command centre is known yet, so '" + wanted + "' cannot be checked");
            }

            var condition = args.Condition;
            if (condition != null
                && condition.Kind == ScetAlarmConditionKind.Threshold
                && !_thresholds.Knows(condition.Topic))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "no SCET threshold can be read from '" + (condition.Topic ?? "") + "'");
            }

            if (condition != null
                && condition.Kind == ScetAlarmConditionKind.ContractParameter
                && (string.IsNullOrEmpty(condition.ContractId) || string.IsNullOrEmpty(condition.ParameterTitle)))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range, "a contract-parameter alarm names a contract and one of its objectives");
            }

            var actionRefusal = ScetAlarmActions.RefusalFor(args);
            if (actionRefusal != null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, actionRefusal);
            }

            lock (_gate)
            {
                var subject = ScetAlarmVantage.SubjectOf(args);
                if (_roster.NamesAnotherCraft(subject))
                {
                    // Alarms belong to the craft being flown. Accepted, this one
                    // would be cancelled by the next switch back or fire for a
                    // craft nobody is flying.
                    return CommandResult.Fail(
                        CommandErrorCode.Range,
                        "alarms watch only the craft being flown, and '" + subject + "' is not it");
                }

                // An id belongs to exactly one alarm whatever vantage it names,
                // so a re-arm that moves the vantage REPLACES in place. What
                // used to need dropping the id from every other roster first is
                // now what holding one roster means.
                _roster.Arm(args, vantage ?? "");
            }
            return new CommandResult { Success = true };
        }

        private CommandResult HandleDisarm(ScetAlarmDisarmArgs? args)
        {
            if (args == null || string.IsNullOrEmpty(args.Id))
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a SCET disarm needs the alarm's id");
            }
            lock (_gate)
            {
                _roster.Disarm(args.Id);
            }
            // Succeeds for an id the host does not hold: a client reconciling its
            // list against the roster disarms what it does not recognise, and
            // "already gone" is the outcome it wanted.
            return new CommandResult { Success = true };
        }

        /// <summary>
        /// MAIN-THREAD capture: advance the roster to the game's own universal
        /// time and readings, stop the warp if anything is due, and hand the
        /// publishes across to the Courier as plain data.
        ///
        /// <para>The UT and the readings taken here are the game's, upstream of
        /// the reveal gate, which is what makes a SCET alarm a SCET alarm. The
        /// actuator call is here too and not on the Courier: the evaluation and
        /// the stop land in the same frame rather than a thread hop apart.</para>
        ///
        /// <para>The reader is built per tick and discarded with it. It caches
        /// only within the tick, so several alarms on one Topic cost one payload
        /// build, and holding it across ticks would make a SCET threshold
        /// compare against a stale reading, which is the whole failure this arm
        /// exists to avoid.</para>
        /// </summary>
        private object? CaptureOnMain(KspSnapshot? snapshot)
        {
            try
            {
                var ut = snapshot?.Ut ?? Planetarium.GetUniversalTime();
                var state = new SnapshotScetStateReader(snapshot, _thresholds);
                // Asked on the capture, not in the handle, so the answer goes
                // across with the tick that decided it. The read is a walk of a
                // thread-safe mirror and is callable from here; see
                // IUplinkHost.IsAnyTopicSubscribed.
                var hasAudience = _host?.IsAnyTopicSubscribed(RosterTopic) ?? false;
                ScetAlarmTickState tick;
                bool stopWarp;
                List<ScetAlarmActionsDue> actionsDue;
                var flown = ActiveVesselScope.Current;
                lock (_gate)
                {
                    _roster.ObserveFlownCraft(flown != null ? "vessel:" + flown.id : null);
                    tick = _roster.BeginTick(ut);
                    _roster.EvaluatePass(tick, ScetAlarmVantage.IsTheSubjectsOwn, _ => state);
                    stopWarp = tick.StopWarp;
                    actionsDue = new List<ScetAlarmActionsDue>(tick.ActionsDue);
                }

                if (stopWarp)
                {
                    WarpStopBudget.Record(1, ut);
                    _actuator.SetWarp(0);
                }

                // In the same frame as the stop, before the notices leave: this is
                // the flight computer acting, and a withheld action has to be on
                // its notice before anyone is told the alarm fired.
                if (actionsDue.Count > 0)
                {
                    RunActions(actionsDue);
                }

                // ALWAYS returned, even with nothing to say. The handle owns
                // ScetRosterAudience now, and that class has to be told about a
                // tick where nobody is subscribed: it is how it learns to answer
                // the NEXT subscriber. A capture that returned null on a quiet
                // tick would skip the handle and leave a reconnecting client
                // waiting on a roster frame that never comes, which is the exact
                // failure that class was written for.
                return new ScetAlarmPublish
                {
                    Ut = ut,
                    HasAudience = hasAudience,
                    Tick = tick,
                    StoppedOnCapture = stopWarp,
                };
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] SCET alarm evaluation failed: " + ex);
                return null;
            }
        }

        /// <summary>
        /// COURIER-THREAD half: take the pass over every alarm that reads
        /// somewhere other than its own subject, close the tick, then publish.
        /// Touches no KSP API.
        ///
        /// <para>That pass is here rather than in the capture because the archive
        /// it reads is the Courier's own state and nothing guards it (see
        /// <c>ChannelEngine.ReadTopicAtVantage</c>). The subject-vantage pass
        /// stays in the capture for the opposite reason: it reads the tick's
        /// snapshot, and a snapshot is a main-thread thing.</para>
        ///
        /// <para><b>Every alarm stops the warp, wherever it is read.</b> The
        /// vantage decides WHEN, never WHETHER: an alarm at a command centre
        /// comes due when that place learns of the match, and the game halts on
        /// that tick. The reading stays where it was, so nothing about the craft
        /// travels early; what crosses is a stop, and a stop is not a
        /// reading.</para>
        ///
        /// <para>The stop this pass decides is issued from HERE rather than
        /// handed to the next capture, through
        /// <see cref="StopWarpFromHandle"/>. A capture away is one snapshot
        /// cadence, and under warp that is thousands of seconds of the very
        /// precision the alarm was armed for.</para>
        /// </summary>
        private void HandleOnCourier(object? captured)
        {
            if (captured is not ScetAlarmPublish publish || publish.Tick == null)
            {
                return;
            }
            try
            {
                ScetAlarmTick tick;
                List<ScetAlarm>? roster = null;
                lock (_gate)
                {
                    var read = _revealedRead;
                    var readers = new Dictionary<string, IScetStateReader?>(StringComparer.Ordinal);
                    _roster.EvaluatePass(
                        publish.Tick,
                        alarm => !ScetAlarmVantage.IsTheSubjectsOwn(alarm),
                        alarm => ReaderAt(ScetAlarmVantage.Of(alarm), read, publish.Ut, readers));
                    tick = _roster.EndTick(publish.Tick);

                    var publishing = _audience.ShouldPublish(publish.HasAudience, tick.RosterChanged);
                    if (tick.RosterChanged || publishing)
                    {
                        var rows = _roster.Snapshot();
                        if (tick.RosterChanged)
                        {
                            // Here rather than in the arm and disarm handlers,
                            // because this is the one place that also sees the
                            // changes no handler makes: the rewind clear, and an
                            // alarm going Unreachable.
                            _subscriptions.Reconcile(rows);
                        }
                        roster = publishing ? rows : null;
                    }
                }

                // The stop for whatever this pass decided, and ONLY this pass:
                // the capture already acted on its own and the tick carries one
                // flag for both, so re-reading it here without the subtraction
                // would command the warp twice for one alarm.
                if (tick.StopWarp && !publish.StoppedOnCapture)
                {
                    StopWarpFromHandle(publish.Ut);
                }

                if (roster != null)
                {
                    _rosterPublisher?.Publish(roster, publish.Ut);
                }
                foreach (var notice in tick.Fired)
                {
                    _firedPublisher?.Publish(notice, publish.Ut);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] SCET alarm publish failed: " + ex);
            }
        }

        /// <summary>
        /// Run the onboard actions this tick's fires queued, on the main thread.
        /// A craft that refuses one is logged here and shows in its own telemetry
        /// a light-time later; the notice says only whether the actions were
        /// withheld for want of the right craft.
        /// </summary>
        private void RunActions(List<ScetAlarmActionsDue> actionsDue)
        {
            var vessel = ActiveVesselScope.Current;
            var flying = vessel != null ? "vessel:" + vessel.id : null;
            foreach (var due in actionsDue)
            {
                var results = ScetAlarmActions.Run(due, flying, _actuator, EngagedNow);
                if (due.Notice.ActionsWithheld)
                {
                    Debug.LogWarning("[Gonogo] SCET alarm " + due.Notice.Id
                        + " withheld its actions: they act on " + due.ActsOn + ", not " + (flying ?? "no craft"));
                }
                for (var i = 0; i < results.Count; i++)
                {
                    if (!results[i].Success)
                    {
                        Debug.LogWarning("[Gonogo] SCET alarm " + due.Notice.Id + " action "
                            + due.Actions[i].Kind + " refused: " + results[i].ErrorCode + " " + results[i].Detail);
                    }
                }
            }
        }

        /// <summary>
        /// The state a toggle flips from, read off the craft being flown at the
        /// moment of the fire. A custom group is asked of the elected backend,
        /// which is what numbers it; null wherever the craft cannot say.
        /// </summary>
        private bool? EngagedNow(ScetAlarmAction action)
        {
            var groups = ActiveVesselScope.Current?.ActionGroups;
            if (groups == null)
            {
                return null;
            }
            switch (action.Kind)
            {
                case ScetAlarmActionKind.Sas: return groups[KSPActionGroup.SAS];
                case ScetAlarmActionKind.Rcs: return groups[KSPActionGroup.RCS];
                case ScetAlarmActionKind.Lights: return groups[KSPActionGroup.Light];
                case ScetAlarmActionKind.Gear: return groups[KSPActionGroup.Gear];
                case ScetAlarmActionKind.Brakes: return groups[KSPActionGroup.Brakes];
                case ScetAlarmActionKind.Abort: return groups[KSPActionGroup.Abort];
                case ScetAlarmActionKind.ActionGroup:
                    var reported = _actionGroups?.Invoke()?.Groups();
                    if (reported == null)
                    {
                        return null;
                    }
                    foreach (var g in reported)
                    {
                        if (g.Index == action.Group)
                        {
                            return g.State;
                        }
                    }
                    return null;
                default:
                    return null;
            }
        }

        /// <summary>
        /// Stop the warp for an alarm the HANDLE decided, from the Courier.
        ///
        /// <para>Marshalled and WAITED ON rather than left for the next capture.
        /// <c>TimeWarp.SetRate</c> is legal only on the Unity main thread, and
        /// deferring to the next capture would cost one snapshot cadence, which
        /// under warp is thousands of seconds of game time: the precision the
        /// whole arm exists to buy. Parking the Courier for one frame is the
        /// cheaper side of that.</para>
        ///
        /// <para>An install with nothing wired stops nothing, which is the same
        /// posture the revealed read and the vantage check take: every headless
        /// test that builds this uplink directly has no engine to marshal
        /// through.</para>
        /// </summary>
        private void StopWarpFromHandle(double ut)
        {
            var run = _runOnMainThread;
            if (run == null)
            {
                return;
            }
            WarpStopBudget.Record(1, ut);
            run(() => _actuator.SetWarp(0));
        }

        /// <summary>
        /// One reader per distinct vantage per tick, so several alarms watching
        /// one place cost one archive read each Topic rather than one each.
        /// </summary>
        private static IScetStateReader? ReaderAt(
            string vantage,
            Func<string, string, double, object?>? read,
            double nowUt,
            Dictionary<string, IScetStateReader?> readers)
        {
            if (read == null)
            {
                return null;
            }
            if (!readers.TryGetValue(vantage, out var reader))
            {
                reader = new RevealedScetStateReader(read, vantage, nowUt);
                readers[vantage] = reader;
            }
            return reader;
        }

        /// <summary>What crosses from the main thread to the Courier: plain data, no live KSP references.</summary>
        private sealed class ScetAlarmPublish
        {
            public double Ut;

            /// <summary>Whether anything was subscribed to the roster topic when the capture ran.</summary>
            public bool HasAudience;

            /// <summary>
            /// The tick the capture opened and took its own pass over. The handle
            /// takes the rest of the passes on this same state, so both halves
            /// evaluate against one universal time and one rewind decision.
            /// </summary>
            public ScetAlarmTickState? Tick;

            /// <summary>
            /// Whether the capture already commanded the stop for its own pass.
            /// The tick carries ONE flag for every pass, so without this the
            /// handle cannot tell an alarm it decided itself from one the capture
            /// has already acted on, and one alarm would stop the warp twice.
            /// </summary>
            public bool StoppedOnCapture;
        }
    }
}
