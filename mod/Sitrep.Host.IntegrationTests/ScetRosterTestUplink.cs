using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Alarms;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>Gonogo.KSP.ScetAlarmUplink</c>'s roster-publish shape, KSP-free: an
    /// UNGATED sampled source (production's must be, its real effect is stopping
    /// the warp) publishing a list-shaped roster on a
    /// <see cref="Delivery.ReliableOrdered"/> channel.
    ///
    /// <para>The decision of WHEN to publish is not transcribed here, it is the
    /// shipped <see cref="ScetRosterAudience"/>, so these tests exercise the rule
    /// the uplink actually runs rather than a copy that would agree with itself
    /// forever. What is modelled is only the surrounding shape: the ungated
    /// capture, the Courier-side publish, and a roster the test can arm into.</para>
    /// </summary>
    internal sealed class ScetRosterTestUplink : ISitrepUplink
    {
        internal const string Topic = "alarm.scet";

        private readonly object _gate = new object();
        private readonly List<ScetAlarm> _alarms = new List<ScetAlarm>();
        private readonly ScetRosterAudience _audience = new ScetRosterAudience();

        private IUplinkHost? _host;
        private IChannelPublisher? _publisher;
        private bool _changed;

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "scet-roster-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = Topic,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            _host = host;
            _publisher = host.Publisher(Topic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier);
        }

        /// <summary>Arm an alarm, as the <c>alarm.scet.arm</c> command handler does: off-tick, and the tick that follows has to notice.</summary>
        internal void Arm(string id)
        {
            lock (_gate)
            {
                _alarms.Add(new ScetAlarm { Id = id, State = ScetAlarmState.Armed });
                _changed = true;
            }
        }

        private object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var hasAudience = _host!.IsAnyTopicSubscribed(Topic);
            List<ScetAlarm>? roster = null;
            lock (_gate)
            {
                var changed = _changed;
                _changed = false;
                if (_audience.ShouldPublish(hasAudience, changed))
                {
                    roster = new List<ScetAlarm>(_alarms);
                }
            }
            return new Capture { Ut = snapshot?.Ut ?? 0.0, Roster = roster };
        }

        private void HandleOnCourier(object? captured)
        {
            if (captured is not Capture capture || capture.Roster == null)
            {
                return;
            }
            _publisher?.Publish(capture.Roster, capture.Ut);
        }

        private sealed class Capture
        {
            public double Ut;
            public List<ScetAlarm>? Roster;
        }
    }

    /// <summary>
    /// Publishes on its first capture and never again unless asked: the "publish
    /// the empty value once at registration" shape, so a test can ask what a
    /// subscriber who arrives afterwards is given.
    /// </summary>
    internal sealed class PublishOnceTestUplink : ISitrepUplink
    {
        internal const string Topic = "publishonce.value";

        private IChannelPublisher? _publisher;
        private bool _published;

        /// <summary>Set by a test to allow one more publish, proving the channel was never dead.</summary>
        internal void PublishAgain() => _published = false;

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "publish-once-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = Topic,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            _publisher = host.Publisher(Topic);
            host.AddSampledSource(snapshot => snapshot?.Ut ?? 0.0, HandleOnCourier);
        }

        private void HandleOnCourier(object? captured)
        {
            if (_published)
            {
                return;
            }
            _published = true;
            _publisher?.Publish(captured is double ut ? ut : 0.0, captured is double u ? u : 0.0);
        }
    }
}
