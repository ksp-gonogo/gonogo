using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A main-thread capture can change the game (an alarm stopping the warp)
    /// after the snapshot was read, so the tick gets one correction pass over
    /// its snapshot after every capture and before it reaches the Courier.
    /// </summary>
    public class AfterCapturesTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

        [Fact]
        public void TheSnapshotTheCourierReadsCarriesWhatACaptureDidToTheGame()
        {
            var gameWarpRate = 100.0;
            double? seenOnCourier = null;
            var uplink = new StoppingUplink(
                capture: () => gameWarpRate = 1.0,
                seen: snapshot =>
                {
                    var time = (Dictionary<string, object?>)snapshot.Values["time"]!;
                    seenOnCourier = (double)time["warpRate"]!;
                });

            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(uplink);
            engine.SetAfterCaptures(snapshot =>
                snapshot.Values["time"] = new Dictionary<string, object?> { ["warpRate"] = gameWarpRate });
            engine.Start();

            var snapshot = new KspSnapshot { Ut = 1.0 };
            snapshot.Values["time"] = new Dictionary<string, object?> { ["warpRate"] = gameWarpRate };
            engine.TickAndWait(1.0, snapshot, Timeout);

            Assert.Equal(1.0, seenOnCourier);
        }

        private sealed class StoppingUplink : ISitrepUplink, ISnapshotSampler
        {
            private readonly Action _capture;
            private readonly Action<KspSnapshot> _seen;

            public StoppingUplink(Action capture, Action<KspSnapshot> seen)
            {
                _capture = capture;
                _seen = seen;
                Manifest = new UplinkManifest { Id = "after.captures", Version = "1.0.0" };
            }

            public UplinkManifest Manifest { get; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddSampledSource(
                    _ =>
                    {
                        _capture();
                        return null;
                    },
                    _ => { });
                host.AddSampler(this);
            }

            public void Sample(KspSnapshot snapshot) => _seen(snapshot);
        }
    }
}
