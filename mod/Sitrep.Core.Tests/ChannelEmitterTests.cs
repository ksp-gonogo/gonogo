using System.Collections.Generic;
using Xunit;
using Sitrep.Core;
using Sitrep.Contract;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-only tests for <see cref="ChannelEmitter"/> / <see cref="EmissionPolicy"/>
    /// (streaming-slice-1 Track A) -- no TS reference, no golden fixture,
    /// same rationale as <see cref="CourierTimelineResetTests"/>: this is
    /// new logic invented on the C# side, not a port.
    /// </summary>
    public class ChannelEmitterTests
    {
        private static EmissionPolicy Policy(
            double keyframeIntervalUt,
            EmissionQuantum quantum,
            double minSampleIntervalUt = 0,
            double maxRateIntervalUt = 0)
        {
            return new EmissionPolicy(keyframeIntervalUt, quantum, minSampleIntervalUt, maxRateIntervalUt);
        }

        [Fact]
        public void StaticValueEmitsExactlyOneKeyframeAndNoChangeEmissions()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 100, quantum: EmissionQuantum.Absolute(1)));

            var first = emitter.Decide("v.altitude", 1000.0, 0);
            Assert.True(first.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, first.Reason);

            // Value never changes, and we stay well inside the keyframe
            // interval -- every subsequent call must skip.
            for (double ut = 10; ut <= 90; ut += 10)
            {
                var decision = emitter.Decide("v.altitude", 1000.0, ut);
                Assert.False(decision.ShouldEmit);
            }

            var counters = emitter.CountersFor("v.altitude");
            Assert.Equal(1, counters.Emitted);
            Assert.Equal(10, counters.Considered); // ut=0,10,...,90
        }

        [Fact]
        public void SubQuantumChangeIsSuppressed()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe

            var decision = emitter.Decide("v.altitude", 1003.0, 1); // |Δ|=3 < quantum=5
            Assert.False(decision.ShouldEmit);
        }

        [Fact]
        public void CrossingQuantumEmitsAsChange()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe

            var decision = emitter.Decide("v.altitude", 1010.0, 1); // |Δ|=10 > quantum=5
            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Change, decision.Reason);
            Assert.Equal(1010.0, decision.Value);
        }

        [Fact]
        public void KeyframeFiresOnKeyframeIntervalEvenWithoutChange()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 50, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe #1

            // Same value, but exactly one keyframe interval later -- must
            // still emit, unconditionally, as a Keyframe (not a Change).
            var decision = emitter.Decide("v.altitude", 1000.0, 50);
            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, decision.Reason);

            Assert.Equal(2, emitter.CountersFor("v.altitude").Emitted);
        }

        [Fact]
        public void NotifySubscribedForcesAnImmediateOutOfCadenceKeyframe()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe #1, arms cadence out to ut=1000

            // Nowhere near due for another keyframe or a change -- without
            // NotifySubscribed this would skip.
            emitter.NotifySubscribed("v.altitude");
            var decision = emitter.Decide("v.altitude", 1000.0, 5);

            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, decision.Reason);
        }

        [Fact]
        public void ResetForcesKeyframeOnEveryKnownChannelRegardlessOfCadence()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 20);
            emitter.Decide("v.velocity", 50.0, 20);

            // Both channels are nowhere near due for another keyframe.
            emitter.Reset(3); // e.g. a quickload back to UT 3

            var altitude = emitter.Decide("v.altitude", 1000.0, 3);
            var velocity = emitter.Decide("v.velocity", 50.0, 3);

            Assert.True(altitude.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, altitude.Reason);
            Assert.True(velocity.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, velocity.Reason);
        }

        [Fact]
        public void UnsubscribedChannelNeverReachesDecideAndEmitsNothing()
        {
            // Demonstrates the documented outer/inner gate composition:
            // SubscriptionRegistry.IsSubscribed guards every call site that
            // would otherwise reach ChannelEmitter.Decide.
            var registry = new SubscriptionRegistry();
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 10, quantum: EmissionQuantum.Absolute(1)));

            var emittedCount = 0;
            for (double ut = 0; ut <= 100; ut += 5)
            {
                if (!registry.IsSubscribed("v.altitude"))
                {
                    continue;
                }
                var decision = emitter.Decide("v.altitude", ut, ut);
                if (decision.ShouldEmit)
                {
                    emittedCount += 1;
                }
            }

            Assert.False(registry.IsSubscribed("v.altitude"));
            Assert.Equal(0, emittedCount);
            // Never even considered -- Decide was never called.
            Assert.Equal(0, emitter.CountersFor("v.altitude").Considered);
        }

        [Fact]
        public void MaxRateClampIsHonoredUnderRapidChange()
        {
            var emitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000, // never due within this test's window
                quantum: EmissionQuantum.Absolute(0.01), // trivially cleared by every step
                minSampleIntervalUt: 0,
                maxRateIntervalUt: 1.0));

            emitter.Decide("v.rapid", 0.0, 0); // keyframe @ ut=0

            var emittedUts = new System.Collections.Generic.List<double>();
            for (double ut = 0.1; ut <= 5.0; ut += 0.1)
            {
                var decision = emitter.Decide("v.rapid", ut * 100, ut); // huge delta every call
                if (decision.ShouldEmit)
                {
                    emittedUts.Add(decision.Ut);
                }
            }

            // ~50 considered calls at 0.1 UT apart, but the clamp caps
            // change emissions to roughly one per 1.0 UT.
            Assert.True(emittedUts.Count <= 6, $"expected clamp to bound emissions, got {emittedUts.Count}");

            for (var i = 1; i < emittedUts.Count; i++)
            {
                Assert.True(
                    emittedUts[i] - emittedUts[i - 1] >= 1.0 - 1e-9,
                    $"emissions at {emittedUts[i - 1]} and {emittedUts[i]} are closer than the 1.0 UT clamp");
            }
        }

        [Fact]
        public void PercentOfRangeQuantumAndAbsoluteQuantumBothWork()
        {
            var percentEmitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000,
                quantum: EmissionQuantum.PercentOfRange(0.05, rangeMin: 0, rangeMax: 100))); // 5% of 100 = 5

            percentEmitter.Decide("v.percent", 50.0, 0); // keyframe
            Assert.False(percentEmitter.Decide("v.percent", 54.0, 1).ShouldEmit); // Δ=4 < 5
            Assert.True(percentEmitter.Decide("v.percent", 56.0, 2).ShouldEmit); // Δ=6 > 5 (from last EMITTED value 50)

            var absoluteEmitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000,
                quantum: EmissionQuantum.Absolute(5)));

            absoluteEmitter.Decide("v.absolute", 50.0, 0); // keyframe
            Assert.False(absoluteEmitter.Decide("v.absolute", 54.0, 1).ShouldEmit); // Δ=4 < 5
            Assert.True(absoluteEmitter.Decide("v.absolute", 56.0, 2).ShouldEmit); // Δ=6 > 5
        }

        [Fact]
        public void DiscreteStructuredValueEmitsOnNotEqualIgnoringQuantum()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(9999)));

            emitter.Decide("f.sas", "Off", 0); // keyframe

            Assert.False(emitter.Decide("f.sas", "Off", 1).ShouldEmit); // unchanged
            var decision = emitter.Decide("f.sas", "StabilityAssist", 2); // changed (discrete, not-equal)
            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Change, decision.Reason);
        }

        [Fact]
        public void KeyframeCadenceFiresIndependentlyOfMinSampleGate()
        {
            // Regression for the critical review fix: a due keyframe must
            // not be delayed by MinSampleIntervalUt, even when
            // MinSampleIntervalUt >= KeyframeIntervalUt. Against the OLD gate
            // order (min-sample checked before keyframe-due), the keyframe
            // due at ut=50 would have been skipped -- the min-sample gate
            // (100 UT) would have swallowed the call entirely -- and the
            // keyframe would not fire until ut=100.
            var emitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 50,
                quantum: EmissionQuantum.Absolute(9999), // value never changes anyway
                minSampleIntervalUt: 100));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe #1

            EmissionDecision? keyframeAt50 = null;
            for (double ut = 10; ut <= 90; ut += 10)
            {
                var decision = emitter.Decide("v.altitude", 1000.0, ut); // unchanged value
                if (decision.ShouldEmit)
                {
                    Assert.Null(keyframeAt50); // only expect exactly one emission in this loop
                    keyframeAt50 = decision;
                    Assert.Equal(50, ut);
                }
            }

            Assert.NotNull(keyframeAt50);
            Assert.Equal(EmissionReason.Keyframe, keyframeAt50!.Value.Reason);
            Assert.Equal(50, keyframeAt50.Value.Ut);
        }

        [Fact]
        public void HugeUtJumpUnderTimeWarpEmitsExactlyOneCatchUpKeyframeWithoutStalling()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 50, quantum: EmissionQuantum.Absolute(1)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe #1

            // A single Decide call after a massive time-warp UT jump (e.g.
            // physics catching up after 4x-10,000x warp) must emit exactly
            // one catch-up keyframe -- LastKeyframeUt is stamped directly to
            // the new ut, not back-filled with a keyframe per missed
            // interval -- and must not throw / stall.
            var decision = emitter.Decide("v.altitude", 1000.0, 100000);

            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, decision.Reason);
            Assert.Equal(100000, decision.Ut);
            Assert.Equal(2, emitter.CountersFor("v.altitude").Emitted);

            // Immediately after, nowhere near due for another keyframe or
            // change -- confirms no runaway/burst state was left behind.
            var next = emitter.Decide("v.altitude", 1000.0, 100010);
            Assert.False(next.ShouldEmit);
        }

        [Fact]
        public void ByteAndUintChannelsGoThroughDeadbandQuantum()
        {
            var byteEmitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));
            byteEmitter.Decide("v.byte", (byte)100, 0); // keyframe
            Assert.False(byteEmitter.Decide("v.byte", (byte)103, 1).ShouldEmit); // |Δ|=3 < 5
            Assert.True(byteEmitter.Decide("v.byte", (byte)110, 2).ShouldEmit); // |Δ|=10 > 5

            var uintEmitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));
            uintEmitter.Decide("v.uint", 1000u, 0); // keyframe
            Assert.False(uintEmitter.Decide("v.uint", 1003u, 1).ShouldEmit); // |Δ|=3 < 5
            Assert.True(uintEmitter.Decide("v.uint", 1010u, 2).ShouldEmit); // |Δ|=10 > 5

            var sbyteEmitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));
            sbyteEmitter.Decide("v.sbyte", (sbyte)-10, 0); // keyframe
            Assert.False(sbyteEmitter.Decide("v.sbyte", (sbyte)-8, 1).ShouldEmit); // |Δ|=2 < 5

            var ulongEmitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));
            ulongEmitter.Decide("v.ulong", 1000ul, 0); // keyframe
            Assert.False(ulongEmitter.Decide("v.ulong", 1003ul, 1).ShouldEmit); // |Δ|=3 < 5
            Assert.True(ulongEmitter.Decide("v.ulong", 1010ul, 2).ShouldEmit); // |Δ|=10 > 5
        }

        [Fact]
        public void PurelyUtDrivenRepeatedCallsAtTheSameUtNeverReEmit()
        {
            var emitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000,
                quantum: EmissionQuantum.Absolute(0.0001),
                minSampleIntervalUt: 1.0));

            var first = emitter.Decide("v.altitude", 1000.0, 5);
            Assert.True(first.ShouldEmit);

            // UT never advances past 5 again, no matter how many times or
            // how drastically the value changes between calls -- this must
            // never emit again. If this were wall-clock driven instead of
            // UT-driven, a rapid burst of calls at the same ut would still
            // trip the deadband/keyframe logic; it must not.
            for (var i = 0; i < 25; i++)
            {
                var decision = emitter.Decide("v.altitude", 1000.0 + i * 1000, 5);
                Assert.False(decision.ShouldEmit);
            }

            var counters = emitter.CountersFor("v.altitude");
            Assert.Equal(1, counters.Emitted);
            Assert.Equal(26, counters.Considered);
        }

        /// <summary>
        /// The shape every <c>*ViewProvider</c> mapper hands back: a
        /// dictionary/list/scalar tree, rebuilt from scratch on every call.
        /// Nothing here is cached, exactly as
        /// <c>SystemViewProvider.BuildSystemBodies</c> is not.
        /// </summary>
        private static Dictionary<string, object?> BuildBodiesPayload()
        {
            return new Dictionary<string, object?>
            {
                ["bodies"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Earth",
                        ["index"] = 1,
                        ["parentIndex"] = 0,
                        ["radius"] = 6371000.0,
                        ["orbit"] = new Dictionary<string, object?>
                        {
                            ["sma"] = 149598261150.0,
                            ["ecc"] = 0.0167,
                            ["lan"] = (double?)null,
                        },
                        ["atmosphere"] = new Dictionary<string, object?>
                        {
                            ["depth"] = 140000.0,
                            ["hasOxygen"] = true,
                            ["pressureAltitudes"] = new double[] { 0, 1000, 2000 },
                        },
                    },
                },
            };
        }

        [Fact]
        public void StructurallyIdenticalStructuredPayloadIsSuppressed()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)));

            var first = emitter.Decide("system.bodies", BuildBodiesPayload(), 0);
            Assert.True(first.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, first.Reason);

            /*
             * The 1 Hz steady state the deck capture records: the body set has
             * not moved, so every one of these rebuilt-but-identical payloads
             * must skip. Reference equality reads all 29 as changed, which is
             * how system.bodies came to be 82% of the stream's bytes.
             */
            for (var ut = 1; ut < 30; ut++)
            {
                var decision = emitter.Decide("system.bodies", BuildBodiesPayload(), ut);
                Assert.False(decision.ShouldEmit, $"expected a skip at ut={ut}");
            }

            Assert.Equal(1, emitter.CountersFor("system.bodies").Emitted);
        }

        [Fact]
        public void StructuredPayloadStillEmitsWhenAnyLeafMoves()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)));

            emitter.Decide("system.bodies", BuildBodiesPayload(), 0); // keyframe

            var moved = BuildBodiesPayload();
            var body = (Dictionary<string, object?>)((List<object?>)moved["bodies"]!)[0]!;
            var orbit = (Dictionary<string, object?>)body["orbit"]!;
            orbit["ecc"] = 0.0168;

            var decision = emitter.Decide("system.bodies", moved, 1);
            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Change, decision.Reason);
        }

        [Fact]
        public void SuppressedStructuredPayloadStillGetsItsKeyframe()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)));

            emitter.Decide("system.bodies", BuildBodiesPayload(), 0); // keyframe #1

            for (var ut = 1; ut < 30; ut++)
            {
                Assert.False(emitter.Decide("system.bodies", BuildBodiesPayload(), ut).ShouldEmit);
            }

            var keyframe = emitter.Decide("system.bodies", BuildBodiesPayload(), 30);
            Assert.True(keyframe.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, keyframe.Reason);
        }

        /// <summary>
        /// The control for the two tests above: handing back the SAME instance
        /// was always suppressed, because <c>Equals</c> on one reference is
        /// true. Only a rebuilt-but-identical payload read as changed, which
        /// pins the defect on reference identity rather than on the gate's
        /// ordering or its cadence.
        /// </summary>
        [Fact]
        public void HandingBackTheSameInstanceWasNeverTheProblem()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)));
            var payload = BuildBodiesPayload();

            emitter.Decide("system.bodies", payload, 0); // keyframe

            for (var ut = 1; ut < 30; ut++)
            {
                Assert.False(emitter.Decide("system.bodies", payload, ut).ShouldEmit);
            }
        }

        [Fact]
        public void EventLaneRepeatIsNotSuppressed()
        {
            /*
             * A terminal downlink's frame shape: a processor printing the same
             * line twice publishes two structurally identical payloads, and
             * both have to reach the screen. The engine passes repeatIsData
             * for every Delivery.ReliableOrdered channel for exactly this.
             */
            static Dictionary<string, object?> Frame() => new Dictionary<string, object?>
            {
                ["coreId"] = 1,
                ["chunk"] = "PROGRAM ENDED.\n",
                ["fullRepaint"] = false,
            };

            var emitter = new ChannelEmitter(
                _ => Policy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                _ => true);

            emitter.Decide("terminal.screen.1", Frame(), 0); // keyframe

            var repeat = emitter.Decide("terminal.screen.1", Frame(), 1);
            Assert.True(repeat.ShouldEmit);
            Assert.Equal(EmissionReason.Change, repeat.Reason);
        }

        /// <summary>
        /// A payload that counts every structural read of itself, so a test can
        /// see whether the gate actually compared it.
        /// </summary>
        private sealed class CountingPayload : Dictionary<string, object?>
        {
            public static int Reads;

            public CountingPayload(int tick)
            {
                this["tick"] = new CountingLeaf(tick);
            }

            private sealed class CountingLeaf
            {
                private readonly int _tick;

                public CountingLeaf(int tick) => _tick = tick;

                public override bool Equals(object? obj)
                {
                    Reads += 1;
                    return obj is CountingLeaf other && other._tick == _tick;
                }

                public override int GetHashCode() => _tick;
            }
        }

        [Fact]
        public void AValueThatChangesEveryTickStopsBeingCompared()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 100000, quantum: EmissionQuantum.Absolute(0)));

            emitter.Decide("vessel.flight", new CountingPayload(0), 0); // keyframe
            CountingPayload.Reads = 0;

            for (var ut = 1; ut <= 100; ut++)
            {
                Assert.True(emitter.Decide("vessel.flight", new CountingPayload(ut), ut).ShouldEmit);
            }

            /*
             * 100 considerations, every one of them a real change. Compared
             * naively that is 100 reads; the adaptive gate settles at one per
             * skip run, so the cost lands an order of magnitude below the
             * consideration count. Asserted as a bound rather than an exact
             * figure so retuning the run lengths does not rewrite the test.
             */
            Assert.InRange(CountingPayload.Reads, 1, 20);
        }

        [Fact]
        public void AValueThatGoesQuietIsPickedBackUp()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 100000, quantum: EmissionQuantum.Absolute(0)));

            emitter.Decide("vessel.flight", new CountingPayload(0), 0); // keyframe

            // Churn hard enough that the gate has stopped comparing.
            for (var ut = 1; ut <= 100; ut++)
            {
                emitter.Decide("vessel.flight", new CountingPayload(ut), ut);
            }

            /*
             * Now it holds still. The next probe has to notice and hand the
             * value back to full comparison, well inside the keyframe interval,
             * rather than writing it off for having churned earlier.
             */
            var suppressedFrom = 0;
            for (var ut = 101; ut <= 140; ut++)
            {
                if (!emitter.Decide("vessel.flight", new CountingPayload(999), ut).ShouldEmit)
                {
                    suppressedFrom = ut;
                    break;
                }
            }

            Assert.InRange(suppressedFrom, 102, 120);

            // And it stays suppressed: no relapse into assuming it moves.
            for (var ut = suppressedFrom + 1; ut <= 200; ut++)
            {
                Assert.False(emitter.Decide("vessel.flight", new CountingPayload(999), ut).ShouldEmit);
            }
        }

        [Fact]
        public void TimelineResetDropsTheChurnObservation()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 100000, quantum: EmissionQuantum.Absolute(0)));

            emitter.Decide("vessel.flight", new CountingPayload(0), 0);
            for (var ut = 1; ut <= 100; ut++)
            {
                emitter.Decide("vessel.flight", new CountingPayload(ut), ut);
            }

            emitter.Reset(0);

            // Post-rewind: keyframe, then the very next identical payload is
            // compared and suppressed, with no leftover skip run to sit out.
            var keyframe = emitter.Decide("vessel.flight", new CountingPayload(7), 0);
            Assert.True(keyframe.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, keyframe.Reason);

            Assert.False(emitter.Decide("vessel.flight", new CountingPayload(7), 1).ShouldEmit);
        }
    }
}
