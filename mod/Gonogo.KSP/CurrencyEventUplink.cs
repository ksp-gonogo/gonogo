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
    public sealed class CurrencyEventUplink : ISitrepUplink
    {
        private IDynamicChannelSource? _events;
        private IUplinkHost? _host;
        private bool _subscribed;

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

        public void Register(IUplinkHost host)
        {
            _host = host;
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
            });

            HookGameEvents();
        }

        private void HookGameEvents()
        {
            if (_subscribed)
            {
                return;
            }
            _subscribed = true;

            GameEvents.OnScienceRecieved.Add(OnScienceReceived);
            // The addon hosting this uplink is KSPAddon(once) + DontDestroyOnLoad, so
            // Register runs once per process and these handlers are meant to live
            // process-wide (a credit can land in any scene). Unsubscribe on return to
            // the main menu anyway so a hypothetical re-Register cannot double-hook.
            GameEvents.onGameSceneLoadRequested.Add(OnSceneUnload);
        }

        private void OnSceneUnload(GameScenes scene)
        {
            if (scene == GameScenes.MAINMENU)
            {
                UnhookGameEvents();
            }
        }

        private void UnhookGameEvents()
        {
            if (!_subscribed)
            {
                return;
            }
            _subscribed = false;

            GameEvents.OnScienceRecieved.Remove(OnScienceReceived);
            GameEvents.onGameSceneLoadRequested.Remove(OnSceneUnload);
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

        /// <summary>
        /// MAIN-THREAD: make sure the ledger knows this vessel's light-time before its
        /// event is recorded, so the reveal delay is the source's own rather than the
        /// whole-network default.
        ///
        /// <para><see cref="FleetDelayUplink"/> normally arms every vessel node each
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
