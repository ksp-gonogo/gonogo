// A plan fact that could not be read must not reach an operator as a fact.
//
// ReflectedPrincipiaPlugin's three decoders used to answer 0, 0.0 and false on a
// type mismatch, which is what a reflected call hands back when the producer has
// moved a return type between releases and the call still resolves. Every one of
// those defaults is a POSITIVE claim, and they were claims an operator acts on:
//
//   A zero anomalous count says the integrator flagged nothing, so a plan it had
//   flagged carried no ANOM badge on any burn.
//
//   A zero plan count and a zero selection render the badge "PLAN 1 OF 0".
//
//   A false optimisation state says a write is safe to send. The inverse is
//   worse: `null >= 0` is false, so the guard that refuses a write Principia
//   would revert fell straight through on an answer nobody got.
//
//   A false Executing withheld the BURNING badge from a burn that may have been
//   under thrust, and handed out the edit and remove controls for it.
//
//   A false FrameEditable put "FRAME LOCKED" on screen as a property of a frame
//   this build never read.
//
// The refusals are the half that writes. PrincipiaBurnRules.RejectExecuting used
// null to mean "no refusal", which is the same word it uses for "nothing was
// wrong", so a REMOVE dispatched against a burn whose instants would not read
// came back Written and the operator's own console confirmed it had deleted a
// burn that may have been burning.
using System;
using System.Collections.Generic;
using System.Reflection;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class PlanAbsenceTests
    {
        private const string Guid = "vessel-1";

        /// <summary>
        /// A career vessel with a two-burn plan, read through the production reader,
        /// with one thing about the plugin arranged.
        /// </summary>
        private static PlanObservation Read(
            Action<FakePrincipiaPlugin> arrange, double nowUt = 1000.0)
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 2);
            arrange(plugin);
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out var reason),
                reason);

            var observation = new PlanReader().Read(session, Guid, nowUt, new FakeCelestialNames());
            Assert.NotNull(observation);
            return observation!;
        }

        /// <summary>
        /// A manoeuvre whose instants and frame are all readable, so a test that
        /// withdraws one is withdrawing exactly one.
        /// </summary>
        private static FakeManoeuvre Ordinary() =>
            new FakeManoeuvre { final_time = 3000.0 }.WithIgnition(2000.0);


        /// <summary>
        /// Ignition unreadable. Not false: false says the craft is NOT under thrust,
        /// and that is the claim that hands out the edit and remove controls.
        /// </summary>
        [Fact]
        public void ABurnWhoseIgnitionWillNotReadHasAnUnknownExecutionState()
        {
            var manoeuvre = Ordinary();
            manoeuvre.burn.initial_time = double.NaN;

            var described = PlanReader.Describe(manoeuvre, 0, 1, 0, 2500.0, celestials: null);

            Assert.Null(described.IgnitionUt);
            Assert.Null(described.Executing);
        }

        /// <summary>Cutoff unreadable, which closes the window at the other end and
        /// is just as unanswerable.</summary>
        [Fact]
        public void ABurnWhoseCutoffWillNotReadHasAnUnknownExecutionState()
        {
            var manoeuvre = Ordinary();
            manoeuvre.final_time = double.NaN;

            var described = PlanReader.Describe(manoeuvre, 0, 1, 0, 2500.0, celestials: null);

            Assert.Null(described.CutoffUt);
            Assert.Null(described.Executing);
        }

        /// <summary>
        /// Both instants readable still answers, in both directions. The tri-state
        /// is for the unreadable case only: a burn genuinely outside its window is
        /// false, and turning that into a null would freeze every control on a plan
        /// nothing is wrong with.
        /// </summary>
        [Theory]
        [InlineData(1500.0, false)]
        [InlineData(2500.0, true)]
        [InlineData(3500.0, false)]
        public void AReadableWindowStillAnswersTrueOrFalse(double nowUt, bool executing)
        {
            var described = PlanReader.Describe(Ordinary(), 0, 1, 0, nowUt, celestials: null);

            Assert.Equal(executing, described.Executing);
        }


        /// <summary>
        /// The frame extension is what the editable whitelist is checked against, so
        /// a burn carrying no readable frame has no answer. False is a statement
        /// ABOUT THE FRAME and rendered as "FRAME LOCKED" beside "THIS FRAME CANNOT
        /// BE WRITTEN BACK".
        /// </summary>
        [Fact]
        public void ABurnWithNoReadableFrameHasAnUnknownEditableFrame()
        {
            // A burn built from nothing carries no frame at all, which is the shape
            // the producer's own default-constructed burn has.
            var manoeuvre = new FakeManoeuvre { final_time = 3000.0, burn = new FakeBurn() };

            var described = PlanReader.Describe(manoeuvre, 0, 1, 0, 1000.0, celestials: null);

            Assert.Null(described.FrameType);
            Assert.Null(described.FrameEditable);
        }

        /// <summary>A frame that DID read still answers, so the whitelist keeps
        /// working for the case it was written for.</summary>
        [Theory]
        [InlineData(6000, true)]
        [InlineData(6001, false)]
        public void AReadableFrameStillAnswersAgainstTheWhitelist(int extension, bool editable)
        {
            var manoeuvre = new FakeManoeuvre(new FakeBurnFrameParameters(extension, 1, -1, -1))
            {
                final_time = 3000.0,
            };

            var described = PlanReader.Describe(manoeuvre, 0, 1, 0, 1000.0, celestials: null);

            Assert.Equal(editable, described.FrameEditable);
        }


        /// <summary>
        /// Zero is a real answer to "how many burns did the integrator flag" and it
        /// means none, so the unreadable case cannot borrow it. It used to: a `?? 0`
        /// in ReadBurns turned an unreadable count into no ANOM badge anywhere.
        /// </summary>
        [Fact]
        public void AnUnreadableAnomalousCountLeavesEachBurnsFlagUnknown()
        {
            var described = PlanReader.Describe(
                Ordinary(), 0, 1, anomalousCount: null, nowUt: 1000.0, celestials: null);

            Assert.Null(described.Anomalous);
        }

        /// <summary>A count of zero is the integrator being happy, and still reads
        /// as a burn that is not flagged.</summary>
        [Fact]
        public void AnAnomalousCountOfZeroIsStillAPositiveAllClear()
        {
            var described = PlanReader.Describe(
                Ordinary(), 0, 1, anomalousCount: 0, nowUt: 1000.0, celestials: null);

            Assert.False(described.Anomalous);
        }

        /// <summary>
        /// The whole way through the reader: an unreadable count reaches the
        /// observation as null and takes every burn's flag with it, rather than
        /// reporting a plan the integrator had nothing to say about.
        /// </summary>
        [Fact]
        public void AnUnreadableAnomalousCountReachesTheObservationAsNull()
        {
            var plan = Read(plugin => plugin.AnomalousCountUnreadable = true);

            Assert.Null(plan.AnomalousBurnCount);
            Assert.Equal(2, plan.Burns.Count);
            Assert.All(plan.Burns, burn => Assert.Null(burn.Anomalous));
        }

        /// <summary>
        /// The flagged case, so the last-n rule is demonstrated still working rather
        /// than only demonstrated absent. Two burns, one flagged, and it is the
        /// LAST one, which is the producer's own rule.
        /// </summary>
        [Fact]
        public void AReadableAnomalousCountStillFlagsTheLastBurns()
        {
            var plan = Read(plugin => plugin.AnomalousManoeuvres = 1);

            Assert.Equal(1, plan.AnomalousBurnCount);
            Assert.False(plan.Burns[0].Anomalous);
            Assert.True(plan.Burns[1].Anomalous);
        }


        /// <summary>
        /// `null >= 0` is false, so an unreadable optimisation state published as
        /// "no optimisation is running". The client freezes every write control on
        /// the true case and gives Principia being mid-optimisation as the reason,
        /// so either resolution puts a sentence on screen about a state nobody read.
        /// </summary>
        [Fact]
        public void AnUnreadableOptimisationStateIsPublishedAsUnknown()
        {
            var plan = Read(plugin => plugin.OptimisationStateUnreadable = true);

            Assert.Null(plan.OptimisationRunning);
        }

        /// <summary>The producer's own -1 for "none is running" is a real answer and
        /// still reads as false.</summary>
        [Fact]
        public void TheProducersMinusOneStillReadsAsNotOptimising()
        {
            var plan = Read(plugin => plugin.Known(Guid).OptimisingBurn = -1);

            Assert.False(plan.OptimisationRunning);
        }

        [Fact]
        public void AnOptimisingPlanStillReadsAsOptimising()
        {
            var plan = Read(plugin => plugin.Known(Guid).OptimisingBurn = 0);

            Assert.True(plan.OptimisationRunning);
        }


        /// <summary>
        /// The two numbers behind the badge an operator reads first. A zero pair
        /// rendered "PLAN 1 OF 0", which is not a plan any vessel can hold and is
        /// what the client draws from `(selected ?? -1) + 1` of `count ?? 0`.
        /// </summary>
        [Fact]
        public void AnUnreadablePlanCountAndSelectionAreBothNull()
        {
            var plan = Read(plugin =>
            {
                plugin.PlanCountUnreadable = true;
                plugin.SelectedPlanUnreadable = true;
            });

            Assert.Null(plan.PlanCount);
            Assert.Null(plan.SelectedPlan);
        }
    }

    /// <summary>
    /// The refusals. Each of these used to PERMIT on an unreadable read, which is
    /// the inverse-of-a-sentinel case: null meaning "no refusal" in the same
    /// function where null also means "the guard could not answer".
    /// </summary>
    public class PlanAbsenceRefusalTests
    {
        private const string Guid = "vessel-1";

        private static (FakePrincipiaPlugin Plugin, PlanCommands Commands) Wire(
            Action<FakePrincipiaPlugin>? arrange = null)
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 2);
            arrange?.Invoke(plugin);
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out var reason),
                reason);
            var source = new FakeSettingsSource
            {
                Session = session, ActiveVesselGuid = Guid, MassTons = 8.0,
            };
            var commands = new PlanCommands(() => source, PlanWriteTests.ViewingKerbin);
            commands.BindToCallingThread();
            return (plugin, commands);
        }

        private static Dictionary<string, object?> Receipt(
            CommandResult<Dictionary<string, object?>> result)
        {
            Assert.NotNull(result.Payload);
            return result.Payload!;
        }

        private static PrincipiaWriteOutcome Outcome(
            CommandResult<Dictionary<string, object?>> result) =>
            (PrincipiaWriteOutcome)(int)Receipt(result)["outcome"]!;

        private static PrincipiaWriteRefusal Refusal(
            CommandResult<Dictionary<string, object?>> result) =>
            (PrincipiaWriteRefusal)(int)Receipt(result)["refusal"]!;

        private static string Detail(CommandResult<Dictionary<string, object?>> result) =>
            (string)(Receipt(result)["refusalDetail"] ?? "");


        /// <summary>
        /// The guard's own unit. Each instant withdrawn on its own, and both, so the
        /// refusal is not resting on one of the two.
        /// </summary>
        [Theory]
        [InlineData(null, 3000.0)]
        [InlineData(2000.0, null)]
        [InlineData(null, null)]
        public void AnUnreadableInstantRefusesRatherThanPermitting(
            double? ignition, double? cutoff)
        {
            var result = PrincipiaBurnRules.RejectExecuting(ignition, cutoff, 2500.0);

            Assert.True(result.HasValue);
            Assert.Equal(PrincipiaWriteRefusal.GuardReadUnreadable, result!.Value.Refusal);
        }

        /// <summary>
        /// Not BurnExecuting. That code states the craft IS under thrust, and
        /// borrowing it for an answer nobody got would put the reason for the
        /// refusal into a sentence nobody read.
        /// </summary>
        [Fact]
        public void TheUnreadableRefusalDoesNotClaimTheBurnIsRunning()
        {
            var result = PrincipiaBurnRules.RejectExecuting(null, 3000.0, 2500.0);

            Assert.NotEqual(PrincipiaWriteRefusal.BurnExecuting, result!.Value.Refusal);
            Assert.Contains("ignition instant", result.Value.Detail);
            Assert.Contains("cannot be established", result.Value.Detail);
        }

        /// <summary>A readable window that the clock is outside still permits, so
        /// the guard has not been turned into a blanket refusal.</summary>
        [Fact]
        public void AReadableWindowOutsideTheClockStillPermits()
        {
            Assert.Null(PrincipiaBurnRules.RejectExecuting(1000.0, 2000.0, 2500.0));
        }

        /// <summary>
        /// <b>The destructive one.</b> A REMOVE against a burn whose ignition would
        /// not read used to come back Written, so the operator's own console
        /// confirmed it had deleted a burn that may have been under thrust. The
        /// plugin is asserted to have been left alone, because a refusal that still
        /// wrote would pass a receipt-only assertion.
        /// </summary>
        [Fact]
        public void RemovingABurnWithAnUnreadableIgnitionIsRefusedAndWritesNothing()
        {
            var (plugin, commands) = Wire();
            var armed = commands.Arm(
                new PrincipiaPlanArmArgs { VesselId = Guid, RequestId = "arm-1" });
            Assert.True(armed.Success, Detail(armed));
            plugin.Known(Guid).Burns[0].burn.initial_time = double.NaN;
            plugin.Writes.Clear();

            var refused = commands.RemoveBurn(
                new PrincipiaBurnRemoveArgs
                {
                    VesselId = Guid, RequestId = "r-1", BurnIndex = 0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Refused, Outcome(refused));
            Assert.Equal(PrincipiaWriteRefusal.GuardReadUnreadable, Refusal(refused));
            Assert.Empty(plugin.Writes);
            Assert.Equal(2, plugin.Known(Guid).Burns.Count);
        }


        /// <summary>
        /// The guard exists to stop a write Principia would revert with nothing
        /// reported anywhere, and `null >= 0` is false, so an unreadable answer fell
        /// through it into the write.
        /// </summary>
        [Fact]
        public void AWriteIsRefusedWhenTheOptimisationStateWillNotRead()
        {
            var (plugin, commands) = Wire();
            var armed = commands.Arm(
                new PrincipiaPlanArmArgs { VesselId = Guid, RequestId = "arm-1" });
            Assert.True(armed.Success, Detail(armed));
            plugin.OptimisationStateUnreadable = true;
            plugin.Writes.Clear();

            var refused = commands.RemoveBurn(
                new PrincipiaBurnRemoveArgs
                {
                    VesselId = Guid, RequestId = "r-1", BurnIndex = 0,
                });

            Assert.Equal(PrincipiaWriteRefusal.GuardReadUnreadable, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }


        /// <summary>
        /// The cap this Uplink cannot afford to overshoot: an eleventh plan makes
        /// Principia's own planner window throw on every layout pass, permanently,
        /// with the control that would delete it inside the part that stopped
        /// rendering. `null >= 10` is false, so an unreadable count permitted the
        /// duplicate.
        /// </summary>
        [Fact]
        public void DuplicatingIsRefusedWhenThePlanCountWillNotRead()
        {
            var (plugin, commands) = Wire();
            var armed = commands.Arm(
                new PrincipiaPlanArmArgs { VesselId = Guid, RequestId = "arm-1" });
            Assert.True(armed.Success, Detail(armed));
            plugin.PlanCountUnreadable = true;
            plugin.Writes.Clear();

            var refused = commands.DuplicatePlan(
                new PrincipiaPlanSlotArgs { VesselId = Guid, RequestId = "d-1" });

            Assert.Equal(PrincipiaWriteRefusal.GuardReadUnreadable, Refusal(refused));
            Assert.Empty(plugin.Writes);
            Assert.Equal(1, plugin.Known(Guid).Plans);
        }
    }

    /// <summary>
    /// The root cause, at the layer it lives on: the three decoders in
    /// <see cref="ReflectedPrincipiaPlugin"/>.
    ///
    /// <para>The reachable failure is the producer moving a return type between
    /// releases. Nothing fails to resolve when that happens: the name is still
    /// there, the bind succeeds, the invoke succeeds, and what comes back is a box
    /// this build cannot read. The stand-in forwarder below is that exactly, an
    /// audited call whose return type is a <c>long</c> where this build expects an
    /// <c>int</c>.</para>
    ///
    /// <para>Built through the private constructor rather than
    /// <c>TryBind</c>, which looks for Principia's own forwarder and correctly
    /// finds nothing in a test process.</para>
    /// </summary>
    public class ReflectedDecoderAbsenceTests
    {
        /// <summary>
        /// Stands in for Principia's forwarder after a release moved two return
        /// types. The names are audited ones; only the types have shifted.
        /// </summary>
        private static class MovedReturnTypes
        {
            internal static long FlightPlanNumberOfAnomalousManoeuvres(
                IntPtr plugin, string vesselGuid) => 3;

            internal static float FlightPlanGetActualFinalTime(IntPtr plugin, string vesselGuid) =>
                8000f;

            internal static int HasVessel(IntPtr plugin, string vesselGuid) => 1;
        }

        private static IPrincipiaPlugin Bound(params string[] names)
        {
            var methods = new Dictionary<string, MethodInfo>();
            foreach (var name in names)
            {
                var method = typeof(MovedReturnTypes).GetMethod(
                    name, BindingFlags.Static | BindingFlags.NonPublic);
                Assert.NotNull(method);
                methods[name] = method!;
            }

            var ctor = typeof(ReflectedPrincipiaPlugin).GetConstructors(
                BindingFlags.Instance | BindingFlags.NonPublic)[0];
            return (IPrincipiaPlugin)ctor.Invoke(new object?[] { methods, string.Empty });
        }

        /// <summary>
        /// Zero is what the operator was told, and zero anomalous manoeuvres means
        /// the integrator flagged nothing. The producer had flagged three.
        /// </summary>
        [Fact]
        public void AnIntThatCameBackAsALongDecodesToNullRatherThanZero()
        {
            var plugin = Bound("FlightPlanNumberOfAnomalousManoeuvres");

            Assert.Null(plugin.FlightPlanNumberOfAnomalousManoeuvres(IntPtr.Zero, "v"));
        }

        /// <summary>The double twin. 0.0 universal time is Year 1 Day 1, so an
        /// unreadable instant read as the very start of the campaign.</summary>
        [Fact]
        public void ADoubleThatCameBackAsAFloatDecodesToNullRatherThanZero()
        {
            var plugin = Bound("FlightPlanGetActualFinalTime");

            Assert.Null(plugin.FlightPlanGetActualFinalTime(IntPtr.Zero, "v"));
        }

        /// <summary>
        /// The bool twin FAILS CLOSED instead of answering null, and that is the
        /// deliberate difference. Every call behind this predicate aborts the
        /// process on a guid the plugin does not hold, so "we could not tell" has
        /// to stop the lookup rather than travel up as a null for a caller to
        /// resolve.
        /// </summary>
        [Fact]
        public void AnUnreadableSafetyPredicateFailsClosedRatherThanTravelling()
        {
            var plugin = Bound("HasVessel");

            Assert.False(plugin.HasVessel(IntPtr.Zero, "v"));
        }
    }
}
