using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="CommsModelPolicy"/>: what gonogo reports on a save whose
    /// stock CommNet difficulty option is off.
    ///
    /// <para>The defect these pin is an INVERSION, not a degradation. With that
    /// option off KSP builds no network, so every <c>CommNetVessel</c> reads
    /// disconnected with an empty path for the whole session; gonogo read that
    /// literally and froze every Delayed channel forever, which is infinite
    /// delay on a save that is supposed to have none at all.</para>
    /// </summary>
    public class CommsModelPolicyTests
    {
        private static SignalDelayConfig On() =>
            new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        [Fact]
        public void ModelPresent_LeavesTheConfigAlone()
        {
            var authored = On();

            Assert.Same(authored, CommsModelPolicy.Effective(authored, modelPresent: true));
        }

        /// <summary>
        /// Unknown is not "absent". No save is loaded yet, or the difficulty
        /// read threw; inferring "no comms model" from that would switch a real
        /// career's delay off on a bad tick.
        /// </summary>
        [Fact]
        public void ModelUnknown_LeavesTheConfigAlone()
        {
            var authored = On();

            Assert.Same(authored, CommsModelPolicy.Effective(authored, modelPresent: null));
        }

        [Fact]
        public void ModelAbsent_CutsTheDelayAndSaysWhy()
        {
            var effective = CommsModelPolicy.Effective(On(), modelPresent: false);

            Assert.False(effective.Enabled);
            Assert.True(effective.CutForNoCommsModel);
        }

        /// <summary>
        /// The cut carries a REASON even when delay was already off, which is
        /// the whole point of deriving a config rather than returning a bool: a
        /// save with no comms model has to be tellable from one whose operator
        /// simply never turned delay on.
        /// </summary>
        [Fact]
        public void ModelAbsent_CutsEvenWhenDelayWasAlreadyOff()
        {
            var effective = CommsModelPolicy.Effective(SignalDelayConfig.Off(), modelPresent: false);

            Assert.True(effective.CutForNoCommsModel);
        }

        /// <summary>
        /// A POSITIVE, KNOWN zero, never a null. Null on
        /// <see cref="CommsDelay.OneWaySeconds"/> means "there is a comms model
        /// and it can measure nothing right now", which is a blackout, and a
        /// client reading this save's board must not be told that.
        /// </summary>
        [Fact]
        public void ModelAbsent_ReportsAKnownZeroDelayNamingItsOwnReason()
        {
            var config = CommsModelPolicy.Effective(On(), modelPresent: false);

            // The empty path a no-comms-model backend reports: on its own that
            // is the unmeasurable case, so this also proves the config cut is
            // what turns it into a known zero.
            var delay = SignalDelay.Compute(config, new CommsPath(), "vessel:x", Quality.Loaded);

            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.NoCommsModel, delay.Source);
        }

        /// <summary>
        /// A blackout on a save that DOES model comms keeps saying what it
        /// always said: nothing measurable. This is the other half of the wire
        /// discriminator, and the reason the two must not share a member.
        /// </summary>
        [Fact]
        public void AGenuineBlackoutStillReportsAnUnmeasurableDelay()
        {
            var delay = SignalDelay.Compute(On(), new CommsPath(), "vessel:x", Quality.Loaded);

            Assert.Null(delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.None, delay.Source);
        }

        /// <summary>
        /// Both cuts at once: a rehearsal has no light-time because there is no
        /// craft, this save has none because there is no network, and the
        /// second survives loading a different craft.
        /// </summary>
        [Fact]
        public void NoCommsModel_OutranksTheSimulationCut()
        {
            var simulationCut = new SignalDelayConfig
            {
                Enabled = false,
                CutForSimulation = true,
            };

            var config = CommsModelPolicy.Effective(simulationCut, modelPresent: false);
            var delay = SignalDelay.Compute(config, new CommsPath(), "vessel:x", Quality.Loaded);

            Assert.Equal(CommsDelaySource.NoCommsModel, delay.Source);
        }

        [Fact]
        public void ModelPresent_LeavesTheElectedBackendAlone()
        {
            var elected = new StubBackend(connected: false);

            Assert.Same(
                elected,
                CommsModelPolicy.Effective(elected, modelPresent: true, () => CommsControlSource.Full, () => new PayloadMeta()));
        }

        /// <summary>
        /// The freeze lever. The reveal gate withholds every Delayed channel on
        /// a subject whose connectivity source says false, regardless of the
        /// delay MAGNITUDE, so cutting the delay alone leaves the board frozen.
        /// </summary>
        [Fact]
        public void ModelAbsent_ReportsConnected_OverADeadCommNetGraph()
        {
            var wrapped = Wrap(new StubBackend(connected: false), CommsControlSource.Full);

            Assert.True(wrapped.Connectivity().Connected);
        }

        /// <summary>
        /// Control comes from the craft's own parts, which is where KSP itself
        /// gets it once <c>Vessel.GetControlLevel</c> declines the CommNet
        /// branch. The dead graph underneath says NONE for everything.
        /// </summary>
        [Theory]
        [InlineData(CommsControlSource.Full, CommsControlStateKind.Full, true)]
        [InlineData(CommsControlSource.Partial, CommsControlStateKind.PartialManoeuvre, true)]
        [InlineData(CommsControlSource.None, CommsControlStateKind.None, false)]
        public void ModelAbsent_TakesControlFromTheCraftNotTheLink(
            CommsControlSource local,
            CommsControlStateKind expectedState,
            bool expectedLocalControl)
        {
            var wrapped = Wrap(new StubBackend(connected: false), local);

            Assert.Equal(local, wrapped.Connectivity().ControlSource);
            Assert.Equal(expectedLocalControl, wrapped.Connectivity().HasLocalControl);
            Assert.Equal(expectedState, wrapped.ControlState().State);
        }

        /// <summary>
        /// A refusal has to name its real condition. "No connection to a
        /// command source" is what both real backends say off a disconnected
        /// link, and here there is no connection MODEL rather than a missing
        /// connection, so a craft nothing can command is uncommandable for the
        /// one reason left.
        /// </summary>
        [Fact]
        public void ModelAbsent_NeverBlamesAMissingConnection()
        {
            var uncontrolled = Wrap(new StubBackend(connected: false), CommsControlSource.None);
            var controlled = Wrap(new StubBackend(connected: false), CommsControlSource.Full);

            Assert.Equal("no command source aboard", uncontrolled.ControlState().Reason);
            Assert.Null(controlled.ControlState().Reason);
        }

        /// <summary>
        /// Not zero. The honest answer is that signal strength is not modelled
        /// at all, and the field cannot carry an absence (see
        /// <see cref="NoCommsModelBackend.SignalStrength"/>); of what it CAN
        /// carry, a 0 is the one that lies, because it is exactly what the
        /// app's own signal-loss verdict keys on.
        /// </summary>
        [Fact]
        public void ModelAbsent_NeverReportsAZeroSignalStrength()
        {
            var wrapped = Wrap(new StubBackend(connected: false), CommsControlSource.Full);

            Assert.Equal(1.0, wrapped.SignalStrength().Value);
        }

        [Fact]
        public void ModelAbsent_ReportsNoPathAndNoRelayGraph()
        {
            var wrapped = Wrap(new StubBackend(connected: false), CommsControlSource.Full);

            Assert.Empty(wrapped.Path().Hops);
            Assert.Empty(wrapped.Network().Nodes);
            Assert.Empty(wrapped.Network().Edges);
        }

        /// <summary>
        /// Occlusion describes the bodies, not the link: a consumer drawing a
        /// horizon still wants the real geometry.
        /// </summary>
        [Fact]
        public void ModelAbsent_PassesTheOcclusionModelThrough()
        {
            var inner = new StubBackend(connected: false);

            Assert.Same(inner.OcclusionModel(), Wrap(inner, CommsControlSource.Full).OcclusionModel());
        }

        /// <summary>
        /// A save with no comms model grades the link PRISTINE, as a rated zero
        /// under its own name, and does NOT pass the wrapped backend's grading
        /// through: nothing can attenuate a link that is not modelled, so a
        /// grading taken off the dead CommNet graph underneath would be a reading
        /// of something that is not there.
        ///
        /// <para>The rated zero is also the one place this file can say outright
        /// what <see cref="ModelAbsent_NeverReportsAZeroSignalStrength"/> next door
        /// cannot: signal strength has no way to express an absence and has to
        /// report 1 while explaining that the honest answer is "not graded", and
        /// the rating CAN express one. It still does not, and that is a
        /// judgement rather than a default: "nothing degrades this link" is a
        /// positive fact about the save, exactly as the no-comms-model delay is a
        /// measured zero rather than a null.</para>
        ///
        /// <para>Told apart from a refusal by the id, which is why the stub
        /// deliberately grades 0.75 under its own name: an assertion on the
        /// number alone would pass whether the wrapper delegated or not.</para>
        /// </summary>
        [Fact]
        public void ModelAbsent_GradesTheLinkPristineUnderItsOwnName()
        {
            var inner = new StubBackend(connected: false);
            var wrapped = Wrap(inner, CommsControlSource.Full);

            var grading = wrapped.DegradeModel();
            Assert.Equal(0.0, grading.Level);
            Assert.Equal("no-comms-model", grading.ModelId);

            // Not the wrapped backend's answer, and not core's "nobody graded
            // this" either: three distinguishable states, and this is the third.
            Assert.NotEqual(inner.DegradeModel().Level, grading.Level);
            Assert.NotEqual(CommsDegradeModels.UnknownModelId, grading.ModelId);
            Assert.Null(CommsDegradeModels.Unknown.Level);
        }

        /// <summary>
        /// The probe reads live KSP on the capture path; a scene-settle throw
        /// must not escape onto it, and must not be read as "controllable".
        /// </summary>
        [Fact]
        public void AThrowingControlProbe_ReadsAsNoCommandSource()
        {
            var wrapped = CommsModelPolicy.Effective(
                new StubBackend(connected: false),
                modelPresent: false,
                () => throw new InvalidOperationException("torn-down vessel"),
                () => new PayloadMeta());

            Assert.Equal(CommsControlSource.None, wrapped!.Connectivity().ControlSource);
            // Still connected: the link is not what threw.
            Assert.True(wrapped.Connectivity().Connected);
        }

        [Fact]
        public void HealthNamesTheAbsentModelRatherThanReportingABarelyHealthyLink()
        {
            var health = CommsHealth.Evaluate(backendElected: true, modelPresent: false);

            // Not a fault: nothing is broken and every channel flows.
            Assert.Equal(UplinkHealthState.Healthy, health.State);
            Assert.NotNull(health.Detail);
            Assert.Contains("CommNet off", health.Detail);
        }

        private static ICommsBackend Wrap(ICommsBackend inner, CommsControlSource local) =>
            CommsModelPolicy.Effective(inner, modelPresent: false, () => local, () => new PayloadMeta())!;

        /// <summary>
        /// A backend reading a save whose CommNet difficulty option is off:
        /// disconnected, no control, no path, forever. That is not a stand-in
        /// for the defect, it is what stock's own object graph reports once
        /// <c>CommNetScenario.OnAwake</c> has destroyed itself, and
        /// <c>Gonogo.KSP.Tests.Comms.CommNetDifficultyOptionTests</c> pins the
        /// live half.
        /// </summary>
        private sealed class StubBackend : ICommsBackend
        {
            private readonly bool _connected;
            private readonly ICommsOcclusionModel _occlusion = CommsOcclusionModels.Unknown;

            internal StubBackend(bool connected) => _connected = connected;

            public string ProviderId => "commnet";

            public CommsConnectivity Connectivity() => new CommsConnectivity
            {
                Connected = _connected,
                ControlSource = CommsControlSource.None,
                HasLocalControl = false,
                Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
            };

            public CommsSignalStrength SignalStrength() => new CommsSignalStrength { Value = 0.0 };

            public CommsControlState ControlState() => new CommsControlState
            {
                State = CommsControlStateKind.None,
                Reason = _connected ? null : "no connection to a command source",
            };

            public CommsPath Path() => new CommsPath { Hops = new List<CommsHop>() };

            public CommsNetwork Network() => new CommsNetwork();

            public ICommsOcclusionModel OcclusionModel() => _occlusion;

            // Deliberately inert. Every one of these is a question the wrapper
            // answers for itself rather than delegating, so a stub that returned
            // anything meaningful here would be asserting against its own value
            // instead of the wrapper's.
            public IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to) => null;

            public ICommsReachModel ReachModel(object? from, object? to) => CommsReachModels.Unknown;

            /// <summary>
            /// A REAL rating, unlike the inert answers above, and deliberately
            /// one the wrapper must not pass through: the wrapper's own answer is
            /// a rated zero under its own model id, so a stub that also said
            /// "unknown" here would pass whether the wrapper delegated or not.
            /// </summary>
            public ICommsDegradeModel DegradeModel() =>
                new RatedDegradeModel("stub-grading", "Stub", 0.75);

            public object? ControlPathTerminus() => null;
        }
    }
}
