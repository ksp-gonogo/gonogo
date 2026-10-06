using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The editors stop the game clock. Driven the way <c>GonogoAddon.FixedUpdate</c>
    /// drives the engine, fifty physics ticks a real second through
    /// <see cref="SampleGate"/>: a second of Space Center at 1x, then an editor
    /// whose UT stands less than one interval past the last Space Center sample,
    /// which the UT gate alone never samples.
    /// </summary>
    public class StoppedClockDeliveryTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private const double TickRealSec = 0.02;
        private const double SpaceCenterUt = 666.137;
        private const double EditorUt = 666.9;

        [Fact]
        public async Task EnteringTheEditorPublishesItsStateStampedWithTheUtTheClockStoppedAt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new StoppedClockTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                foreach (var topic in StoppedClockTestUplink.Topics)
                {
                    await SubscribeAsync(client, topic, Timeout);
                }

                var game = new PhysicsLoop(engine);
                game.Run(1.0, realSec => SpaceCenterUt + realSec, "SpaceCenter");
                await DrainAllStreamDataAsync(client, TestBudgets.Quiet);

                game.Run(3.0, _ => EditorUt, "Editor");
                var frames = await DrainAllStreamDataAsync(client, TestBudgets.Quiet);

                foreach (var topic in StoppedClockTestUplink.Topics)
                {
                    var editorFrames = frames.Where(f => f.Topic == topic).ToList();
                    Assert.True(editorFrames.Count == 1, topic + " sent " + editorFrames.Count + " frames in the editor, not the one change");
                    Assert.Equal("Editor", editorFrames[0].Payload?.ToString());
                    Assert.Equal(EditorUt, editorFrames[0].Meta.ValidAt);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AZeroDelayOrderGivenInTheEditorExecutesAndConfirmsOnTheNextStoppedClockTick()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new StoppedClockTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                var game = new PhysicsLoop(engine);
                game.Run(1.0, realSec => SpaceCenterUt + realSec, "SpaceCenter");
                game.Run(0.5, _ => EditorUt, "Editor");

                object? confirmed = null;
                engine.DispatchCommandAndWait(
                    StoppedClockTestUplink.Command, "tool", "KSC",
                    result => confirmed = result,
                    Timeout);
                Assert.Equal(0, uplink.Executed);

                game.Run(2.0, _ => EditorUt, "Editor");

                Assert.Equal(1, uplink.Executed);
                Assert.Equal("done:tool", confirmed);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Fifty physics ticks a real second, ticking the engine only when the gate admits one.</summary>
        private sealed class PhysicsLoop
        {
            private readonly ChannelEngine _engine;
            private readonly SampleGate _gate = new SampleGate();
            private double _realSec;

            public PhysicsLoop(ChannelEngine engine)
            {
                _engine = engine;
            }

            public void Run(double seconds, Func<double, double> utAt, string scene)
            {
                var end = _realSec + seconds;
                for (; _realSec < end - TickRealSec / 2; _realSec += TickRealSec)
                {
                    var ut = utAt(_realSec);
                    if (!_gate.Admit(ut, warpRate: 1.0, _realSec)) continue;
                    _engine.TickAndWait(ut, new KspSnapshot
                    {
                        Ut = ut,
                        Values = new Dictionary<string, object?> { ["scene"] = scene },
                    }, Timeout);
                }
            }
        }

        /// <summary>One channel in each delay role, all reading the scene, and one delayed order.</summary>
        private sealed class StoppedClockTestUplink : ISitrepUplink
        {
            public const string TrueNowTopic = "stoppedclock.scene";
            public const string HeldAtHomeTopic = "stoppedclock.buildCost";
            public const string DelayedTopic = "stoppedclock.craft";
            public const string Command = "stoppedclock.toolAll";

            public static readonly string[] Topics = { TrueNowTopic, HeldAtHomeTopic, DelayedTopic };

            public int Executed;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "stopped-clock-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Declare(TrueNowTopic, DelayRole.TrueNow),
                    Declare(HeldAtHomeTopic, DelayRole.Delayed, heldAtHome: true),
                    Declare(DelayedTopic, DelayRole.Delayed),
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = HeldAtHomeTopic },
                },
            };

            private static ChannelDeclaration Declare(string topic, DelayRole delay, bool heldAtHome = false) =>
                new ChannelDeclaration
                {
                    Topic = topic,
                    Requires = Requirement.None,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = delay,
                    HeldAtHome = heldAtHome,
                };

            public void Register(IUplinkHost host)
            {
                foreach (var topic in Topics)
                {
                    host.AddChannelSource(topic, snapshot => snapshot?.Values["scene"]);
                }
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Executed++;
                    return "done:" + args;
                });
            }
        }
    }
}
