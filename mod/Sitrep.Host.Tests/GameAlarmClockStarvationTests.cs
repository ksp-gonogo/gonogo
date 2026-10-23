using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The game's alarm clock is asked on every tick with nothing subscribed,
    /// through the real <see cref="ChannelEngine"/>, so a Gonogo alarm on a
    /// universal time is copied into the game whether or not any screen is open.
    ///
    /// <para>The clock holds no state of its own: what can starve it is the
    /// capture that asks it, if that capture is subscription-gated. The planted
    /// Uplink asks the elected clock the way the alarm Uplink does, from a
    /// sampled source, and the reconcile is the real
    /// <see cref="GameAlarmMirror"/> over a real <see cref="ScetAlarmRoster"/>.
    /// The gated shape is planted too, to show this drive sees starvation when it
    /// is there. That the alarm Uplink uses the ungated overload is held by
    /// <c>Gonogo.KSP.Tests.GameAlarmClockIsWiredTests</c>.</para>
    /// </summary>
    public class GameAlarmClockStarvationTests
    {
        // Claimed for the census in Sitrep.Host.IntegrationTests, which fails on an exclusive capability nothing claims.
        //
        // exclusive-capability-starvation: gameAlarmClock

        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

        private const string GatedPrefix = "alarm.game.";

        [Fact]
        public void A_gonogo_time_alarm_reaches_the_game_clock_with_nothing_subscribed()
        {
            var uplink = new PlantedAlarmUplink(gated: false);

            DriveWithNothingSubscribed(uplink);

            Assert.True(uplink.Asked > 0, "the elected clock was never asked");
            var copy = Assert.Single(uplink.Clock.Held);
            Assert.Equal(5000, copy.Ut);
            Assert.Equal("Burn", copy.Title);
        }

        [Fact]
        public void The_same_sync_behind_a_gated_capture_is_starved_with_nothing_subscribed()
        {
            var uplink = new PlantedAlarmUplink(gated: true);

            DriveWithNothingSubscribed(uplink);

            Assert.Equal(0, uplink.Asked);
            Assert.Empty(uplink.Clock.Held);
        }

        /// <summary>One Gonogo time alarm armed, the planted Uplink registered, and five ticks with no client connected.</summary>
        private static void DriveWithNothingSubscribed(PlantedAlarmUplink uplink)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(uplink, ContractVersion.Major, ContractVersion.Minor),
            });
            engine.ResolveCapabilities();
            engine.Start();
            try
            {
                Assert.Same(uplink.Clock, engine.Kernel.Query<IGameAlarmClock>(GameAlarmClockCapability.Id));

                for (var tick = 1; tick <= 5; tick++)
                {
                    engine.TickAndWait(tick, new KspSnapshot { Ut = tick }, Timeout);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class PlantedAlarmUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            private readonly bool _gated;
            private readonly ScetAlarmRoster _roster = new ScetAlarmRoster();
            private readonly GameAlarmMirror _mirror = new GameAlarmMirror(new Dictionary<string, long>());
            private Kernel? _kernel;
            private int _asked;

            public PlantedAlarmUplink(bool gated)
            {
                _gated = gated;
                _roster.Arm(new ScetAlarmArmArgs
                {
                    Id = "a",
                    Name = "Burn",
                    Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time, Ut = 5000, LeadSeconds = 10 },
                }, "KSC");
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "planted.alarms", Version = "1.0.0" };

            public CountingClock Clock { get; } = new CountingClock();

            /// <summary>How many ticks asked the elected clock.</summary>
            public int Asked => Volatile.Read(ref _asked);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void DeclareCapabilities(Kernel kernel)
            {
                kernel.RegisterCapability(new CapabilityDescriptor
                {
                    Id = GameAlarmClockCapability.Id,
                    Exclusive = true,
                    SpineCritical = false,
                    Vanilla = _ => Clock,
                });
            }

            public void Register(IUplinkHost host)
            {
                _kernel = host.Kernel;

                Func<KspSnapshot?, object?> capture = snapshot =>
                {
                    var clock = _kernel.Query<IGameAlarmClock>(GameAlarmClockCapability.Id);
                    Interlocked.Increment(ref _asked);
                    var outcome = _mirror.Reconcile(_roster.Snapshot(), clock, snapshot?.Ut ?? 0);
                    foreach (var link in outcome.Links)
                    {
                        _roster.SetGameAlarm(link.Key, link.Value);
                    }
                    return null;
                };
                Action<object?> handle = _ => { };

                if (_gated)
                {
                    host.AddSampledSource(capture, handle, GatedPrefix);
                    return;
                }

                host.AddSampledSource(capture, handle);
            }
        }

        private sealed class CountingClock : IGameAlarmClock
        {
            private long _next = 100;

            public string ProviderId => "planted-clock";

            public bool Available => true;

            public List<GameAlarmRecord> Held { get; } = new List<GameAlarmRecord>();

            public IReadOnlyList<GameAlarmRecord> Alarms() => Held.ToList();

            public long? CreateAtUt(string title, double ut)
            {
                var id = _next++;
                Held.Add(new GameAlarmRecord { Id = id, Kind = GameAlarmKind.Time, Title = title, Ut = ut, Warp = GameAlarmWarp.Nothing });
                return id;
            }

            public bool Delete(long id) => Held.RemoveAll(a => a.Id == id) > 0;
        }
    }
}
