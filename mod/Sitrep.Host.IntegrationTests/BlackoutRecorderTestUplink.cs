using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Fixture for <see cref="BlackoutRecorderTests"/>: two Delayed channels
    /// that differ ONLY in <see cref="ChannelDeclaration.Recordable"/>, plus the
    /// freeze-exempt connectivity MetaTopic so the disconnect edge can escape
    /// the outage.
    ///
    /// <para>Registers <c>comms.delay</c> through
    /// <see cref="IUplinkHost.SetSignalDelaySource"/> ONLY, never additionally as
    /// a pull-style channel source: the double-registration quirk
    /// <see cref="ConnectivityHorizonTestUplink"/>'s doc comment describes at
    /// length would run CaptureSignalDelay twice per tick and clobber the
    /// last-connected delay snapshot, and every test here turns on telling the
    /// loss-of-signal delay apart from the reacquisition one.</para>
    /// </summary>
    internal sealed class BlackoutRecorderTestUplink : ISitrepUplink
    {
        // Mandatory health floor (test double).
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public const string Id = "blackout-recorder-test";

        /// <summary>Delayed and RECORDABLE (the default): stands in for vessel.* telemetry.</summary>
        public const string OnboardTopic = "recorder.onboard";

        /// <summary>Delayed and NOT recordable: stands in for time.warp, a session fact that rides the vessel snapshot.</summary>
        public const string SessionTopic = "recorder.session";

        public const string LinkTopic = ChannelEngine.ConnectivityMetaTopic;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = Id,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = OnboardTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                    Recordable = true,
                },
                new ChannelDeclaration
                {
                    Topic = SessionTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                    Recordable = false,
                },
                new ChannelDeclaration
                {
                    Topic = LinkTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(OnboardTopic, snapshot => Read(snapshot, "onboard"));
            host.AddChannelSource(SessionTopic, snapshot => Read(snapshot, "session"));
            host.AddChannelSource(LinkTopic, MapLink);

            host.SetSignalDelaySource(ComputeDelay);
            host.SetConnectivitySource(ComputeConnected);
        }

        private static object? MapLink(KspSnapshot? snapshot)
        {
            var connected = ComputeConnected(snapshot);
            if (connected == null)
            {
                return null;
            }
            return new CommsLink
            {
                Connected = connected.Value,
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };
        }

        private static CommsDelay? ComputeDelay(KspSnapshot? snapshot)
        {
            var raw = Read(snapshot, "delay");
            if (raw == null)
            {
                return null;
            }
            return new CommsDelay
            {
                OneWaySeconds = Convert.ToDouble(raw),
                Source = CommsDelaySource.SignalDelay,
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };
        }

        private static bool? ComputeConnected(KspSnapshot? snapshot)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue("connected", out var value) || value == null)
            {
                return null;
            }
            return Convert.ToBoolean(value);
        }

        private static object? Read(KspSnapshot? snapshot, string key)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue(key, out var value))
            {
                return null;
            }
            return value;
        }

        public static KspSnapshot Snapshot(
            double ut,
            bool? connected = null,
            double? delay = null,
            double? onboard = null,
            double? session = null)
        {
            var values = new Dictionary<string, object?>();
            if (connected.HasValue)
            {
                values["connected"] = connected.Value;
            }
            if (delay.HasValue)
            {
                values["delay"] = delay.Value;
            }
            if (onboard.HasValue)
            {
                values["onboard"] = onboard.Value;
            }
            if (session.HasValue)
            {
                values["session"] = session.Value;
            }
            return new KspSnapshot { Ut = ut, Values = values };
        }
    }
}
