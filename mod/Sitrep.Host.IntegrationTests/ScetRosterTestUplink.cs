using System;
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

    /// <summary>
    /// A craft whose <c>vessel.flight</c> a SCET threshold can be armed against,
    /// on a link whose one-way time the test chooses.
    ///
    /// <para>The flight channel is mapped by
    /// <see cref="VesselViewProvider.BuildFlightWire"/>, the same function
    /// <see cref="ScetThresholdSources"/> resolves a threshold through, so the
    /// payload the archive records and the payload the snapshot reader builds
    /// are the same shape from the same source. Two readers disagreeing here
    /// would be a disagreement about DELAY, which is what the equivalence gate
    /// is asking about, rather than about the wire.</para>
    ///
    /// <para>The delay and connectivity seams are production-shaped, as
    /// <see cref="FreezeGateTestUplink"/> has them: the whole-network light-time
    /// a command vantage falls through to is driven by the tick's own
    /// <c>delay</c>, so one snapshot argument moves the OWLT the gate turns
    /// on.</para>
    /// </summary>
    internal sealed class ScetVantageTestUplink : ISitrepUplink
    {
        internal const string VesselGuid = "11111111-2222-3333-4444-555555555555";
        internal const string Subject = "vessel:" + VesselGuid;
        internal const string FlightTopic = VesselViewProvider.FlightTopic;
        internal const string AltitudeField = "altitudeAsl";

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "scet-vantage-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = ChannelEngine.CommsDelayTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = FlightTopic,
                    Delivery = Delivery.LossyLatest,
                    // Delayed, and an ordinary one: no TrueNow declaration and no
                    // freeze exemption, so it is NOT routed onto the meta vantage
                    // and a command vantage pays its own light-time for it. An
                    // instant-class topic here would make the control unable to
                    // fail.
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(ChannelEngine.CommsDelayTopic, MapDelay);
            host.AddChannelSource(FlightTopic, VesselViewProvider.BuildFlightWire);
            host.SetSignalDelaySource(ComputeDelay);
            host.SetConnectivitySource(_ => true);
        }

        private static object? MapDelay(KspSnapshot? snapshot) => ComputeDelay(snapshot);

        private static CommsDelay? ComputeDelay(KspSnapshot? snapshot)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue("delay", out var raw) || raw == null)
            {
                return null;
            }
            return new CommsDelay
            {
                OneWaySeconds = Convert.ToDouble(raw),
                Source = CommsDelaySource.SignalDelay,
            };
        }

        /// <summary>
        /// Every key <see cref="VesselViewProvider.BuildFlight"/> requires, since
        /// it answers null rather than a part-filled payload when one is missing,
        /// and a part-filled reading is what must never reach a threshold.
        /// </summary>
        internal static KspSnapshot Snapshot(double ut, double altitudeAsl, double delay)
        {
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?>
                {
                    ["delay"] = delay,
                    ["vessels"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["id"] = VesselGuid },
                    },
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["identity"] = new Dictionary<string, object?>
                        {
                            ["id"] = VesselGuid,
                            ["name"] = "Kerbal X",
                            ["vesselType"] = "Ship",
                            ["situation"] = "ORBITING",
                        },
                        ["flight"] = new Dictionary<string, object?>
                        {
                            ["latitude"] = 0.5,
                            ["longitude"] = 1.5,
                            ["altitudeAsl"] = altitudeAsl,
                            ["altitudeTerrain"] = altitudeAsl - 10,
                            ["verticalSpeed"] = 120.0,
                            ["surfaceSpeed"] = 2200.0,
                            ["orbitalSpeed"] = 2300.0,
                            ["gForce"] = 1.2,
                            ["dynamicPressure"] = 0.0,
                            ["mach"] = 3.4,
                            ["atmDensity"] = 0.0,
                            ["externalTemperature"] = 250.0,
                            ["atmosphericTemperature"] = 251.0,
                        },
                    },
                },
            };
        }
    }
}
