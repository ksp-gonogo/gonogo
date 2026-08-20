using System;
using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The provenance reader, the builder, and the rule that keeps the reader safe.
    ///
    /// <para>The stand-ins mirror the producer's member names character for
    /// character, so a typo in a name constant fails here. They also mirror the one
    /// shape that matters most: <see cref="FakeFrameSelector"/> carries a
    /// <c>FrameParameters()</c> that throws, standing in for the producer's own
    /// abort. Nothing in this assembly may call it, and the test below is what says
    /// so rather than a comment hoping to be read.</para>
    /// </summary>
    public class ProvenanceReflectionTests
    {
        [Fact]
        public void ReadsTheColdReadableSettings()
        {
            var observation = new ProvenanceReflection().Read(
                new FakeMainWindow(), new FakeFrameSelector());

            Assert.True(observation.DisplayPatchedConics);
            Assert.Equal(604_800.0, observation.HistoryLengthSeconds);
            Assert.Equal(2, observation.FramesHidingUnpinnedMarkers);
            Assert.Equal(1, observation.FramesHidingUnpinnedCelestials);
            Assert.Equal(3, observation.PlottingFrameType);
            Assert.Equal("Kerbin", observation.PlottingFrameCentreBody);
            Assert.False(observation.TargetFrameSelected);
        }

        /// <summary>
        /// The prediction bound is never read cold, and this is the assertion that
        /// keeps it that way. The stand-in carries both indices at their real
        /// constructor defaults, which resolve to plausible settings, and the reader
        /// must still report nothing.
        /// </summary>
        [Fact]
        public void NeverReadsThePredictionBoundColdEvenThoughTheFieldsAreThere()
        {
            var observation = new ProvenanceReflection().Read(
                new FakeMainWindow(), new FakeFrameSelector());

            Assert.Null(observation.Prediction);
        }

        /// <summary>
        /// Each object contributes independently: a build that moved one should cost
        /// its own fields, not the whole surface.
        /// </summary>
        [Fact]
        public void ReadsWhatItCanWhenOneObjectIsMissing()
        {
            var reader = new ProvenanceReflection();

            var noFrame = reader.Read(new FakeMainWindow(), null);
            Assert.True(noFrame.DisplayPatchedConics);
            Assert.Null(noFrame.PlottingFrameType);

            var noWindow = reader.Read(null, new FakeFrameSelector());
            Assert.Null(noWindow.DisplayPatchedConics);
            Assert.Equal(3, noWindow.PlottingFrameType);
        }

        [Fact]
        public void AnUnrecognisableShapeReportsUnknownRatherThanThrowing()
        {
            var observation = new ProvenanceReflection().Read(new object(), new object());

            Assert.Null(observation.DisplayPatchedConics);
            Assert.Null(observation.HistoryLengthSeconds);
            Assert.Null(observation.PlottingFrameType);
            Assert.Null(observation.PlottingFrameCentreBody);
        }

        /// <summary>
        /// The reader must not call the producer's frame namer or its parameters
        /// method: each reaches a fatal-log helper through a default branch, which
        /// aborts the process. The stand-ins throw from exactly those members, so a
        /// reader that reached for one fails here instead of in front of an operator.
        ///
        /// <para>This is the test that makes the rule enforceable. A comment saying
        /// "do not call these" is invisible to the next person adding a field; a
        /// fixture that detonates is not.</para>
        /// </summary>
        [Fact]
        public void DoesNotCallTheMembersThatAbort()
        {
            var selector = new FakeFrameSelector();

            var observation = new ProvenanceReflection().Read(new FakeMainWindow(), selector);

            Assert.Equal(3, observation.PlottingFrameType);
            Assert.False(selector.AbortingMemberWasCalled);
        }
    }

    /// <summary>The invoke allowlist, which is where the corrected safety rule is
    /// enforced rather than described.</summary>
    public class ReflectedMembersInvokeRuleTests
    {
        [Fact]
        public void RefusesToInvokeAMemberThatHasNotBeenAudited()
        {
            var ex = Assert.Throws<InvalidOperationException>(
                () => new ReflectedMembers().Invoke(new FakeFrameSelector(), "FrameParameters"));

            Assert.Contains("decompiled body", ex.Message);
        }

        [Fact]
        public void AllowsTheTwoAuditedMembers()
        {
            Assert.Equal(new[] { "Δv", "ok" }, ReflectedMembers.InvocableMembers);
        }

        /// <summary>
        /// A refusal must be a refusal, not a silent null: the whole point is that
        /// the mistake is invisible at the call site, so it has to be loud when
        /// reached.
        /// </summary>
        [Fact]
        public void TheRefusalIsAThrowRatherThanANull()
        {
            var selector = new FakeFrameSelector();

            Assert.Throws<InvalidOperationException>(
                () => new ReflectedMembers().Invoke(selector, "Name"));
            Assert.False(selector.AbortingMemberWasCalled);
        }
    }

    public class ProvenanceBuilderTests
    {
        [Fact]
        public void AnUnobservedPredictionBoundIsFourNullsRatherThanADefault()
        {
            var dict = ProvenanceBuilder.Build(new ProvenanceObservation
            {
                DisplayPatchedConics = false,
            });

            Assert.Null(dict["predictionToleranceMetres"]);
            Assert.Null(dict["predictionMaxSteps"]);
            Assert.Null(dict["predictionObservedAtUt"]);
            Assert.Null(dict["predictionVesselId"]);
            Assert.Equal(false, dict["displayPatchedConics"]);
        }

        [Fact]
        public void AnObservedPredictionBoundCarriesItsInstantAndItsVessel()
        {
            var dict = ProvenanceBuilder.Build(new ProvenanceObservation
            {
                Prediction = new PredictionSettingsObservation
                {
                    ObservedAtUt = 900.0,
                    VesselId = "vessel-9",
                    ToleranceMetres = 0.01,
                    MaxSteps = 10_000,
                },
            });

            Assert.Equal(0.01, dict["predictionToleranceMetres"]);
            Assert.Equal(10_000.0, dict["predictionMaxSteps"]);
            Assert.Equal(900.0, dict["predictionObservedAtUt"]);
            Assert.Equal("vessel-9", dict["predictionVesselId"]);
        }
    }

    /// <summary>The producer's main window, by member name. The two prediction
    /// indices are present AND at their real constructor defaults, so a reader that
    /// took them cold would report "1 cm" and "1e4 steps" and look right.</summary>
    public class FakeMainWindow
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        private bool display_patched_conics = true;
        private double history_length = 604_800.0;
        private object frames_that_hide_unpinned_markers = new HashSet<string> { "a", "b" };
        private object frames_that_hide_unpinned_celestials = new HashSet<string> { "a" };
        private int prediction_length_tolerance_index_ = 1;
        private int prediction_steps_index_ = 4;
        private double[] prediction_length_tolerances_ = { 0.001, 0.01, 0.1, 1.0 };
        private long[] prediction_steps_ = { 100, 1_000, 10_000, 100_000, 1_000_000 };
#pragma warning restore CS0414, IDE0044, IDE1006
    }

    /// <summary>
    /// The producer's frame selector, including the members that abort.
    ///
    /// <para><c>FrameParameters</c> and <c>Name</c> throw rather than returning
    /// something harmless, standing in for the real ones reaching a fatal-log helper.
    /// <c>AbortingMemberWasCalled</c> is set first so a caller that swallowed the
    /// exception is still caught.</para>
    /// </summary>
    public class FakeFrameSelector
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        private FakeFrameType frame_type = FakeFrameType.RotatingPulsating;
        private object selected_celestial = new FakeCelestial();
        // Read by reflection, invisible to the compiler, hence the suppression.
        private bool target_frame_selected = false;
#pragma warning restore CS0414, CS0169, IDE0044, IDE1006

        public bool AbortingMemberWasCalled { get; private set; }

        public object FrameParameters()
        {
            AbortingMemberWasCalled = true;
            throw new InvalidOperationException("Log.Fatal: Unexpected frame_type");
        }

        public string Name()
        {
            AbortingMemberWasCalled = true;
            throw new InvalidOperationException("Log.Fatal: Unexpected type");
        }
    }

    public enum FakeFrameType
    {
        BodyCentredNonRotating = 0,
        BarycentricRotating = 1,
        BodySurface = 2,
        RotatingPulsating = 3,
    }

    public class FakeCelestial
    {
#pragma warning disable IDE1006
        public string bodyName = "Kerbin";
#pragma warning restore IDE1006
    }
}
