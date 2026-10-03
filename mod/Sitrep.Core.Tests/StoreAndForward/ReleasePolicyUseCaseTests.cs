using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// The continuous-command use cases every release policy is measured against,
    /// each run under all three so their behaviour can be read side by side. The
    /// policy is not ruled; these record what each one does, not which is right.
    /// </summary>
    public class ReleasePolicyUseCaseTests
    {
        private const string Ksc = "ground:ksc";
        private const string Probe = "vessel:probe";
        private const string Relay = "vessel:relay";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

        private sealed class Links : IDeliveryLinks
        {
            private readonly Dictionary<(string, string), double> _links = new Dictionary<(string, string), double>();

            public void Up(string a, string b, double light)
            {
                _links[(a, b)] = light;
                _links[(b, a)] = light;
            }

            public void Down(string a, string b)
            {
                _links.Remove((a, b));
                _links.Remove((b, a));
            }

            public double? LiveLink(string from, string to) => _links.TryGetValue((from, to), out var l) ? l : (double?)null;

            public double? LivePath(string from, string to) => LiveLink(from, to);
        }

        private sealed class NoPlan : IDeliveryRoutes
        {
            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt) => null;
        }

        private sealed class Rig
        {
            public readonly Links Links = new Links();
            public readonly ManualClock Clock = new ManualClock();
            public readonly List<(string Value, double Ut)> Ran = new List<(string, double)>();
            public readonly DeliveryNetwork Network;

            public Rig(ControlValueRelease release)
            {
                Network = new DeliveryNetwork(Clock, Links, new NoPlan(), (c, ut) => { Ran.Add(((string)c.Args!, ut)); return null; }, _ => { }, release);
            }

            public void Send(double ut, string value, string? channel)
            {
                To(ut);
                Network.SendCommand(Lane, "c", value, "system", channel, ut, null);
            }

            public void To(double ut)
            {
                while (Clock.Now() < ut - 1e-9)
                {
                    var next = System.Math.Min(ut, System.Math.Floor(Clock.Now()) + 1.0);
                    Clock.AdvanceTo(next);
                    Network.Tick(next);
                }
            }
        }

        public static IEnumerable<object[]> Policies() => new[]
        {
            new object[] { ControlValueRelease.RunEvery },
            new object[] { ControlValueRelease.LatestWins },
            new object[] { ControlValueRelease.TimeShifted },
        };

        /// <summary>Throttle to 1 for 30 s, then back to 0, all sent while dark and released together at 100.</summary>
        [Theory]
        [MemberData(nameof(Policies))]
        public void AThrottlePulse(ControlValueRelease release)
        {
            var rig = new Rig(release);
            rig.Send(0.0, "throttle 1", "throttle");
            rig.Send(30.0, "throttle 0", "throttle");
            rig.To(99.0);
            rig.Links.Up(Ksc, Probe, 0.5);
            rig.To(200.0);

            var ran = rig.Ran.Select(r => r.Value + " @" + r.Ut).ToArray();
            switch (release)
            {
                case ControlValueRelease.RunEvery:
                    // A burst: the engine is at 1 for no time at all.
                    Assert.Equal(new[] { "throttle 1 @100.5", "throttle 0 @100.5" }, ran);
                    break;
                case ControlValueRelease.LatestWins:
                    // Only the 0 arrives: the engine never fires.
                    Assert.Equal(new[] { "throttle 0 @100.5" }, ran);
                    break;
                case ControlValueRelease.TimeShifted:
                    // The pulse keeps its 30 s, shifted by the wait.
                    Assert.Equal(new[] { "throttle 1 @100.5", "throttle 0 @130.5" }, ran);
                    break;
            }
        }

        /// <summary>A robotic arm steered round an obstacle: five waypoints 5 s apart, held and released together.</summary>
        [Theory]
        [MemberData(nameof(Policies))]
        public void AnArmPath(ControlValueRelease release)
        {
            var rig = new Rig(release);
            for (var i = 0; i < 5; i++)
            {
                rig.Send(i * 5.0, "arm " + i, "arm");
            }
            rig.To(59.0);
            rig.Links.Up(Ksc, Probe, 1.0);
            rig.To(200.0);

            var times = rig.Ran.Select(r => r.Ut).ToArray();
            switch (release)
            {
                case ControlValueRelease.RunEvery:
                    Assert.Equal(5, times.Length);
                    Assert.All(times, t => Assert.Equal(61.0, t));
                    break;
                case ControlValueRelease.LatestWins:
                    Assert.Equal(new[] { "arm 4" }, rig.Ran.Select(r => r.Value).ToArray());
                    break;
                case ControlValueRelease.TimeShifted:
                    Assert.Equal(new[] { 61.0, 66.0, 71.0, 76.0, 81.0 }, times);
                    break;
            }
        }

        /// <summary>SAS switched to hold, then three small attitude trims, all held: the discrete command keeps its place ahead of the trims.</summary>
        [Theory]
        [MemberData(nameof(Policies))]
        public void AttitudeHoldUnderSas(ControlValueRelease release)
        {
            var rig = new Rig(release);
            rig.Send(0.0, "sas stability", null);
            rig.Send(2.0, "pitch 0.1", "pitch");
            rig.Send(4.0, "pitch 0.0", "pitch");
            rig.Send(6.0, "pitch -0.1", "pitch");
            rig.To(49.0);
            rig.Links.Up(Ksc, Probe, 1.0);
            rig.To(200.0);

            Assert.Equal("sas stability", rig.Ran.First().Value);
            if (release == ControlValueRelease.TimeShifted)
            {
                Assert.Equal(new[] { 51.0, 53.0, 55.0, 57.0 }, rig.Ran.Select(r => r.Ut).ToArray());
            }
            if (release == ControlValueRelease.LatestWins)
            {
                Assert.Equal(new[] { "sas stability", "pitch -0.1" }, rig.Ran.Select(r => r.Value).ToArray());
            }
        }

        /// <summary>
        /// A span that crosses a hold boundary part-way: the first two values go
        /// out live, the link drops, the next two are held until it returns.
        /// </summary>
        [Theory]
        [MemberData(nameof(Policies))]
        public void ASpanThatCrossesAHoldBoundary(ControlValueRelease release)
        {
            var rig = new Rig(release);
            rig.Links.Up(Ksc, Probe, 1.0);
            rig.Send(0.0, "v0", "throttle");
            rig.Send(10.0, "v1", "throttle");
            rig.To(12.0);
            rig.Links.Down(Ksc, Probe);
            rig.Send(20.0, "v2", "throttle");
            rig.Send(30.0, "v3", "throttle");
            rig.To(99.0);
            rig.Links.Up(Ksc, Probe, 1.0);
            rig.To(300.0);

            var ran = rig.Ran.Select(r => r.Value + " @" + r.Ut).ToArray();
            Assert.Equal("v0 @1", ran[0]);
            Assert.Equal("v1 @11", ran[1]);
            switch (release)
            {
                case ControlValueRelease.RunEvery:
                    Assert.Equal(new[] { "v2 @101", "v3 @101" }, ran.Skip(2).ToArray());
                    break;
                case ControlValueRelease.LatestWins:
                    Assert.Equal(new[] { "v3 @101" }, ran.Skip(2).ToArray());
                    break;
                case ControlValueRelease.TimeShifted:
                    Assert.Equal(new[] { "v2 @101", "v3 @111" }, ran.Skip(2).ToArray());
                    break;
            }
        }

        /// <summary>
        /// Two spans released at different times: the first opens at 100 and the
        /// second, sent after it, is held until 400.
        /// </summary>
        [Theory]
        [MemberData(nameof(Policies))]
        public void TwoSpansReleasedAtDifferentTimes(ControlValueRelease release)
        {
            var rig = new Rig(release);
            rig.Send(0.0, "a0", "throttle");
            rig.Send(5.0, "a1", "throttle");
            rig.To(99.0);
            rig.Links.Up(Ksc, Probe, 1.0);
            rig.To(150.0);
            rig.Links.Down(Ksc, Probe);
            rig.Send(200.0, "b0", "throttle");
            rig.Send(205.0, "b1", "throttle");
            rig.To(399.0);
            rig.Links.Up(Ksc, Probe, 1.0);
            rig.To(600.0);

            var ran = rig.Ran.Select(r => r.Value + " @" + r.Ut).ToArray();
            switch (release)
            {
                case ControlValueRelease.RunEvery:
                    Assert.Equal(new[] { "a0 @101", "a1 @101", "b0 @401", "b1 @401" }, ran);
                    break;
                case ControlValueRelease.LatestWins:
                    Assert.Equal(new[] { "a1 @101", "b1 @401" }, ran);
                    break;
                case ControlValueRelease.TimeShifted:
                    // Each span keeps its own 5 s; the gap between them is the second wait, not the original 195 s.
                    Assert.Equal(new[] { "a0 @101", "a1 @106", "b0 @401", "b1 @406" }, ran);
                    break;
            }
        }
    }
}
