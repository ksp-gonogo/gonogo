using System;
using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The settings reading, its two halves, and the rules that keep both safe.
    ///
    /// <para>The stand-ins mirror the producer's member names character for
    /// character, so a typo in a name constant fails here rather than reaching a
    /// player as a silently missing setting. They also mirror the shape that
    /// matters most: <see cref="FakeFrameSelector"/> carries the members that abort,
    /// and they throw. Nothing in this assembly may call one, and these tests are
    /// what say so rather than a comment hoping to be read.</para>
    ///
    /// <para><b>The frame kinds in the doubles are the producer's own numbers.</b>
    /// An earlier double numbered them from zero, which is not what the producer
    /// declares and not what the wire carries, and the naming table on the client
    /// side was built to match the double rather than the producer. Both were wrong
    /// and agreed with each other. Fixtures that restate our own assumption cannot
    /// fail on it.</para>
    /// </summary>
    public class SettingsReflectionTests
    {
        private static SettingsObservation Read(ISettingsSource source)
        {
            var observation = new SettingsObservation();
            new SettingsReflection().Read(source, observation);
            return observation;
        }

        [Fact]
        public void ReadsTheMainWindowsSettings()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.True(observation.DisplayPatchedConics);
            Assert.Equal(604_800.0, observation.HistoryLengthSeconds);
            Assert.Equal(2, observation.FramesHidingUnpinnedMarkers);
            Assert.Equal(1, observation.FramesHidingUnpinnedCelestials);
            Assert.True(observation.SelectingTargetVessel);
            Assert.False(observation.SelectingTargetCelestial);
        }

        /// <summary>
        /// Three sinks, three independent thresholds, and they are not the same
        /// number. Asserting three different values is what would catch two of them
        /// being wired to one field.
        /// </summary>
        [Fact]
        public void ReadsTheThreeLoggingThresholdsSeparately()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.Equal(3, observation.VerboseLevel);
            Assert.Equal(1, observation.LogThreshold);
            Assert.Equal(2, observation.StderrThreshold);
            Assert.Equal(-1, observation.FlushThreshold);
        }

        /// <summary>
        /// Whether a recorder is running is a STATIC field on the producer, and the
        /// member walk used to bind instance members only, so it resolved to
        /// nothing and answered null. Null is indistinguishable from "not recording"
        /// to anything downstream, so the gate that is supposed to stop us reading
        /// would never have fired.
        /// </summary>
        [Fact]
        public void ReadsTheStaticJournalingFlag()
        {
            Assert.False(Read(new FakeSettingsSource()).Journaling);
            Assert.True(Read(new FakeJournallingSettingsSource()).Journaling);
        }

        [Fact]
        public void ReadsTheRequestedJournalSeparatelyFromTheActualOne()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.True(observation.RecordJournalRequested);
            Assert.False(observation.Journaling);
        }

        /// <summary>
        /// The frame kind travels as the producer's declared VALUE. Its enum is
        /// numbered from 6000 and its positions are not its values, so a reading
        /// that converted the position would put a number on the wire that names no
        /// frame at all.
        /// </summary>
        [Fact]
        public void CarriesTheFramesDeclaredEnumValueRatherThanItsPosition()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.Equal(6004, observation.PlottingFrame!.Type);
        }

        /// <summary>
        /// The centred kinds are named by one body; the rotating kinds by that body
        /// and its parent. Putting the pair in the centre slot would render a
        /// Lagrange frame as though it were centred on one of its two primaries.
        /// </summary>
        [Fact]
        public void NamesARotatingFrameByItsPairAndACentredOneByItsCentre()
        {
            var rotating = Read(new FakeSettingsSource()).PlottingFrame!;
            Assert.Null(rotating.CentreBody);
            Assert.Equal("Kerbol", rotating.PrimaryBody);
            Assert.Equal("Kerbin", rotating.SecondaryBody);

            var source = new FakeSettingsSource();
            source.Selector.SetFrameType(FakeFrameType.BodyCentredNonRotating);
            var centred = Read(source).PlottingFrame!;
            Assert.Equal("Kerbin", centred.CentreBody);
            Assert.Null(centred.PrimaryBody);
            Assert.Null(centred.SecondaryBody);
        }

        [Fact]
        public void CarriesTheTargetVesselAndWhetherTheTargetFrameIsSelected()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.False(observation.PlottingFrame!.TargetFrameSelected);
            Assert.Equal("vessel-guid", observation.TargetVesselId);
            Assert.Equal("Munar Relay", observation.TargetVesselName);
        }

        [Fact]
        public void CarriesThePinnedExemptionsAndNotTheUnpinnedOnes()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.Equal(new[] { "Mun" }, observation.PinnedCelestials);
            Assert.True(observation.TargetPinned);
        }

        [Fact]
        public void ReadsThePlannersOptimiserObjectives()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.Equal(10_000.0, observation.OptimiserTargetAltitudeMetres);
            Assert.Equal(28.5, observation.OptimiserTargetInclinationDegrees);
            Assert.True(observation.ShowManoeuvreOnNavball);
        }

        /// <summary>
        /// Inclination is nullable on the producer and stays nullable here. Null
        /// means inclination is not an objective, which is a different instruction
        /// from an equatorial one, and rendering the first as the second would show
        /// a target nobody asked for.
        /// </summary>
        [Fact]
        public void AnInclinationThatIsNotAnObjectiveIsNullRatherThanZero()
        {
            var source = new FakeSettingsSource();
            source.Planner.ClearInclinationObjective();

            Assert.Null(Read(source).OptimiserTargetInclinationDegrees);
        }

        [Fact]
        public void ReadsTheAnalysersWindowRecurrenceAndGraphSettings()
        {
            var observation = Read(new FakeSettingsSource());

            Assert.Equal(2_592_000.0, observation.AnalysisMissionDurationRequestedSeconds);
            Assert.False(observation.RecurrenceAutodetect);
            Assert.Equal(43, observation.RecurrenceRevolutionsPerCycle);
            Assert.Equal(3, observation.RecurrenceDaysPerCycle);
            Assert.Equal(7, observation.GroundTrackRevolution);
            Assert.True(observation.ShowElementGraphs);
            Assert.True(observation.StabilityGridMaxEccentricityMinInclination);
            Assert.False(observation.StabilityGridMinEccentricityMaxInclination);
        }

        /// <summary>
        /// The count says frames exist that hide their markers; only the per-frame
        /// answer says whether the operator is looking at one of them. That is the
        /// difference between "a marker does not exist" and "a marker is hidden
        /// here", and the second sends nobody hunting a physics problem.
        /// </summary>
        [Fact]
        public void SaysWhetherMarkersAreHiddenInTheFrameNowSelected()
        {
            var source = new FakeSettingsSource();

            Assert.True(Read(source).UnpinnedMarkersHiddenHere);
            Assert.False(Read(source).UnpinnedCelestialsHiddenHere);
        }

        /// <summary>
        /// The match is on the whole four-part key. Changing only the secondary body
        /// makes it a different frame, and a match that ignored a part would report
        /// markers hidden in a frame where they are drawn.
        /// </summary>
        [Fact]
        public void ADifferentFrameIsNotAMatch()
        {
            var source = new FakeSettingsSource();
            source.Selector.SetSelectedCelestial(new FakeCelestial("Duna", 6, new FakeCelestial("Kerbol", 0, null)));

            Assert.False(Read(source).UnpinnedMarkersHiddenHere);
        }

        /// <summary>
        /// A centred frame keys on its centre with no primaries, which is a
        /// different rule from the rotating kinds' and the one place a
        /// copy-and-paste would silently produce a key that never matches.
        /// </summary>
        [Fact]
        public void MatchesACentredFrameOnItsOwnKeyShape()
        {
            var source = new FakeSettingsSource();
            source.Selector.SetFrameType(FakeFrameType.BodySurface);
            source.Window.HideMarkersIn(new FakeFrameParameters(6003, 1, new int[0], new int[0]));

            Assert.True(Read(source).UnpinnedMarkersHiddenHere);
        }

        /// <summary>
        /// Each object contributes independently: a build that moved one should cost
        /// its own settings, not the whole reading.
        /// </summary>
        [Fact]
        public void ReadsWhatItCanWhenOneObjectIsMissing()
        {
            var source = new FakeSettingsSource();
            source.DropOrbitAnalyser();

            var observation = Read(source);

            Assert.True(observation.DisplayPatchedConics);
            Assert.Equal(6004, observation.PlottingFrame!.Type);
            Assert.Null(observation.GroundTrackRevolution);
        }

        [Fact]
        public void AnUnrecognisableShapeReportsUnknownRatherThanThrowing()
        {
            var observation = Read(new BareSettingsSource());

            Assert.Null(observation.DisplayPatchedConics);
            Assert.Null(observation.HistoryLengthSeconds);
            Assert.Null(observation.PlottingFrame!.Type);
            Assert.Null(observation.GroundTrackRevolution);
        }

        /// <summary>
        /// The reader must not call the producer's frame namer or its parameters
        /// method: each reaches a fatal-log helper through a default branch, which
        /// aborts the process rather than throwing.
        ///
        /// <para>This is the test that makes the rule enforceable. A comment saying
        /// "do not call these" is invisible to the next person adding a field; a
        /// fixture that detonates is not.</para>
        /// </summary>
        [Fact]
        public void DoesNotCallTheMembersThatAbort()
        {
            var source = new FakeSettingsSource();

            var observation = Read(source);

            Assert.Equal(6004, observation.PlottingFrame!.Type);
            Assert.False(source.Selector.AbortingMemberWasCalled);
        }
    }

    /// <summary>
    /// The half that talks to the plugin, driven through the same recording double
    /// the protocol tests use.
    /// </summary>
    public class NativeSettingsReaderTests
    {
        private const string Guid = "vessel-1";

        private static (FakePrincipiaPlugin Plugin, FakeSettingsSource Source, SettingsObservation Observation)
            Read(Action<FakePrincipiaPlugin, FakeSettingsSource>? arrange = null)
        {
            var plugin = new FakePrincipiaPlugin();
            var source = new FakeSettingsSource();
            arrange?.Invoke(plugin, source);
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out var reason),
                reason);
            source.Session = session;

            var observation = new SettingsObservation();
            new NativeSettingsReader().Read(source, observation);
            return (plugin, source, observation);
        }

        /// <summary>
        /// The prediction bound is the vessel's own, from the plugin, and NOT the
        /// producer's slider indices. Those sit at constructor defaults resolving to
        /// a plausible tolerance and a plausible step count until its settings
        /// window has repainted, so a reading taken from them hands an operator a
        /// fabricated basis for judging everything else on the screen.
        /// </summary>
        [Fact]
        public void ReadsThePredictionBoundFromThePluginPerVessel()
        {
            var (_, _, observation) = Read((plugin, source) =>
            {
                plugin.Add(Guid);
                source.ActiveVesselGuid = Guid;
                plugin.PredictionStepParameters = new FakeStepParameters(0.1, 65_536);
            });

            Assert.Equal(Guid, observation.PredictionVesselId);
            Assert.Equal(0.1, observation.PredictionToleranceMetres);
            Assert.Equal(65_536.0, observation.PredictionMaxSteps);
        }

        /// <summary>
        /// The plan's integrator bound is a DIFFERENT setting from the prediction's
        /// despite sharing a label in game. Conflated, a plan failure gets explained
        /// by a prediction setting and the operator changes the wrong control, so
        /// the two are given different values here on purpose.
        /// </summary>
        [Fact]
        public void KeepsThePlansBoundApartFromThePredictionsBound()
        {
            var (_, _, observation) = Read((plugin, source) =>
            {
                plugin.Add(Guid, hasFlightPlan: true);
                source.ActiveVesselGuid = Guid;
                plugin.PredictionStepParameters = new FakeStepParameters(0.1, 65_536);
                plugin.PlanStepParameters = new FakeStepParameters(1.0, 1_048_576);
            });

            Assert.Equal(0.1, observation.PredictionToleranceMetres);
            Assert.Equal(65_536.0, observation.PredictionMaxSteps);
            Assert.Equal(1.0, observation.PlanToleranceMetres);
            Assert.Equal(1_048_576.0, observation.PlanMaxSteps);
        }

        [Fact]
        public void ReadsThePlansExtentAndSlot()
        {
            var (_, _, observation) = Read((plugin, source) =>
            {
                plugin.Add(Guid, hasFlightPlan: true);
                source.ActiveVesselGuid = Guid;
            });

            Assert.Equal(1, observation.FlightPlanCount);
            Assert.Equal(0, observation.SelectedFlightPlan);
            Assert.Equal(2_000.0, observation.PlanInitialTimeUt);
            Assert.Equal(9_000.0, observation.PlanDesiredFinalTimeUt);
            Assert.Equal(8_000.0, observation.PlanActualFinalTimeUt);
        }

        /// <summary>
        /// Minus one is a STATE, not a zero: no plan is selected. Coercing it would
        /// attribute every number on a plan board to slot A.
        /// </summary>
        [Fact]
        public void NoSelectedPlanIsMinusOneRatherThanZero()
        {
            var (_, _, observation) = Read((plugin, source) =>
            {
                plugin.Add(Guid);
                source.ActiveVesselGuid = Guid;
            });

            Assert.Equal(0, observation.FlightPlanCount);
            Assert.Equal(-1, observation.SelectedFlightPlan);
        }

        /// <summary>
        /// A burn's Δv is expressed in that burn's own manœuvring frame, which is
        /// routinely not the plotting frame, and the only in-game cue is suppressed
        /// when the editor is minimised. The frame comes from the plugin's own
        /// manœuvre rather than from the burn editor beside it, which is a mirror
        /// refreshed only while its window is drawing.
        /// </summary>
        [Fact]
        public void CarriesEachBurnsOwnManoeuvringFrame()
        {
            var (_, _, observation) = Read((plugin, source) =>
            {
                plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 2);
                source.ActiveVesselGuid = Guid;
                plugin.Manoeuvres[0] = new FakeManoeuvre(new FakeBurnFrameParameters(6000, 1, -1, -1));
                plugin.Manoeuvres[1] = new FakeManoeuvre(new FakeBurnFrameParameters(6004, 0, 0, 1));
            });

            Assert.Equal(2, observation.BurnFrames.Count);
            Assert.Equal("burn", observation.BurnFrames[0].Selector);
            Assert.Equal(6000, observation.BurnFrames[0].Type);
            Assert.Equal("Kerbin", observation.BurnFrames[0].CentreBody);
            Assert.Equal(6004, observation.BurnFrames[1].Type);
            Assert.Equal("Kerbol", observation.BurnFrames[1].PrimaryBody);
            Assert.Equal("Kerbin", observation.BurnFrames[1].SecondaryBody);
        }

        /// <summary>
        /// A vessel the plugin no longer knows is the ordinary case, not a fault,
        /// and it is the one this whole protocol exists for. The alternative to
        /// publishing nothing is not a stale number; it is the player's game ending.
        /// </summary>
        [Fact]
        public void AVesselThePluginNoLongerKnowsCostsExactlyItsOwnSettings()
        {
            var (plugin, _, observation) = Read((p, source) => source.ActiveVesselGuid = Guid);

            Assert.Null(observation.PredictionToleranceMetres);
            Assert.Null(observation.FlightPlanCount);
            Assert.Contains("HasVessel(" + Guid + ")", plugin.Calls);
            Assert.DoesNotContain(
                plugin.Calls, c => c.StartsWith("VesselGet", StringComparison.Ordinal));
        }

        /// <summary>A vessel with no plan aborts on any plan read, so the plan half
        /// is absent and the vessel half still arrives.</summary>
        [Fact]
        public void APlanlessVesselStillCarriesItsPredictionBound()
        {
            var (plugin, _, observation) = Read((p, source) =>
            {
                p.Add(Guid);
                source.ActiveVesselGuid = Guid;
                p.PredictionStepParameters = new FakeStepParameters(0.01, 1_024);
            });

            Assert.Equal(0.01, observation.PredictionToleranceMetres);
            Assert.Null(observation.PlanToleranceMetres);
            Assert.DoesNotContain(
                plugin.Calls, c => c.StartsWith("FlightPlanGetAdaptive", StringComparison.Ordinal));
        }

        /// <summary>No session means no plugin reads at all, and the managed half is
        /// unaffected: this reader simply contributes nothing.</summary>
        [Fact]
        public void WithoutASessionItReadsNothingRatherThanFailing()
        {
            var observation = new SettingsObservation();
            new NativeSettingsReader().Read(
                new FakeSettingsSource { ActiveVesselGuid = Guid }, observation);

            Assert.Null(observation.PredictionToleranceMetres);
            Assert.Null(observation.FlightPlanCount);
        }
    }

    public class SettingsBuilderTests
    {
        [Fact]
        public void AnUnreadSettingIsNullRatherThanADefault()
        {
            var payload = SettingsBuilder.Build(new SettingsObservation { SampledAtUt = 42.0 });

            Assert.Equal(42.0, payload["observedAtUt"]);
            Assert.Null(payload["predictionToleranceMetres"]);
            Assert.Null(payload["predictionMaxSteps"]);
            Assert.Null(payload["displayPatchedConics"]);
            Assert.Null(payload["plottingFrame"]);
        }

        [Fact]
        public void FlattensTheFrameIntoItsOwnRecord()
        {
            var payload = SettingsBuilder.Build(new SettingsObservation
            {
                PlottingFrame = new FrameObservation
                {
                    Selector = "plotting",
                    Type = 6004,
                    PrimaryBody = "Kerbol",
                    SecondaryBody = "Kerbin",
                },
            });

            var frame = Assert.IsType<Dictionary<string, object?>>(payload["plottingFrame"]);
            Assert.Equal("plotting", frame["selector"]);
            Assert.Equal(6004, frame["type"]);
            Assert.Null(frame["centreBody"]);
            Assert.Equal("Kerbol", frame["primaryBody"]);
            Assert.Equal("Kerbin", frame["secondaryBody"]);
        }

        /// <summary>
        /// An empty list is absent rather than an empty array. "This plan has no
        /// burns" and "we did not read the plan" are different claims and only one
        /// of them is ours to make.
        /// </summary>
        [Fact]
        public void NothingReadIsAbsentRatherThanAnEmptyList()
        {
            var payload = SettingsBuilder.Build(new SettingsObservation());

            Assert.Null(payload["burnFrames"]);
            Assert.Null(payload["pinnedCelestials"]);
        }

        /// <summary>
        /// A suspended reading carries the outage and NOTHING else. A stale
        /// tolerance beside "we have stopped reading" is the half-true payload the
        /// rule exists to avoid, and the shape is what stops it rather than a
        /// caller's discipline.
        /// </summary>
        [Fact]
        public void ASuspendedReadingCarriesTheOutageAndNothingElse()
        {
            var payload = SettingsBuilder.Build(
                SettingsObservation.Suspended(7.0, "build-x", "because"));

            Assert.Equal(true, payload["readingSuspended"]);
            Assert.Equal("because", payload["readingSuspendedReason"]);
            Assert.Equal("build-x", payload["pluginVersion"]);
            Assert.False(payload.ContainsKey("plottingFrame"));
            Assert.False(payload.ContainsKey("predictionToleranceMetres"));
        }
    }

    /// <summary>
    /// The publish rule: whether we read at all, and what we say when we do not.
    /// </summary>
    public class SettingsPublishRuleTests
    {
        private static readonly PrincipiaGuardResult Present =
            PrincipiaGuardResult.Ok(null);

        [Fact]
        public void PublishesNothingWithoutASource()
        {
            Assert.Null(new PrincipiaUplink(Present).CaptureSettingsOnMain(null));
        }

        /// <summary>
        /// With a journal recorder running, the producer writes every call made
        /// through its plugin interface into the player's replay journal, ours
        /// included, and that journal is the artefact one of its bug reports is made
        /// of. So we stop reading and say so, rather than quietly rewriting a
        /// debugging record we do not own.
        /// </summary>
        [Fact]
        public void StopsReadingEntirelyWhileAJournalIsBeingRecorded()
        {
            var uplink = new PrincipiaUplink(Present, new FakeJournallingSettingsSource());

            var captured = Assert.IsType<SettingsObservation>(uplink.CaptureSettingsOnMain(null));

            Assert.True(captured.ReadingSuspended);
            Assert.Equal(PrincipiaUplink.JournalSuspensionReason, captured.ReadingSuspendedReason);
            Assert.Null(captured.PlottingFrame);
            Assert.Null(captured.DisplayPatchedConics);
        }

        /// <summary>
        /// It gates on whether a recorder is ACTUALLY running, not on whether one
        /// was asked for. The request only takes effect on the next load, so gating
        /// on it would stop us a session early and then fail to stop us at all in
        /// the case that matters.
        /// </summary>
        [Fact]
        public void ARequestedJournalThatIsNotRunningDoesNotStopTheReading()
        {
            var uplink = new PrincipiaUplink(Present, new FakeSettingsSource());

            var captured = Assert.IsType<SettingsObservation>(uplink.CaptureSettingsOnMain(null));

            Assert.True(captured.RecordJournalRequested);
            Assert.False(captured.ReadingSuspended);
            Assert.NotNull(captured.PlottingFrame);
        }
    }

    // ---- Doubles ----

    /// <summary>The producer's frame kinds, by the values it declares rather than
    /// by their positions. The two differ, which is the whole reason to spell them
    /// out here.</summary>
    public enum FakeFrameType
    {
        BodyCentredNonRotating = 6000,
        BarycentricRotating = 6001,
        BodyCentredParentDirection = 6002,
        BodySurface = 6003,
        RotatingPulsating = 6004,
    }

    public class FakeCelestial
    {
        public FakeCelestial(string name, int index, FakeCelestial? parent)
        {
            bodyName = name;
            flightGlobalsIndex = index;
            Parent = parent;
            parent?.orbitingBodies.Add(this);
        }

        private FakeCelestial? Parent { get; }

#pragma warning disable IDE1006
        public string bodyName;

        public int flightGlobalsIndex { get; }

        /// <summary>A root body answers itself, as the game's own does, so a reader
        /// that assumed null for the Sun would be reading against a shape that does
        /// not occur.</summary>
        public FakeCelestial referenceBody => Parent ?? this;

        /// <summary>The children, in the order they were constructed, because the
        /// game's own list is ordered and the producer's set builder stops partway
        /// along it. A double that sorted them would hide the only thing about that
        /// rule worth testing.</summary>
        public readonly List<FakeCelestial> orbitingBodies = new List<FakeCelestial>();
#pragma warning restore IDE1006
    }

    /// <summary>The plotting frame's descriptor: arrays, and empty for "no
    /// body".</summary>
    public class FakeFrameParameters
    {
        public FakeFrameParameters(int type, int centre, int[] primary, int[] secondary)
        {
            extension = type;
            centre_index = centre;
            primary_index = primary;
            secondary_index = secondary;
        }

#pragma warning disable IDE1006
        public int extension;
        public int centre_index;
        public int[] primary_index;
        public int[] secondary_index;
#pragma warning restore IDE1006
    }

    /// <summary>
    /// The producer's main window, by member name.
    ///
    /// <para>The two prediction indices are present AND at their real constructor
    /// defaults, which resolve to plausible settings. Nothing reads them, and their
    /// being here is what makes that assertable.</para>
    /// </summary>
    public class FakeMainWindow
    {
        public FakeMainWindow(bool journaling)
        {
            journaling_ = journaling;
            frames_that_hide_unpinned_markers = new HashSet<FakeFrameParameters>
            {
                new FakeFrameParameters(6004, 0, new[] { 0, 1 }, new[] { 1 }),
                new FakeFrameParameters(6000, 5, new int[0], new int[0]),
            };
            frames_that_hide_unpinned_celestials = new HashSet<FakeFrameParameters>
            {
                new FakeFrameParameters(6003, 8, new int[0], new int[0]),
            };
        }

        public void HideMarkersIn(FakeFrameParameters frame) =>
            ((HashSet<FakeFrameParameters>)frames_that_hide_unpinned_markers).Add(frame);

#pragma warning disable CS0414, IDE0044, IDE1006
        private bool display_patched_conics { get; set; } = true;
        private double history_length { get; set; } = 604_800.0;
        private object frames_that_hide_unpinned_markers;
        private object frames_that_hide_unpinned_celestials;
        private bool selecting_active_vessel_target { get; set; } = true;
        private bool selecting_target_celestial_ = false;
        private int verbose_logging_ = 3;
        private int suppressed_logging_ = 1;
        private int stderr_logging_ = 2;
        private int buffered_logging_ = -1;
        private bool must_record_journal_ = true;

        /// <summary>Static on the producer, and static here: the member walk that
        /// bound instance members only could never see it.</summary>
        private static bool journaling_;

        private int prediction_length_tolerance_index_ = 1;
        private int prediction_steps_index_ = 4;
        private static readonly double[] prediction_length_tolerances_ = { 0.001, 0.01, 0.1, 1.0 };
        private static readonly long[] prediction_steps_ = { 100, 1_000, 10_000 };
#pragma warning restore CS0414, IDE0044, IDE1006
    }

    /// <summary>
    /// The producer's frame selector, including the members that abort.
    ///
    /// <para>They throw rather than returning something harmless, standing in for
    /// the real ones reaching a fatal-log helper. <c>AbortingMemberWasCalled</c> is
    /// set first, so a caller that swallowed the exception is still caught.</para>
    /// </summary>
    public class FakeFrameSelector
    {
        public void SetFrameType(FakeFrameType type) => frame_type = type;

        public void SetSelectedCelestial(FakeCelestial body) => selected_celestial = body;

#pragma warning disable CS0414, IDE0044, IDE1006
        private FakeFrameType frame_type = FakeFrameType.RotatingPulsating;
        private object selected_celestial =
            new FakeCelestial("Kerbin", 1, new FakeCelestial("Kerbol", 0, null));
        private bool target_frame_selected = false;
        private object target = new FakeVessel();
        private bool target_pinned_ = true;

        public readonly Dictionary<FakeCelestial, bool> pinned = new Dictionary<FakeCelestial, bool>
        {
            [new FakeCelestial("Mun", 2, null)] = true,
            [new FakeCelestial("Minmus", 3, null)] = false,
        };
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

    public class FakeFlightPlanner
    {
        public void ClearInclinationObjective() => optimization_inclination_in_degrees_ = null;

#pragma warning disable CS0414, IDE0044, IDE1006
        private double optimization_altitude_ = 10_000.0;
        private double? optimization_inclination_in_degrees_ = 28.5;
        private bool show_guidance_ = true;
#pragma warning restore CS0414, IDE0044, IDE1006
    }

    public class FakeOrbitAnalyser
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        private object mission_duration_ = new FakeSlider { value = 2_592_000.0 };
        private bool autodetect_recurrence_ = false;
        private int revolutions_per_cycle_ = 43;
        private int days_per_cycle_ = 3;
        private int ground_track_revolution_ = 7;
        private bool show_graphs_ = true;
        private bool show_max_e_min_i_lines_ = true;
        private bool show_min_e_max_i_lines_ = false;
#pragma warning restore CS0414, IDE0044, IDE1006
    }

    public class FakeCelestialNames : ICelestialNames
    {
        private static readonly Dictionary<int, string> Names = new Dictionary<int, string>
        {
            [0] = "Kerbol",
            [1] = "Kerbin",
            [2] = "Mun",
            [3] = "Minmus",
            [6] = "Duna",
        };

        public string? NameOf(int index) => Names.TryGetValue(index, out var name) ? name : null;
    }

    public class FakeSettingsSource : ISettingsSource
    {
        public FakeMainWindow Window { get; } = new FakeMainWindow(journaling: false);

        public FakeFrameSelector Selector { get; } = new FakeFrameSelector();

        public FakeFlightPlanner Planner { get; } = new FakeFlightPlanner();

        private FakeOrbitAnalyser? _analyser = new FakeOrbitAnalyser();

        public void DropOrbitAnalyser() => _analyser = null;

        public bool TryAttach() => true;

        public object? MainWindow => Window;

        public object? FrameSelector => Selector;

        public object? FlightPlanner => Planner;

        public object? OrbitAnalyser => _analyser;

        public PrincipiaSession? Session { get; set; }

        public string? ActiveVesselGuid { get; set; }

        public string? TargetCelestialBody => null;

        public ICelestialNames Celestials { get; } = new FakeCelestialNames();
    }

    /// <summary>The same producer with a recorder actually running. A separate type
    /// rather than a mutable flag, because the flag it models is static and a shared
    /// one would leak between tests.</summary>
    public class FakeJournallingSettingsSource : ISettingsSource
    {
        private readonly FakeJournallingMainWindow _window = new FakeJournallingMainWindow();

        public bool TryAttach() => true;

        public object? MainWindow => _window;

        public object? FrameSelector => new FakeFrameSelector();

        public object? FlightPlanner => new FakeFlightPlanner();

        public object? OrbitAnalyser => new FakeOrbitAnalyser();

        public PrincipiaSession? Session => null;

        public string? ActiveVesselGuid => null;

        public string? TargetCelestialBody => null;

        public ICelestialNames Celestials { get; } = new FakeCelestialNames();
    }

    public class FakeJournallingMainWindow
    {
#pragma warning disable CS0414, IDE0044, IDE1006
        private bool display_patched_conics { get; set; } = true;
        private bool must_record_journal_ = true;
        private static readonly bool journaling_ = true;
#pragma warning restore CS0414, IDE0044, IDE1006
    }

    /// <summary>A producer whose shape we do not recognise at all: every read must
    /// answer unknown rather than throw.</summary>
    public class BareSettingsSource : ISettingsSource
    {
        public bool TryAttach() => true;

        public object? MainWindow => new object();

        public object? FrameSelector => new object();

        public object? FlightPlanner => new object();

        public object? OrbitAnalyser => new object();

        public PrincipiaSession? Session => null;

        public string? ActiveVesselGuid => null;

        public string? TargetCelestialBody => null;

        public ICelestialNames Celestials { get; } = new FakeCelestialNames();
    }
}
