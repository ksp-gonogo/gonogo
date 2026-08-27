using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The source-attributed currency-event producer: hooks the KSP events that
    /// credit or debit a currency BECAUSE OF A SPECIFIC VESSEL, and publishes each
    /// one on <c>currency.&lt;vesselGuid&gt;.&lt;currency&gt;</c> so it is revealed at
    /// that vessel's own light-time to the observer.
    ///
    /// <para><b>Why this exists.</b> A career currency total reveals instantly
    /// (<c>career.status</c> is <see cref="DelayRole.TrueNow"/>, deliberately: the
    /// operator must see the number the game will actually gate a spend against)
    /// while the vessel telemetry that would confirm the underlying event is Delayed.
    /// An operator watching the total could therefore infer a distant event a full
    /// return light-time before the model says they can know it. These events close
    /// that gap by carrying each delta on its SOURCE vessel's clock, additively:
    /// nothing about <c>career.status.economy</c> changes.</para>
    ///
    /// <para><b>How the reveal is routed.</b> <c>ChannelEngine.NodeForTopic</c> maps a
    /// <c>currency.&lt;guid&gt;.*</c> topic to the per-vessel Courier node
    /// <c>fleet.&lt;guid&gt;</c>, the same node that vessel's telemetry records under,
    /// so the ledger applies <c>DelayTo(vantage, thatVessel)</c> per subscriber
    /// vantage. That keeps the reveal correct for every command centre rather than
    /// baking in one observer's delay. No new engine plumbing: this rides the
    /// existing publisher -> change-gate -> reveal gate -> Courier -> reliable
    /// outbox -> WS spine exactly as <see cref="CrashUplink"/> does.</para>
    ///
    /// <para><b>Scope, deliberately narrow.</b> Only deltas with ONE cleanly
    /// resolvable source vessel are attributed. Contract completion/failure rewards
    /// are NOT: a contract's parameters may name zero, one, or an arbitrary changing
    /// set of vessels, so there is no honest single source to delay against. Ground
    /// actions (facility upgrade, tech unlock, strategy, recruit, admin-building
    /// conversion) are NOT: no vessel is involved by construction. Recovery is
    /// attributable but a recovered vessel is home, so its delay is ~0 and there is
    /// nothing to gain. All of those stay on the existing instant path.</para>
    /// </summary>
    [SitrepUplink("currency")]
    public sealed class CurrencyEventUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        /// <summary>
        /// How far apart (UT seconds) a crew death and a destruction detector may be and
        /// still count as the same occurrence for attribution. A crash kills its crew in
        /// the same physics frame, so this only has to absorb frame-boundary noise.
        /// </summary>
        private const double AttributionWindowUt = 2.0;

        private IDynamicChannelSource? _events;
        private IUplinkHost? _host;
        private bool _subscribed;
        private bool _sceneHookInstalled;

        // The vessel a destruction detector saw most recently, used to attribute a crew
        // death whose EventReport carries no part (ProtoCrewMember.Die's null origin).
        private Vessel? _lastDestroyed;
        private double _lastDestroyedUt = double.NegativeInfinity;

        // Reputation is tracked here because GameEvents.OnReputationChanged fires the new
        // TOTAL, not the delta (decompile-confirmed: Reputation.AddReputation calls
        // Fire(rep, reason)). The delta is newTotal - this.
        private float _lastReputation;
        private bool _haveReputationBaseline;

        // A VesselLoss reputation change seen before the crew death that explains it. The
        // two are separate GameEvents subscribers firing in the same frame and their
        // relative order is not guaranteed, so each half looks for the other.
        private double _unattributedRepDelta;
        private double _unattributedRepUt = double.NegativeInfinity;

        // Losses accumulating this frame, keyed by vessel. Published on the next tick
        // rather than per death so a three-kerbal crash is ONE event carrying the whole
        // delta and the whole crew list, not three partial ones.
        private readonly Dictionary<string, PendingLoss> _pendingLosses = new Dictionary<string, PendingLoss>();

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "currency",
            Version = "1.0.0",
            // No static channels: every topic is materialized per vessel guid out of
            // the dynamic namespace registered below.
            Channels = new List<ChannelDeclaration>(),
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        /// <summary>
        /// Declares the exclusive <c>"delayedScience"</c> capability with
        /// <see cref="CurrencyDelay.DelayedScienceSinkBackend"/> as its always-present Vanilla
        /// factory, so any Uplink observing a third-party mod's own science crediting can hand
        /// increments to the currency-delay subsystem through <c>host.Kernel</c>. Declared HERE, in
        /// the pre-Register pass, for the same reason comms and action groups are: it guarantees the
        /// capability exists before any Uplink's <c>Register</c> runs, whatever order the assembly
        /// scan discovers them in.
        ///
        /// <para>This uplink owns it because the reveal side of the same subsystem is already its
        /// job: the sink produces the pending credits whose reveal these <c>currency.*</c> events
        /// report. Not SpineCritical, and there is no competing provider to elect: a capability with
        /// one implementation is still the right shape, because the point is that a consumer reaches
        /// it without reaching the assembly it lives in.</para>
        /// </summary>
        public void DeclareCapabilities(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = DelayedScienceCapability.CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new CurrencyDelay.DelayedScienceSinkBackend(),
            });

            // The other half of the same subsystem, and the reason it is declared
            // here beside the sink: a delay is only an information barrier if
            // everything DERIVED from the delayed change waits with it. A mod that
            // computes its own currency off the same game event computes it before
            // the interceptor has neutralised anything, and the neutralise is a
            // balance write, which fires no currency query, so the mod is never told
            // to revisit its answer.
            //
            // SHARED, not exclusive: two installed mods can each derive something
            // from one change and every one of them has to be told, where an
            // election would tell exactly one. No vanilla: a stock install derives
            // nothing, so there is nothing for a fallback to fall back to.
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = DerivedCurrencyCapability.CapabilityId,
                Exclusive = false,
                SpineCritical = false,
            });
        }

        public void Register(IUplinkHost host)
        {
            _host = host;

            // Zero arms here is expected rather than a fault, and the reason says so
            // on the line itself: ResolveCapabilities runs after the last uplink's
            // Register, so no provider is active yet. The roster line GonogoAddon
            // prints after that resolution is the authoritative one.
            BindWithholding("uplink Register, before capability resolution");
            _events = host.RegisterDynamicNamespace(ChannelEngine.CurrencyEventPrefix, new ChannelDeclaration
            {
                // A discrete one-shot record, not a sampled state: the reliable lane
                // delivers every event in order and replays the last one to a late
                // subscriber via keyframe-on-subscribe, which is what a "the science
                // from this vessel landed" event needs. Same lane crash.lastCrash uses.
                Delivery = Delivery.ReliableOrdered,
                // Delayed is the whole point: the reveal rides the ledger's
                // DelayTo(vantage, fleet.<guid>) for this event's source vessel.
                Delay = DelayRole.Delayed,
                // Coarse keyframe interval: an event is discrete, so the change-gate
                // plus the reliable lane carry each new value on their own.
                Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                // currency.<guid>.<currency> is keyed by the vessel the delta came
                // FROM, so it records on that craft's node and reveals at its
                // light-time. Declared here rather than known to the engine.
                PerVesselNode = true,
            });

            // UNGATED per-tick drain (no subscription prefix), the same discipline
            // CrashUplink uses for its stats capture: a loss must be recorded and
            // published whether or not a client happens to be watching at that instant,
            // so a station connecting later still receives it off the reliable lane's
            // keyframe-on-subscribe. Publishes from the main thread and returns null, so
            // nothing rides the tick path itself.
            host.AddSampledSource(DrainPendingLosses, _ => { });

            // Subscribed here and never removed, unlike everything HookGameEvents
            // owns: this is the handler that re-arms the rest, so tearing it down at
            // the main menu is the one teardown nothing can undo. It is what
            // happened. Guarded rather than trusted to be called once, because
            // EventData.Add appends without checking for a delegate it already holds
            // (decompile-confirmed), so a second Register would fire it twice.
            if (!_sceneHookInstalled)
            {
                _sceneHookInstalled = true;
                GameEvents.onGameSceneLoadRequested.Add(OnSceneLoadRequested);
            }

            HookGameEvents();
        }

        /// <summary>
        /// Points the derived-currency fan-out at this engine's kernel and at a log
        /// an operator can read.
        ///
        /// <para>The interceptor lives on a <c>ScenarioModule</c>, which has no host
        /// and so no kernel of its own; this is the half of the subsystem holding
        /// one. The POINTER is bound rather than the arm list, because
        /// <c>ResolveCapabilities</c> runs after the last uplink's <c>Register</c>
        /// and a list captured at that point would be empty for the whole
        /// session.</para>
        ///
        /// <para>Its own method because it has to be callable again: see
        /// <see cref="OnSceneLoadRequested"/>.</para>
        ///
        /// <para>The sinks go in BEFORE the bind, or the bind's own announcement is
        /// the one line that lands in the no-op default and says nothing.</para>
        /// </summary>
        private void BindWithholding(string reason)
        {
            var host = _host;
            if (host == null)
            {
                return;
            }

            CurrencyDelay.DerivedCurrencyWithholding.Report = message => Debug.LogWarning(message);
            CurrencyDelay.DerivedCurrencyWithholding.Note = message => Debug.Log(message);
            CurrencyDelay.DerivedCurrencyWithholding.Bind(host.Kernel, reason);
        }

        private void HookGameEvents()
        {
            if (_subscribed)
            {
                return;
            }
            _subscribed = true;

            GameEvents.OnScienceRecieved.Add(OnScienceReceived);
            GameEvents.onCrewKilled.Add(OnCrewKilled);
            GameEvents.OnReputationChanged.Add(OnReputationChanged);
            // Destruction detectors, hooked ONLY to attribute a crew death to a vessel
            // (see _lastDestroyed): losing an uncrewed vessel costs no reputation in
            // stock, so these raise no event of their own.
            GameEvents.onCrash.Add(OnCrash);
            GameEvents.onCrashSplashdown.Add(OnCrash);
            GameEvents.onVesselWillDestroy.Add(OnVesselWillDestroy);
        }

        /// <summary>
        /// Arms this uplink on the way into a game and stands it down on the way back
        /// to the main menu.
        ///
        /// <para><b>The re-arm is the fix for rig run <c>conf-fixed-1</c>.</b> The
        /// stand-down half used to be all there was, on the stated assumption that a
        /// re-<c>Register</c> would arm it again. There is no re-<c>Register</c>: the
        /// host addon is <c>KSPAddon(Instantly, once)</c>, so <c>Register</c> runs
        /// once for the whole process, and it runs during LOADING. KSP fires
        /// <c>onGameSceneLoadRequested(MAINMENU)</c> out of
        /// <c>HighLogic.SetLoadSceneEventsAndFlags</c> on the LOADING -> MAINMENU
        /// transition that follows, so the stand-down was reached at BOOT, before the
        /// player had loaded anything, and nothing ever undid it. Measured: the addon
        /// logged its build at 11:34:14 and the scene change came at 11:35:53, 99
        /// seconds later, in the same session whose science was withheld correctly
        /// while RP-1's confidence moved anyway.</para>
        ///
        /// <para>Both halves are idempotent, so an extra scene change costs nothing.
        /// The stand-down is kept rather than deleted because a currency handler at
        /// the main menu has no career to attribute anything to.</para>
        /// </summary>
        private void OnSceneLoadRequested(GameScenes scene)
        {
            if (scene == GameScenes.MAINMENU)
            {
                UnhookGameEvents();
                // The kernel this pointed at belongs to the engine that registered
                // us; there is no game to withhold anything for once we are back at
                // the menu.
                CurrencyDelay.DerivedCurrencyWithholding.Unbind("scene load MAINMENU");
                return;
            }

            HookGameEvents();
            BindWithholding("scene load " + scene);
        }

        private void UnhookGameEvents()
        {
            if (!_subscribed)
            {
                return;
            }
            _subscribed = false;

            GameEvents.OnScienceRecieved.Remove(OnScienceReceived);
            GameEvents.onCrewKilled.Remove(OnCrewKilled);
            GameEvents.OnReputationChanged.Remove(OnReputationChanged);
            GameEvents.onCrash.Remove(OnCrash);
            GameEvents.onCrashSplashdown.Remove(OnCrash);
            GameEvents.onVesselWillDestroy.Remove(OnVesselWillDestroy);
        }

        /// <summary>
        /// MAIN-THREAD science-credit handler. <c>GameEvents.OnScienceRecieved</c>
        /// (KSP's own spelling) fires when science is actually banked and carries the
        /// crediting <c>ProtoVessel</c>, so the source attribution needs no separate
        /// bookkeeping: stock's lump credit on transmit-stream completion and
        /// Kerbalism's continuous accrual both arrive here with the same vessel handle,
        /// which is why this is a core event rather than a Kerbalism-specific one.
        /// <see cref="IChannelPublisher.Publish"/> is main-thread-safe (it hands off to
        /// the engine job queue), so publishing straight from the callback is correct.
        /// </summary>
        private void OnScienceReceived(float amount, ScienceSubject subject, ProtoVessel protoVessel, bool reverseEngineered)
        {
            try
            {
                if (_events == null || protoVessel == null)
                {
                    // No resolvable source vessel means no honest reveal clock to put
                    // the event on, so it is left to the instant career.status path
                    // rather than attributed to a guess.
                    return;
                }

                // reverseEngineered credits come from recovering someone else's part at
                // KSC, a ground action with no vessel comms link in it.
                if (reverseEngineered)
                {
                    return;
                }

                if (amount <= 0f || float.IsNaN(amount) || float.IsInfinity(amount))
                {
                    return;
                }

                var vesselId = protoVessel.vesselID.ToString();
                if (string.IsNullOrEmpty(vesselId) || protoVessel.vesselID == Guid.Empty)
                {
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                ArmSourceNode(vesselId, protoVessel.vesselRef);

                var payload = CurrencyEventBuilder.BuildScienceCredit(
                    vesselId,
                    protoVessel.vesselName ?? string.Empty,
                    amount,
                    subject?.id ?? string.Empty,
                    subject?.title ?? string.Empty,
                    ut);

                _events.Publisher(vesselId + "." + CurrencyEventTopics.ScienceField).Publish(payload, ut);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] science credit capture failed: " + ex);
            }
        }

        private void OnCrash(EventReport report) => RememberDestroyed(report?.origin?.vessel);

        private void OnVesselWillDestroy(Vessel vessel) => RememberDestroyed(vessel);

        /// <summary>
        /// MAIN-THREAD: note the vessel a destruction detector just saw, so a crew death
        /// arriving in the same frame with no part on its report can still be attributed.
        /// </summary>
        private void RememberDestroyed(Vessel? vessel)
        {
            if (vessel == null)
            {
                return;
            }
            _lastDestroyed = vessel;
            _lastDestroyedUt = Planetarium.GetUniversalTime();
        }

        /// <summary>
        /// MAIN-THREAD reputation-change handler. <c>GameEvents.OnReputationChanged</c>
        /// carries the new TOTAL and a <c>TransactionReasons</c>, so the delta is derived
        /// against the last seen total and only a <c>VesselLoss</c> reason is attributed.
        /// Every other reason (contract reward/penalty, strategy, recruit, admin
        /// conversion) is left entirely alone on the instant path.
        ///
        /// <para>This runs alongside stock's own <c>Reputation.OnCrewKilled</c>
        /// subscriber and the two orders are both possible, so a VesselLoss delta arriving
        /// before the crew death that explains it is stashed for that death to claim.</para>
        /// </summary>
        private void OnReputationChanged(float newTotal, TransactionReasons reason)
        {
            try
            {
                if (!_haveReputationBaseline)
                {
                    // First observation establishes the baseline only: with no previous
                    // total there is no honest delta to derive.
                    _lastReputation = newTotal;
                    _haveReputationBaseline = true;
                    return;
                }

                var delta = (double)newTotal - _lastReputation;
                _lastReputation = newTotal;

                if (reason != TransactionReasons.VesselLoss || delta == 0.0)
                {
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                var pending = FindPendingAt(ut);
                if (pending != null)
                {
                    pending.RepDelta += delta;
                    return;
                }

                // The crew death has not been handled yet; hold the delta for it.
                _unattributedRepDelta += delta;
                _unattributedRepUt = ut;
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] reputation change capture failed: " + ex);
            }
        }

        /// <summary>
        /// MAIN-THREAD crew-death handler. <c>ProtoCrewMember.Die</c> fires this with a
        /// NULL <c>EventReport.origin</c> (decompile-confirmed), so the vessel is resolved
        /// from the report's part when one is present, else the vessel a destruction
        /// detector armed in this frame, else the active vessel. With none of those the
        /// death is dropped rather than blamed on a guess.
        /// </summary>
        private void OnCrewKilled(EventReport report)
        {
            try
            {
                var vessel = report?.origin?.vessel ?? AttributableVessel();
                if (vessel == null)
                {
                    return;
                }

                var vesselId = vessel.id.ToString();
                if (string.IsNullOrEmpty(vesselId) || vessel.id == Guid.Empty)
                {
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                if (!_pendingLosses.TryGetValue(vesselId, out var pending))
                {
                    pending = new PendingLoss
                    {
                        VesselId = vesselId,
                        VesselName = vessel.vesselName ?? string.Empty,
                        Ut = ut,
                        Vessel = vessel,
                    };
                    _pendingLosses[vesselId] = pending;
                }

                // EventReport.sender carries the kerbal's name on the crew-death path
                // (ProtoCrewMember.Die passes it as the report's name).
                var name = report?.sender ?? string.Empty;
                if (name.Length > 0 && !pending.CrewLost.Contains(name))
                {
                    pending.CrewLost.Add(name);
                }

                // Claim a VesselLoss delta that arrived before this death.
                if (_unattributedRepDelta != 0.0 && Math.Abs(ut - _unattributedRepUt) <= AttributionWindowUt)
                {
                    pending.RepDelta += _unattributedRepDelta;
                    _unattributedRepDelta = 0.0;
                    _unattributedRepUt = double.NegativeInfinity;
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] crew loss capture failed: " + ex);
            }
        }

        /// <summary>The vessel a crew death with no part on its report belongs to.</summary>
        private Vessel? AttributableVessel()
        {
            var ut = Planetarium.GetUniversalTime();
            if (_lastDestroyed != null && Math.Abs(ut - _lastDestroyedUt) <= AttributionWindowUt)
            {
                return _lastDestroyed;
            }
            // A death with no destruction behind it (an EVA kerbal, or a crew member lost
            // aboard a vessel that survives) belongs to the vessel being flown. An EVA
            // kerbal is itself a Vessel in KSP, so this resolves a real position either way.
            return FlightGlobals.ActiveVessel;
        }

        private PendingLoss? FindPendingAt(double ut)
        {
            foreach (var pending in _pendingLosses.Values)
            {
                if (Math.Abs(ut - pending.Ut) <= AttributionWindowUt)
                {
                    return pending;
                }
            }
            return null;
        }

        /// <summary>
        /// MAIN-THREAD per-tick drain: publishes one reputation-loss event per vessel for
        /// any loss whose frame is over, so every death and every VesselLoss delta from a
        /// single occurrence is folded into ONE event carrying the whole crew list and the
        /// whole delta. Returns null: nothing is published on the tick path itself.
        ///
        /// <para>A loss with a zero delta is dropped rather than published: an uncrewed
        /// vessel costs no reputation in stock, and a zero-delta "reputation event" would
        /// be noise in the log.</para>
        /// </summary>
        private object? DrainPendingLosses(KspSnapshot? snapshot)
        {
            if (_pendingLosses.Count == 0 || _events == null)
            {
                return null;
            }

            try
            {
                var now = snapshot?.Ut ?? Planetarium.GetUniversalTime();
                var settled = new List<PendingLoss>();
                foreach (var pending in _pendingLosses.Values)
                {
                    // Strictly after the loss UT, so everything raised in that frame has
                    // been folded in before the event goes out.
                    if (now > pending.Ut)
                    {
                        settled.Add(pending);
                    }
                }

                foreach (var pending in settled)
                {
                    _pendingLosses.Remove(pending.VesselId);
                    if (pending.RepDelta == 0.0)
                    {
                        continue;
                    }

                    ArmSourceNode(pending.VesselId, pending.Vessel);
                    var payload = CurrencyEventBuilder.BuildReputationLoss(
                        pending.VesselId,
                        pending.VesselName,
                        pending.RepDelta,
                        "crew-loss",
                        pending.CrewLost,
                        pending.Ut);
                    _events.Publisher(pending.VesselId + "." + CurrencyEventTopics.ReputationField)
                        .Publish(payload, pending.Ut);
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] reputation loss publish failed: " + ex);
            }
            return null;
        }

        /// <summary>One occurrence's losses, accumulating until its frame is over.</summary>
        private sealed class PendingLoss
        {
            public string VesselId = string.Empty;
            public string VesselName = string.Empty;
            public double Ut;
            public double RepDelta;
            public List<string> CrewLost = new List<string>();
            /// <summary>Held to read the light-time at publish time; may be torn down by then, which ArmSourceNode tolerates.</summary>
            public Vessel? Vessel;
        }

        /// <summary>
        /// MAIN-THREAD: make sure the ledger knows this vessel's light-time before its
        /// event is recorded, so the reveal delay is the source's own rather than the
        /// whole-network default.
        ///
        /// <para><see cref="FleetChannels"/> normally arms every vessel node each
        /// capture tick, but that capture is subscription-gated on the <c>fleet.</c>
        /// prefix and can be idle when a client subscribes only a <c>currency.</c>
        /// topic. Arming it here makes the event self-contained.</para>
        ///
        /// <para>Sets the DELAY only, never a <c>false</c> connectivity. A vessel whose
        /// link is down freezes its Delayed topics at a <c>+Inf</c> reveal horizon, so
        /// pushing a negative connectivity reading here could strand an event forever;
        /// light already in transit does arrive, and whether the link is up is the
        /// fleet capture's business, not this event's.</para>
        /// </summary>
        private void ArmSourceNode(string vesselId, Vessel? vessel)
        {
            if (vessel == null || _host == null)
            {
                // An unloaded vessel keeps whatever delay the fleet capture last set
                // for its node (or the whole-network default), which is the best
                // available answer rather than a fabricated one.
                return;
            }
            try
            {
                var (oneWay, _) = FleetCommsReader.ReadVessel(vessel, CommsCoreUplink.SignalDelayConfig);
                if (oneWay.HasValue && !double.IsNaN(oneWay.Value) && !double.IsInfinity(oneWay.Value))
                {
                    _host.SetVesselDelay(vesselId, oneWay.Value);
                }
            }
            catch (Exception)
            {
                // A torn-down comms read leaves the node's existing delay standing.
            }
        }
    }
}
