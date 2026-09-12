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
    /// <para>The decision-making is in <see cref="ScetAlarmRoster"/> (what is
    /// due) and <see cref="ScetRosterAudience"/> (when the roster goes on the
    /// wire), both KSP-free and clock-free and unit-tested headlessly. This
    /// class is the live read, the actuator call and the publishes.</para>
    /// </summary>
    [SitrepUplink("alarm")]
    public sealed class ScetAlarmUplink : ISitrepUplink
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
        private readonly IVesselActuator _actuator;

        private IUplinkHost? _host;
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
                // Both INSTANT. Arming registers an intention with the simulation
                // host and changes nothing aboard the craft, so there is no
                // light-time fiction to honour: the same bucket time.setWarpIndex
                // has always been in. Delayed, an alarm for an event less than one
                // light-time away could never be armed in time, and the command
                // would be dropped outright during a blackout, which is when a SCET
                // alarm is worth the most.
                new CommandDeclaration { Command = ArmCommand, Delayed = false },
                new CommandDeclaration { Command = DisarmCommand, Delayed = false },
            },
        };

        /// <summary>Mandatory health self-report: a plain channel-and-command uplink is healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _host = host;
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
                && !ScetThresholdSources.Knows(condition.Topic))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "no SCET threshold can be read from '" + (condition.Topic ?? "") + "'");
            }

            lock (_gate)
            {
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
            ScetAlarmTick tick;
            List<ScetAlarm>? roster = null;
            try
            {
                var ut = snapshot?.Ut ?? Planetarium.GetUniversalTime();
                var state = new SnapshotScetStateReader(snapshot);
                // Asked on the capture, not in the handle, so the snapshot goes
                // across with the tick that decided it. The read is a walk of a
                // thread-safe mirror and is callable from here; see
                // IUplinkHost.IsAnyTopicSubscribed.
                var hasAudience = _host?.IsAnyTopicSubscribed(RosterTopic) ?? false;
                lock (_gate)
                {
                    tick = _roster.Evaluate(ut, state);
                    if (_audience.ShouldPublish(hasAudience, tick.RosterChanged))
                    {
                        roster = _roster.Snapshot();
                    }
                }

                if (tick.StopWarp)
                {
                    WarpStopBudget.Record(1, ut);
                    _actuator.SetWarp(0);
                }

                if (roster == null && tick.Fired.Count == 0)
                {
                    return null;
                }
                return new ScetAlarmPublish
                {
                    Ut = ut,
                    Roster = roster,
                    Fired = tick.Fired,
                };
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] SCET alarm evaluation failed: " + ex);
                return null;
            }
        }

        /// <summary>COURIER-THREAD publish of what the capture decided. Touches no KSP API.</summary>
        private void HandleOnCourier(object? captured)
        {
            if (captured is not ScetAlarmPublish publish)
            {
                return;
            }
            if (publish.Roster != null)
            {
                _rosterPublisher?.Publish(publish.Roster, publish.Ut);
            }
            foreach (var fired in publish.Fired)
            {
                _firedPublisher?.Publish(fired, publish.Ut);
            }
        }

        /// <summary>What crosses from the main thread to the Courier: plain data, no live KSP references.</summary>
        private sealed class ScetAlarmPublish
        {
            public double Ut;
            public List<ScetAlarm>? Roster;
            public List<ScetAlarmFired> Fired = new List<ScetAlarmFired>();
        }
    }
}
