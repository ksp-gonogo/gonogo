using System.Collections.Generic;
using System.Linq;
using Xunit;
using Sitrep.Core;
using Sitrep.Contract;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// How long a capture has to be before it can contain a frame from a
    /// channel whose payload never moves.
    ///
    /// <para>A capture of <c>vessel.maneuver</c> once delivered zero frames in
    /// 20 seconds while <c>vessel.orbit</c> delivered in the same window, and
    /// that stood as an anomaly with a list of eliminated explanations. One of
    /// the eliminations read "an empty control emits an empty node list at
    /// ~1 Hz", which asserts an emission RATE from an observed SAMPLING rate.
    /// The two are different numbers. Under
    /// <c>EmissionPolicy(keyframeIntervalUt: 30, quantum: Absolute(0))</c> a
    /// zero deadband declines an unchanged payload, so a channel with nothing
    /// queued rebuilds a structurally identical payload every tick and its only
    /// emissions are keyframes: one per 30 UT, whatever the tick rate. A 20
    /// second capture at 1x is 20 UT, which is shorter than the cadence, so
    /// zero frames is the correct answer rather than a fault.</para>
    ///
    /// <para>These tests pin that arithmetic, with a channel that DOES move
    /// every tick as the control: without it "few emissions" would be
    /// indistinguishable from an emitter that had stopped.</para>
    ///
    /// <para>The reading that produced the paragraph above is right about the
    /// steady state and wrong about the start of a capture, which
    /// <see cref="AFreshSubscriberGetsAKeyframeInsideAWindowTooShortToContainOne"/>
    /// records: a genuine 0 to 1 subscribe forces an out-of-cadence keyframe
    /// (<see cref="ChannelEmitter.NotifySubscribed"/>), so a capture that opens
    /// by subscribing carries one frame however short it is. Cadence alone
    /// therefore does not explain a capture that saw NOTHING; it explains a
    /// capture that saw only the joining frame and then went quiet.</para>
    ///
    /// <para>Emission cadence is one of several reasons a vessel channel can
    /// look silent, and a diagnostic reading <c>considered: 0</c> does not on
    /// its own separate them. A 120 second live capture against the deck with
    /// the game at the space centre and no active vessel returned only a
    /// subscribe ACK on both <c>vessel.maneuver</c> and <c>vessel.orbit</c>
    /// while an ungated TrueNow channel delivered 103 frames: with no subject,
    /// the mapper returns null and an unborn channel is skipped BEFORE
    /// <c>Decide</c> is reached, so nothing is ever considered. Which vantage
    /// the capture was taken from has to be known before a count means
    /// anything.</para>
    /// </summary>
    public class KeyframeCaptureWindowTests
    {
        private const double KeyframeIntervalUt = 30;

        /// <summary>
        /// The live policy every vessel channel is declared with: a keyframe
        /// every 30 UT and a zero deadband, so an unchanged payload is
        /// declined and nothing throttles a changed one.
        /// </summary>
        private static EmissionPolicy VesselPolicy()
        {
            return new EmissionPolicy(KeyframeIntervalUt, EmissionQuantum.Absolute(0));
        }

        /// <summary>
        /// The shape an empty maneuver control produces: a payload rebuilt from
        /// scratch each tick, structurally identical every time because there is
        /// nothing queued to differ.
        /// </summary>
        private static Dictionary<string, object?> EmptyManeuverPayload()
        {
            return new Dictionary<string, object?>
            {
                ["nodes"] = new List<object?>(),
                ["count"] = 0,
                ["nextBurnUt"] = null,
            };
        }

        /// <summary>
        /// The control's shape: an orbit payload whose leaves move on every
        /// tick, as a real orbit's do.
        /// </summary>
        private static Dictionary<string, object?> MovingOrbitPayload(double ut)
        {
            return new Dictionary<string, object?>
            {
                ["trueAnomaly"] = ut * 0.37,
                ["altitude"] = 120000.0 + ut,
                ["velocity"] = new Dictionary<string, object?>
                {
                    ["orbital"] = 2287.4 + (ut * 0.11),
                },
            };
        }

        [Fact]
        public void AnUnchangingChannelEmitsOnlyKeyframesAndOnlyOnTheKeyframeCadence()
        {
            var emitter = new ChannelEmitter(VesselPolicy());
            var emissions = new List<EmissionDecision>();

            // 121 ticks at 1 Hz, 1x warp: 120 UT of capture, four keyframe
            // intervals wide.
            for (var ut = 0; ut <= 120; ut++)
            {
                var decision = emitter.Decide("vessel.maneuver", EmptyManeuverPayload(), ut);
                if (decision.ShouldEmit)
                {
                    emissions.Add(decision);
                }
            }

            Assert.All(emissions, e => Assert.Equal(EmissionReason.Keyframe, e.Reason));
            Assert.Equal(new double[] { 0, 30, 60, 90, 120 }, emissions.Select(e => e.Ut).ToArray());

            var counters = emitter.CountersFor("vessel.maneuver");
            Assert.Equal(121, counters.Considered);
            Assert.Equal(5, counters.Emitted);
        }

        /// <summary>
        /// The control for the test above. Same policy, same tick count, same
        /// channel shape; only the payload differs, so the five emissions there
        /// are attributable to the payload holding still and not to the emitter
        /// having gone quiet.
        /// </summary>
        [Fact]
        public void AChannelWhosePayloadMovesEveryTickEmitsOnEveryTickUnderTheSamePolicy()
        {
            var emitter = new ChannelEmitter(VesselPolicy());
            var emissions = new List<EmissionDecision>();

            for (var ut = 0; ut <= 120; ut++)
            {
                var decision = emitter.Decide("vessel.orbit", MovingOrbitPayload(ut), ut);
                if (decision.ShouldEmit)
                {
                    emissions.Add(decision);
                }
            }

            var counters = emitter.CountersFor("vessel.orbit");
            Assert.Equal(121, counters.Considered);
            Assert.Equal(121, counters.Emitted);

            // The cadence keyframes still land on their own schedule inside the
            // change stream, so the two channels differ in the emissions
            // BETWEEN keyframes and nowhere else.
            Assert.Equal(
                new double[] { 0, 30, 60, 90, 120 },
                emissions.Where(e => e.Reason == EmissionReason.Keyframe).Select(e => e.Ut).ToArray());
            Assert.Equal(116, emissions.Count(e => e.Reason == EmissionReason.Change));
        }

        /// <summary>
        /// The anomaly itself, as arithmetic: an established subscriber
        /// capturing a shorter span than the keyframe interval records nothing,
        /// because there is no keyframe due inside the window and the payload
        /// never clears the deadband.
        /// </summary>
        [Fact]
        public void ACaptureShorterThanTheKeyframeIntervalContainsNoFrameAtAll()
        {
            var emitter = new ChannelEmitter(VesselPolicy());

            // Establish the subscriber: the joining keyframe at ut 0, then run
            // on to the next one so the capture below opens on a fresh cadence
            // boundary, the most favourable start it could have.
            for (var ut = 0; ut <= KeyframeIntervalUt; ut++)
            {
                emitter.Decide("vessel.maneuver", EmptyManeuverPayload(), ut);
            }
            var beforeCapture = emitter.CountersFor("vessel.maneuver").Emitted;

            const double CaptureSeconds = 20;
            for (var ut = KeyframeIntervalUt + 1; ut <= KeyframeIntervalUt + CaptureSeconds; ut++)
            {
                emitter.Decide("vessel.maneuver", EmptyManeuverPayload(), ut);
            }

            var duringCapture = emitter.CountersFor("vessel.maneuver").Emitted - beforeCapture;
            Assert.True(
                duringCapture == 0,
                $"A capture window of {CaptureSeconds} UT opening on a cadence boundary cannot contain a "
                    + $"keyframe when the keyframe interval is {KeyframeIntervalUt} UT: none is due before "
                    + "the window ends, and an unchanging payload emits nothing else, so zero frames is the "
                    + $"correct result and not evidence of a broken channel. Got {duringCapture}.");

            // The channel is alive throughout, and says so as soon as the
            // window is long enough to prove it: 20 considerations inside the
            // capture that emitted nothing, and the next keyframe waiting 10 UT
            // past the end of it.
            Assert.Equal(51, emitter.CountersFor("vessel.maneuver").Considered);
            var pastTheWindow = emitter.Decide("vessel.maneuver", EmptyManeuverPayload(), KeyframeIntervalUt * 2);
            Assert.True(pastTheWindow.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, pastTheWindow.Reason);
        }

        /// <summary>
        /// The correction to "a 20 UT capture is structurally too short to
        /// contain a keyframe": true of an established subscriber, false of one
        /// that joins inside the window. A 0 to 1 subscribe re-arms the forced
        /// keyframe, which bypasses cadence and deadband both, so the first
        /// consideration after joining emits whatever the clock says. A short
        /// capture that opened by subscribing and saw NOTHING was therefore
        /// never considered at all, and the cause lies upstream of this class.
        /// </summary>
        [Fact]
        public void AFreshSubscriberGetsAKeyframeInsideAWindowTooShortToContainOne()
        {
            var emitter = new ChannelEmitter(VesselPolicy());

            for (var ut = 0; ut <= 100; ut++)
            {
                emitter.Decide("vessel.maneuver", EmptyManeuverPayload(), ut);
            }
            var beforeJoin = emitter.CountersFor("vessel.maneuver").Emitted;

            emitter.NotifySubscribed("vessel.maneuver");

            var joining = emitter.Decide("vessel.maneuver", EmptyManeuverPayload(), 101);
            Assert.True(joining.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, joining.Reason);

            // One frame, and then the cadence takes over again: the rest of a
            // 20 UT window stays silent.
            for (var ut = 102; ut <= 121; ut++)
            {
                Assert.False(emitter.Decide("vessel.maneuver", EmptyManeuverPayload(), ut).ShouldEmit);
            }
            Assert.Equal(beforeJoin + 1, emitter.CountersFor("vessel.maneuver").Emitted);
        }
    }
}
