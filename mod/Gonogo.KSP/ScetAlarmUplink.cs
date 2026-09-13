using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
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
    /// <para><b>Two kinds of alarm, one roster class, run more than once.</b> An
    /// alarm naming no audience is the SCET one described above: judged against
    /// the simulation, and its stop is universal. An alarm naming a command
    /// centre is judged against what THAT PLACE HAS BEEN TOLD, through
    /// <see cref="RevealedScetStateReader"/> over the Courier's archive, and its
    /// verdict stops nothing. The only difference between the two is the SOURCE
    /// of the readings, which is why the same <see cref="ScetAlarmRoster"/> runs
    /// both: per-audience latching, and per-audience
    /// <see cref="ScetAlarmRoster.Clear"/> on a rewind, come out of holding one
    /// roster each rather than out of any new code.</para>
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
        /// One roster per AUDIENCE that is not the simulation, keyed by the
        /// vantage whose knowledge its alarms are judged against.
        ///
        /// <para>Separate rosters rather than one list with a field, because
        /// everything a roster latches is per-audience: a step-down, a sustain
        /// window, and above all <see cref="ScetAlarmRoster.Clear"/> on a
        /// rewind. Two audiences reading the same craft cross the same
        /// threshold at different instants, and a single roster would have to
        /// remember that once per audience anyway, which is this dictionary
        /// written out by hand.</para>
        ///
        /// <para>An entry is never removed once created, and that costs nothing:
        /// a roster holding no alarms asks the archive nothing, so it moves no
        /// cursor and pins no history. Removing one WOULD cost something, namely
        /// the disarm that emptied it, which is a roster change nobody would
        /// then publish.</para>
        /// </summary>
        private readonly Dictionary<string, ScetAlarmRoster> _commandRosters =
            new Dictionary<string, ScetAlarmRoster>(StringComparer.Ordinal);

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

        private readonly IVesselActuator _actuator;

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
            var condition = args.Condition;
            if (condition != null
                && condition.Kind == ScetAlarmConditionKind.Threshold
                && !_thresholds.Knows(condition.Topic))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "no SCET threshold can be read from '" + (condition.Topic ?? "") + "'");
            }

            lock (_gate)
            {
                var target = RosterFor(args.Audience ?? "");
                // An id belongs to exactly ONE audience. Re-arming it under a
                // different one MOVES it, so drop it from wherever it was before
                // handing it over; a Disarm for an id a roster does not hold
                // changes nothing and republishes nothing, so the ordinary
                // idempotent re-arm still costs no channel traffic.
                foreach (var roster in AllRosters())
                {
                    if (!ReferenceEquals(roster, target))
                    {
                        roster.Disarm(args.Id);
                    }
                }
                target.Arm(args, vantage ?? "");
            }
            return new CommandResult { Success = true };
        }

        /// <summary>
        /// The roster an alarm with this audience belongs to: the simulation's
        /// for the empty audience, and one of its own for any named vantage,
        /// created on first use.
        /// </summary>
        private ScetAlarmRoster RosterFor(string audience)
        {
            if (audience.Length == 0)
            {
                return _roster;
            }
            if (!_commandRosters.TryGetValue(audience, out var roster))
            {
                roster = new ScetAlarmRoster();
                _commandRosters[audience] = roster;
            }
            return roster;
        }

        /// <summary>Every roster held, simulation first. Caller holds <see cref="_gate"/>.</summary>
        private IEnumerable<ScetAlarmRoster> AllRosters()
        {
            yield return _roster;
            foreach (var entry in _commandRosters)
            {
                yield return entry.Value;
            }
        }

        /// <summary>
        /// The roster as the channel publishes it: every audience's rows in one
        /// list, because the client reconciles ONE list against it and a row
        /// missing from the roster reads as an arm the host never received.
        /// Which audience a row belongs to is on the row. Caller holds
        /// <see cref="_gate"/>.
        /// </summary>
        private List<ScetAlarm> SnapshotAll()
        {
            var rows = _roster.Snapshot();
            foreach (var entry in _commandRosters)
            {
                rows.AddRange(entry.Value.Snapshot());
            }
            return rows;
        }

        private CommandResult HandleDisarm(ScetAlarmDisarmArgs? args)
        {
            if (args == null || string.IsNullOrEmpty(args.Id))
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a SCET disarm needs the alarm's id");
            }
            lock (_gate)
            {
                // Every roster, because a disarm names an id and nothing else:
                // the client that sent it need not know, and must not have to
                // know, which audience the host filed it under.
                foreach (var roster in AllRosters())
                {
                    roster.Disarm(args.Id);
                }
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
                ScetAlarmTick tick;
                lock (_gate)
                {
                    tick = _roster.Evaluate(ut, state);
                }

                if (tick.StopWarp)
                {
                    WarpStopBudget.Record(1, ut);
                    _actuator.SetWarp(0);
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
                    RosterChanged = tick.RosterChanged,
                    Fired = tick.Fired,
                };
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] SCET alarm evaluation failed: " + ex);
                return null;
            }
        }

        /// <summary>
        /// COURIER-THREAD half: evaluate every AUDIENCE roster, then publish.
        /// Touches no KSP API.
        ///
        /// <para>The audience evaluation is here rather than in the capture
        /// because the archive it reads is the Courier's own state and nothing
        /// guards it (see <c>ChannelEngine.ReadTopicAtVantage</c>). The
        /// simulation roster stays in the capture for the opposite reason: it
        /// reads the tick's snapshot and commands the warp, and both belong on
        /// the main thread.</para>
        ///
        /// <para><b>An audience verdict stops nothing.</b> Its tick's
        /// <see cref="ScetAlarmTick.StopWarp"/> is read and discarded, on
        /// purpose and not by omission: warp is a property of the simulation,
        /// and what one command centre has been told is not a fact about the
        /// simulation. Halting the game because a light-time-old reading crossed
        /// a number would stop it for an event that already happened, for
        /// everybody, on one vantage's say-so.</para>
        /// </summary>
        private void HandleOnCourier(object? captured)
        {
            if (captured is not ScetAlarmPublish publish)
            {
                return;
            }
            try
            {
                var changed = publish.RosterChanged;
                var fired = publish.Fired;
                List<ScetAlarm>? roster = null;
                lock (_gate)
                {
                    var read = _revealedRead;
                    foreach (var entry in _commandRosters)
                    {
                        var state = read == null
                            ? null
                            : new RevealedScetStateReader(read, entry.Key, publish.Ut);
                        var tick = entry.Value.Evaluate(publish.Ut, state);
                        // tick.StopWarp deliberately unread: see the doc comment.
                        changed |= tick.RosterChanged;
                        fired.AddRange(tick.Fired);
                    }

                    if (_audience.ShouldPublish(publish.HasAudience, changed))
                    {
                        roster = SnapshotAll();
                    }
                }

                if (roster != null)
                {
                    _rosterPublisher?.Publish(roster, publish.Ut);
                }
                foreach (var notice in fired)
                {
                    _firedPublisher?.Publish(notice, publish.Ut);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] SCET alarm publish failed: " + ex);
            }
        }

        /// <summary>What crosses from the main thread to the Courier: plain data, no live KSP references.</summary>
        private sealed class ScetAlarmPublish
        {
            public double Ut;

            /// <summary>Whether anything was subscribed to the roster topic when the capture ran.</summary>
            public bool HasAudience;

            /// <summary>Whether the SIMULATION roster moved. Each audience roster answers for itself in the handle.</summary>
            public bool RosterChanged;

            /// <summary>The simulation's notices. The handle appends each audience's to this same list.</summary>
            public List<ScetAlarmFired> Fired = new List<ScetAlarmFired>();
        }
    }
}
