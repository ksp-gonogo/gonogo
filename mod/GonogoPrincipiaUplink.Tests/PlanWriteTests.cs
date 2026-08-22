using System;
using System.Collections.Generic;
using System.Linq;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The flight-plan write surface, driven end to end through the real command
    /// handlers against a plugin double that faults wherever the real one aborts
    /// and corrupts wherever the real one corrupts.
    ///
    /// <para><b>Nothing here is hand-set open.</b> The write authority is built by
    /// <c>PrincipiaSession.TryBind</c> from the double's own version string and its
    /// own answer about whether the write entry points bound; the arm comes from
    /// running the real <c>principia.plan.arm</c> command, which runs the real
    /// round-trip probe. There is no flag a test flips to make an edit reachable,
    /// which is the defect this Uplink's sibling slice shipped: every test of the
    /// integrator passed, every test of the seam passed, and the wiring between
    /// them was where it was broken.</para>
    /// </summary>
    public class PlanWriteTests
    {
        private const string Guid = "vessel-1";

        /// <summary>
        /// A bound session, a settings source pointing at it, and the real command
        /// handlers over the top: the production chain minus the two things that
        /// need a running KSP (finding the addon, and the host's own command pump).
        /// </summary>
        private static (FakePrincipiaPlugin Plugin, PlanCommands Commands)
            Wire(Action<FakePrincipiaPlugin>? arrange = null)
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 2);
            arrange?.Invoke(plugin);
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out var reason),
                reason);
            var source = new FakeSettingsSource { Session = session, ActiveVesselGuid = Guid };
            var commands = new PlanCommands(() => source);
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

        private static Dictionary<string, object?>? Plan(
            CommandResult<Dictionary<string, object?>> result) =>
            Receipt(result)["plan"] as Dictionary<string, object?>;

        private static CommandResult<Dictionary<string, object?>> Armed(
            PlanCommands commands, string request = "arm-1")
        {
            var armed = commands.Arm(new PrincipiaPlanArmArgs { VesselId = Guid, RequestId = request });
            Assert.True(armed.Success, Detail(armed));
            return armed;
        }


        /// <summary>
        /// The zero value of both enums reads as "we did not touch the plan", so a
        /// producer that forgot to fill the field, or a consumer reading a payload
        /// from one that never had it, lands on the safe answer.
        ///
        /// <para>This is the shape that shipped wrong once already, as an
        /// "unspecified" refusal in the zero slot that read as "nothing was
        /// refused". A silent no-op looked identical to a working feature from
        /// outside.</para>
        /// </summary>
        [Fact]
        public void TheDefaultOutcomeIsRefusedAndTheDefaultRefusalIsNotNothing()
        {
            var receipt = new PrincipiaPlanWriteReceipt();

            Assert.Equal(PrincipiaWriteOutcome.Refused, receipt.Outcome);
            Assert.Equal(PrincipiaWriteRefusal.SurfaceUnavailable, receipt.Refusal);
            Assert.Equal(0, (int)PrincipiaWriteOutcome.Refused);
            Assert.Equal(0, (int)PrincipiaWriteRefusal.SurfaceUnavailable);

            // And the "nothing refused it" member is deliberately NOT zero, so it
            // can only appear where something actually set it.
            Assert.NotEqual(0, (int)PrincipiaWriteRefusal.NotRefused);
        }

        /// <summary>
        /// A refusal reaches the plugin zero times and says which guard stopped it;
        /// a write the producer declines reaches it once and carries the producer's
        /// own code. From outside, the two are told apart by
        /// <c>outcome</c>, not inferred from a missing field.
        /// </summary>
        [Fact]
        public void ARefusalAndADeclinedWriteAreDistinguishableOnTheWire()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Writes.Clear();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "r1", BurnIndex = 9 });

            Assert.Equal(PrincipiaWriteOutcome.Refused, Outcome(refused));
            Assert.Equal(PrincipiaWriteRefusal.BurnIndexOutOfRange, Refusal(refused));
            Assert.Null(Receipt(refused)["statusError"]);
            Assert.Empty(plugin.Writes);

            plugin.Status = FakeStatus.Declined(11, "The manœuvre does not fit between its neighbours.");
            var declined = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "r2", BurnIndex = 0 });

            Assert.Equal(PrincipiaWriteOutcome.Rejected, Outcome(declined));
            Assert.Equal(PrincipiaWriteRefusal.NotRefused, Refusal(declined));
            Assert.Equal(11, Receipt(declined)["statusError"]);
            Assert.Contains("does not fit", (string)Receipt(declined)["statusMessage"]!);
            Assert.Equal(new[] { "Replace@0" }, plugin.Writes);
        }


        /// <summary>
        /// A build whose write entry points did not bind still reads. The plan
        /// channel carries a sample, the write surface says it is unavailable and
        /// why, and no write is attempted.
        /// </summary>
        [Fact]
        public void WritesThatDidNotBindFailClosedWithTheReadsIntact()
        {
            var (plugin, commands) = Wire(p => p.WriteEntryPointsBound = false);
            plugin.Writes.Clear();

            var armed = commands.Arm(new PrincipiaPlanArmArgs { VesselId = Guid, RequestId = "a" });

            Assert.False(armed.Success);
            Assert.Equal(PrincipiaWriteRefusal.SurfaceUnavailable, Refusal(armed));
            Assert.Contains("not the shape", Detail(armed));
            Assert.Empty(plugin.Writes);

            // The read half is untouched: the plan is still published, with the
            // write surface described as closed rather than absent.
            var plan = new PlanReader().Read(
                new FakeSettingsSource { Session = null }.Session, Guid, 1000.0);
            Assert.Null(plan);

            var edit = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "e", BurnIndex = 0 });
            Assert.Equal(PrincipiaWriteRefusal.SurfaceUnavailable, Refusal(edit));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>
        /// The write authority compares the build against its OWN constant, not the
        /// session's. They hold the same string today and answer different
        /// questions, and the separation is what stops a future decision to keep
        /// reading across a version bump carrying the writes with it.
        /// </summary>
        [Fact]
        public void TheWriteVersionGateIsItsOwnConstant()
        {
            Assert.Equal(
                PrincipiaSession.AnalysedPluginVersion,
                PrincipiaWriteAuthority.WriteAnalysedPluginVersion);

            var stale = new PrincipiaWriteAuthority("2026091100-Later-0-gdeadbeef", true, "");

            Assert.False(stale.Available);
            Assert.Contains("not analysed for flight-plan WRITES", stale.UnavailableReason);
            Assert.Contains("2026091100-Later-0-gdeadbeef", stale.UnavailableReason);
            Assert.False(stale.IsArmed(Guid));
        }


        /// <summary>
        /// An edit before arming is refused, and the SAME edit after the real arm
        /// command lands. Nothing between the two is hand-set.
        /// </summary>
        [Fact]
        public void AnEditIsRefusedUntilTheArmCommandHasRun()
        {
            var (plugin, commands) = Wire();
            plugin.Writes.Clear();

            var before = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "before", BurnIndex = 0, DeltaVTangent = 12.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.NotArmed, Refusal(before));
            Assert.Empty(plugin.Writes);

            Armed(commands);
            plugin.Writes.Clear();

            var after = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "after", BurnIndex = 0, DeltaVTangent = 12.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(after));
            Assert.Equal(new[] { "Replace@0" }, plugin.Writes);
            Assert.Equal(12.0, plugin.Known(Guid).Burns[0].burn.intensity.xyz.x);
        }

        /// <summary>
        /// Arming IS the probe: it reads Principia's own burn, hands the identical
        /// burn straight back, and reads again. Those writes are the probe's, and a
        /// test can see them.
        /// </summary>
        [Fact]
        public void ArmingRoundTripsBothStructsThroughThePlugin()
        {
            var (plugin, commands) = Wire();
            plugin.Writes.Clear();

            var armed = Armed(commands);

            Assert.Equal(
                new[] { "SetAdaptiveStepParameters", "Replace@0" }, plugin.Writes);
            var surface = (Dictionary<string, object?>)Plan(armed)!["writeSurface"]!;
            Assert.Equal(true, surface["available"]);
            Assert.Equal(true, surface["armed"]);
            Assert.Null(surface["reason"]);
        }

        /// <summary>
        /// A burn that does NOT survive the round trip leaves the surface unarmed
        /// for burn edits, with the probe's own finding on the wire.
        ///
        /// <para>This is the platform struct-layout failure the write report calls
        /// its largest unverified risk, modelled the only way it presents from the
        /// managed side: nothing throws, nothing fails to resolve, and one field
        /// comes back different.</para>
        /// </summary>
        [Fact]
        public void ABurnThatDoesNotSurviveTheRoundTripRefusesEveryBurnEdit()
        {
            var (plugin, commands) = Wire(p => p.MisreadsThrustAfterAWrite = true);

            // Arming still succeeds, for the struct that DID survive, and the
            // failure travels on the write surface rather than being collapsed into
            // a single yes-or-no. A plan whose step budget can still be raised is
            // not helped by refusing the whole surface.
            var armed = Armed(commands);
            var surface = (Dictionary<string, object?>)Plan(armed)!["writeSurface"]!;
            Assert.Equal(true, surface["armed"]);
            Assert.Contains("did not survive a round trip", (string)surface["reason"]!);

            plugin.Writes.Clear();
            var edit = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "e", BurnIndex = 0 });

            Assert.Equal(PrincipiaWriteRefusal.LayoutUnverified, Refusal(edit));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>
        /// A plan with no burns has nothing to round-trip, so burn edits stay
        /// refused. The step-parameter remedy is NOT withheld with them, which is
        /// the whole reason the two verdicts are separate: a plan that drew no burns
        /// is the plan most likely to need its step budget raised.
        /// </summary>
        [Fact]
        public void APlanWithNoBurnsStillGetsTheStepParameterRemedy()
        {
            var (plugin, commands) = Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0));

            Armed(commands);
            plugin.Writes.Clear();

            var burnEdit = commands.InsertBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "b", BurnIndex = 0 });
            Assert.Equal(PrincipiaWriteRefusal.LayoutUnverified, Refusal(burnEdit));

            var raise = commands.SetIntegrator(
                new PrincipiaPlanIntegratorArgs
                {
                    VesselId = Guid, RequestId = "i", MaxSteps = 65_536,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(raise));
            Assert.Equal(65_536, plugin.Known(Guid).StepParameters.max_steps);
        }


        /// <summary>
        /// Deleting asks whether a plan exists ONE MORE TIME, immediately before the
        /// call, and refuses rather than reaching the entry point.
        ///
        /// <para>The double raises on the delete path when there is no plan because
        /// the real one does something worse than raise: it erases an iterator one
        /// before the start of its vector, with no assertion and no log line, while
        /// its own header comment promises it performs no action. A test that
        /// reached the entry point here would have found the hole that comment
        /// hides.</para>
        /// </summary>
        [Fact]
        public void DeleteRefusesRatherThanReachingTheEntryPointWithNoPlan()
        {
            var (plugin, commands) = Wire();
            Armed(commands);

            // The plan goes away between arming and the delete, which is exactly the
            // window a header comment cannot close.
            plugin.Add(Guid, hasFlightPlan: false, manoeuvres: 0);
            plugin.Writes.Clear();

            var deleted = commands.DeletePlan(
                new PrincipiaPlanSlotArgs { VesselId = Guid, RequestId = "d" });

            Assert.Equal(PrincipiaWriteRefusal.NoFlightPlan, Refusal(deleted));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>The gate's own re-check, reached with a plan that exists at the
        /// gate and not at the call. The gate is minted from a proof of existence,
        /// so this is the only way to exercise the second look.</summary>
        [Fact]
        public void TheDeleteGateChecksAgainAfterTheGateWasMinted()
        {
            var plugin = new FakePrincipiaPlugin();
            var vessel = plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 1);
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out _));
            session!.Writes.Arm(Guid);

            Assert.True(session.TryBeginFrame(out var frame));
            using (frame)
            {
                Assert.True(frame!.TryVessel(Guid, out var v));
                Assert.True(v.TryFlightPlan(out var plan));
                var materialised = plan.Materialise();
                Assert.True(materialised.TryWrite(out var gate, out _, out _));

                // The plan is gone AFTER the gate proved it was there.
                vessel.HasFlightPlan = false;
                plugin.Writes.Clear();

                var result = gate.Delete();

                Assert.Equal(PrincipiaWriteOutcome.Refused, result.Outcome);
                Assert.Equal(PrincipiaWriteRefusal.NoFlightPlan, result.Refusal);
                Assert.Contains("erases past the beginning", result.Detail);
                Assert.Empty(plugin.Writes);
            }
        }


        /// <summary>
        /// A step-parameter write changes exactly three fields and leaves both
        /// integrator kinds as they came out of the plugin.
        /// </summary>
        [Fact]
        public void AStepParameterWriteNeverTouchesEitherIntegratorKind()
        {
            var (plugin, commands) = Wire();
            Armed(commands);

            var written = commands.SetIntegrator(
                new PrincipiaPlanIntegratorArgs
                {
                    VesselId = Guid,
                    RequestId = "i",
                    MaxSteps = 4096,
                    LengthToleranceMetres = 10.0,
                    SpeedToleranceMetresPerSecond = 10.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            var parameters = plugin.Known(Guid).StepParameters;
            Assert.Equal(4096, parameters.max_steps);
            Assert.Equal(10.0, parameters.length_integration_tolerance);
            Assert.Equal(10.0, parameters.speed_integration_tolerance);
            Assert.Equal(1, parameters.integrator_kind);
            Assert.Equal(2, parameters.generalized_integrator_kind);
        }

        /// <summary>
        /// A struct whose kinds read back swapped is refused before the call. The
        /// double raises on the swap because the real one calls <c>abort()</c> with
        /// no message and no log line, which is the least diagnosable failure on the
        /// whole surface.
        /// </summary>
        [Fact]
        public void SwappedIntegratorKindsAreRefusedBeforeTheCall()
        {
            var swapped = new FakeStepParameters(1.0, 1024)
            {
                integrator_kind = 2,
                generalized_integrator_kind = 1,
            };

            var refused = PrincipiaIntegratorRules.Reject(swapped);

            Assert.NotNull(refused);
            Assert.Equal(PrincipiaWriteRefusal.IntegratorKindUnexpected, refused!.Value.Refusal);
            Assert.Contains("disjoint sets", refused.Value.Detail);
        }

        [Theory]
        [InlineData(32.0)]
        [InlineData(2_097_152.0)]
        public void AStepLimitOutsideTheProducersOwnRangeIsRefused(double steps)
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Writes.Clear();

            var refused = commands.SetIntegrator(
                new PrincipiaPlanIntegratorArgs
                {
                    VesselId = Guid, RequestId = "i", MaxSteps = steps,
                });

            Assert.Equal(PrincipiaWriteRefusal.IntegratorBoundsExceeded, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }


        /// <summary>
        /// Three frame kinds may go back to the plugin and the rest may not. One of
        /// the refused pair is a fatal log inside the plugin, guarded on Principia's
        /// own side only by a cast operator that answers null, which is invisible
        /// from here.
        /// </summary>
        [Theory]
        [InlineData(6000, true)]
        [InlineData(6001, false)]
        [InlineData(6002, true)]
        [InlineData(6003, true)]
        [InlineData(6004, false)]
        public void OnlyThreeBurnFrameKindsMayBeWrittenBack(int extension, bool editable)
        {
            Assert.Equal(editable, PrincipiaBurnStruct.IsEditableFrame(extension));

            var burn = new FakeBurn(new FakeBurnFrameParameters(extension, 1, -1, -1));
            var refused = PrincipiaBurnRules.Reject(burn);

            if (editable)
            {
                Assert.Null(refused);
                return;
            }
            Assert.NotNull(refused);
            Assert.Equal(PrincipiaWriteRefusal.BurnFrameUnsupported, refused!.Value.Refusal);
            Assert.Contains("fatal log", refused.Value.Detail);
        }

        /// <summary>
        /// A burn already carrying a refused frame is refused even when the edit
        /// touches nothing about the frame, because the burn goes back whole.
        /// </summary>
        [Fact]
        public void ABurnAlreadyInARefusedFrameCannotBeEditedAtAll()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Known(Guid).Burns[1].burn.frame = new FakeBurnFrameParameters(6004, 0, 0, 1);
            plugin.Writes.Clear();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 1, IgnitionUt = 5000.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.BurnFrameUnsupported, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }


        /// <summary>
        /// An edit while the producer's optimiser is running is refused rather than
        /// raced, and the refusal names the burn being optimised so an operator can
        /// go and stop it.
        /// </summary>
        [Fact]
        public void AnEditIsRefusedWhileAnOptimisationIsRunning()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Known(Guid).OptimisingBurn = 1;
            plugin.Writes.Clear();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "e", BurnIndex = 0 });

            Assert.Equal(PrincipiaWriteRefusal.OptimisationRunning, Refusal(refused));
            Assert.Contains("burn 2", Detail(refused));
            Assert.Empty(plugin.Writes);
        }


        /// <summary>
        /// Duplicating stops at ten. Nothing native does, and the double does not
        /// either, so this cap is entirely ours and the test proves ours rather than
        /// the double's.
        /// </summary>
        [Fact]
        public void DuplicateStopsAtTenPlansBecauseNothingElseDoes()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Known(Guid).Plans = 10;
            plugin.Known(Guid).HasFlightPlan = true;
            plugin.Writes.Clear();

            var refused = commands.DuplicatePlan(
                new PrincipiaPlanSlotArgs { VesselId = Guid, RequestId = "d" });

            Assert.Equal(PrincipiaWriteRefusal.PlanSlotsFull, Refusal(refused));
            Assert.Contains("10", Detail(refused));
            Assert.Empty(plugin.Writes);

            Assert.Equal(10, PrincipiaPlanWriteGate.MaxFlightPlans);
        }

        /// <summary>Creating on a vessel that already has a plan is refused: the
        /// producer appends and selects rather than replacing, so this would give
        /// the vessel a plan nobody asked for.</summary>
        [Fact]
        public void CreateRefusesWhenAPlanAlreadyExists()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Writes.Clear();

            var refused = commands.CreatePlan(
                new PrincipiaPlanSlotArgs { VesselId = Guid, RequestId = "c", MassTons = 10.0 });

            Assert.Equal(PrincipiaWriteRefusal.PlanAlreadyExists, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>An end instant before now is an assertion failure inside the
        /// producer rather than an error return, so it is refused here.</summary>
        [Fact]
        public void CreateRefusesAnEndInstantBeforeNow()
        {
            var (plugin, commands) = Wire(p => p.Add(Guid, hasFlightPlan: false));
            // Arming needs a plan, so this vessel cannot be armed; arm it directly
            // on the authority, which is the only step being skipped.
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out _));
            session!.Writes.Arm(Guid);
            var commandsForCreate = new PlanCommands(
                () => new FakeSettingsSource { Session = session, ActiveVesselGuid = Guid });
            commandsForCreate.BindToCallingThread();
            plugin.Writes.Clear();

            var refused = commandsForCreate.CreatePlan(
                new PrincipiaPlanSlotArgs
                {
                    VesselId = Guid, RequestId = "c", FinalTimeUt = 10.0, MassTons = 10.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.FinalTimeInPast, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }


        /// <summary>
        /// A burn that is running right now is not editable. Principia permits it,
        /// warns about nothing, and only its rebase entry point checks, so this
        /// refusal is entirely the console's.
        /// </summary>
        [Fact]
        public void ABurnInProgressIsRefused()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            // Ignition 2000, cutoff 3000, and the clock inside the burn.
            plugin.CurrentTimeValue = 2500.0;
            plugin.Writes.Clear();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 0, DeltaVTangent = 1.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.BurnExecuting, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>A burn wholly in the past IS editable. It cannot be re-flown,
        /// tidying a plan is a real thing to want, and the producer's own window
        /// allows it too.</summary>
        [Fact]
        public void ABurnInThePastIsStillEditable()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.CurrentTimeValue = 9999.0;
            plugin.Writes.Clear();

            var written = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 0, DeltaVTangent = 3.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            Assert.Equal(new[] { "Replace@0" }, plugin.Writes);
        }

        [Theory]
        [InlineData(1000.0, 2000.0, 500.0, false)]
        [InlineData(1000.0, 2000.0, 1000.0, true)]
        [InlineData(1000.0, 2000.0, 1500.0, true)]
        [InlineData(1000.0, 2000.0, 2000.0, true)]
        [InlineData(1000.0, 2000.0, 2500.0, false)]
        public void TheExecutingWindowIsClosedAtBothEnds(
            double ignition, double cutoff, double now, bool refused)
        {
            var result = PrincipiaBurnRules.RejectExecuting(ignition, cutoff, now);
            Assert.Equal(refused, result.HasValue);
        }


        /// <summary>
        /// An insert copies a burn already in the plan. A plan with no burns is
        /// refused rather than served from constants, because a composed burn is a
        /// bet on a struct layout and a copied one is not.
        /// </summary>
        [Fact]
        public void AnInsertWithNoBurnToCopyIsRefused()
        {
            var (plugin, commands) = Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0));
            // The burn probe cannot run with no burns, so arm on a plan that has one
            // and then empty it: the point under test is the template, not the arm.
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 1);
            Armed(commands);
            plugin.Known(Guid).Burns.Clear();
            plugin.Writes.Clear();

            var refused = commands.InsertBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "i", BurnIndex = 0 });

            Assert.Equal(PrincipiaWriteRefusal.NoTemplateBurn, Refusal(refused));
            Assert.Contains("never assembles one from constants", Detail(refused));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>
        /// An insert takes an index EQUAL to the burn count, which appends, where a
        /// replace at the same index would abort. The two bounds differ by one and
        /// the difference is a process abort, so it is asserted rather than assumed.
        /// </summary>
        [Fact]
        public void InsertAcceptsTheCountAndReplaceDoesNot()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Writes.Clear();

            var appended = commands.InsertBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "i", BurnIndex = 2 });
            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(appended));
            Assert.Equal(3, plugin.Known(Guid).Burns.Count);

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "r", BurnIndex = 3 });
            Assert.Equal(PrincipiaWriteRefusal.BurnIndexOutOfRange, Refusal(refused));
            Assert.Equal(new[] { "Insert@2" }, plugin.Writes);
        }

        /// <summary>
        /// An omitted field leaves the plugin's own value alone, which is what makes
        /// the edit a round trip. Only the tangential component moves here; the
        /// other two and the thrust come back unchanged.
        /// </summary>
        [Fact]
        public void AnOmittedFieldKeepsThePluginsOwnValue()
        {
            var (plugin, commands) = Wire();
            var burn = plugin.Known(Guid).Burns[0].burn;
            burn.intensity = new FakeIntensity
            {
                coordinate_system_ = 1,
                xyz = new FakeXyz { x = 1.0, y = 2.0, z = 3.0 },
            };
            burn.thrust_in_kilonewtons = 77.0;
            Armed(commands);

            var written = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 0, DeltaVNormal = 9.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            var after = plugin.Known(Guid).Burns[0].burn;
            Assert.Equal(1.0, after.intensity.xyz.x);
            Assert.Equal(9.0, after.intensity.xyz.y);
            Assert.Equal(3.0, after.intensity.xyz.z);
            Assert.Equal(77.0, after.thrust_in_kilonewtons);
        }

        /// <summary>
        /// Writing components onto a burn expressed in one of the producer's
        /// SPHERICAL coordinate systems is refused. The plugin would read a
        /// magnitude and two angles instead, so the burn would come back unchanged
        /// and look exactly like a write that landed.
        /// </summary>
        [Fact]
        public void AComponentEditOnASphericalBurnIsRefused()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            var burn = plugin.Known(Guid).Burns[0].burn;
            burn.intensity = new FakeIntensity { coordinate_system_ = 2 };
            plugin.Writes.Clear();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 0, DeltaVTangent = 5.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.BurnFrameUnsupported, Refusal(refused));
            Assert.Contains("look like a write that landed", Detail(refused));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>A time-only edit on a spherical burn is fine: the components are
        /// what the coordinate system governs, not the instant.</summary>
        [Fact]
        public void ATimeEditOnASphericalBurnIsAllowed()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Known(Guid).Burns[0].burn.intensity = new FakeIntensity { coordinate_system_ = 2 };

            var written = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 0, IgnitionUt = 2500.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            Assert.Equal(2500.0, plugin.Known(Guid).Burns[0].burn.initial_time);
        }

        /// <summary>
        /// Zero thrust is refused. Principia's own singularity test does not catch
        /// it because it tests the Dv, so the duration becomes infinite, the plan's
        /// end instant becomes infinite, a thread is spawned that never terminates,
        /// and the infinity is written into the save.
        /// </summary>
        [Fact]
        public void ZeroThrustIsRefused()
        {
            var burn = new FakeBurn { thrust_in_kilonewtons = 0.0 };

            var refused = PrincipiaBurnRules.Reject(burn);

            Assert.NotNull(refused);
            Assert.Equal(PrincipiaWriteRefusal.ThrustNotPositive, refused!.Value.Refusal);
            Assert.Contains("never terminates", refused.Value.Detail);
        }

        /// <summary>
        /// Instant impulse uses the producer's own numbers, read off the installed
        /// build: thrust a thousand times the mass in tonnes, and a specific impulse
        /// of a thousand seconds. A different pair would draw a different arc.
        /// </summary>
        [Fact]
        public void InstantImpulseUsesTheProducersOwnNumbers()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Known(Guid).Burns[0].initial_mass_in_tonnes = 12.5;

            var written = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid,
                    RequestId = "e",
                    BurnIndex = 0,
                    Profile = PrincipiaBurnProfile.InstantImpulse,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            var after = plugin.Known(Guid).Burns[0].burn;
            Assert.Equal(12_500.0, after.thrust_in_kilonewtons);
            Assert.Equal(1000.0, after.specific_impulse_in_seconds_g0);
        }

        /// <summary>A field this Uplink must set and cannot find is a named refusal,
        /// never a half-applied edit.</summary>
        [Fact]
        public void AMissingFieldOnThePluginsOwnStructIsANamedRefusal()
        {
            var refused = PrincipiaBurnRules.Reject(new { thrust_in_kilonewtons = 1.0 });

            Assert.NotNull(refused);
            Assert.Equal(PrincipiaWriteRefusal.PluginShapeChanged, refused!.Value.Refusal);
        }


        /// <summary>
        /// The receipt carries a reading of the plan taken AFTER the write, in the
        /// same frame, so a client can see what changed rather than take our word
        /// for it. A shortened horizon that dropped a burn is visible in the burn
        /// count.
        /// </summary>
        [Fact]
        public void TheReceiptCarriesAFreshReadingOfThePlan()
        {
            var (plugin, commands) = Wire();
            Armed(commands);

            var removed = commands.RemoveBurn(
                new PrincipiaBurnRemoveArgs { VesselId = Guid, RequestId = "x", BurnIndex = 0 });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(removed));
            var plan = Plan(removed);
            Assert.NotNull(plan);
            var burns = (List<object?>)plan!["burns"]!;
            Assert.Single(burns);
        }

        /// <summary>
        /// A retry that reuses its request id replays the receipt and does NOT write
        /// again. A plan write re-integrates synchronously, so repeating one is
        /// expensive as well as wrong, and this is what makes a retry safe to send.
        /// </summary>
        [Fact]
        public void AReusedRequestIdReplaysInsteadOfWritingAgain()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Writes.Clear();

            var first = commands.RemoveBurn(
                new PrincipiaBurnRemoveArgs { VesselId = Guid, RequestId = "same", BurnIndex = 0 });
            var again = commands.RemoveBurn(
                new PrincipiaBurnRemoveArgs { VesselId = Guid, RequestId = "same", BurnIndex = 0 });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(first));
            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(again));
            Assert.Equal(false, Receipt(first)["replayed"]);
            Assert.Equal(true, Receipt(again)["replayed"]);
            Assert.Equal(new[] { "Remove@0" }, plugin.Writes);
            Assert.Single(plugin.Known(Guid).Burns);
        }

        /// <summary>A replay reports the outcome, the guard AND the typed code it
        /// reported the first time, including a failure: the honest answer to "what
        /// happened to request 7" does not change on being asked twice, and a client
        /// branching on the coarse code must not see it move under a retry.</summary>
        [Fact]
        public void AReplayedRefusalIsStillARefusal()
        {
            var (plugin, commands) = Wire();
            Armed(commands);

            var first = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "r", BurnIndex = 40 });
            var again = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "r", BurnIndex = 40 });

            Assert.False(first.Success);
            Assert.False(again.Success);
            Assert.Equal(PrincipiaWriteRefusal.BurnIndexOutOfRange, Refusal(again));
            Assert.Equal(true, Receipt(again)["replayed"]);
            // The coarse code too, and it must be the SAME one: a client that
            // branches on the shared vocabulary would otherwise see a retry turn
            // "the burn is not in this plan" into something else.
            Assert.Equal(CommandErrorCode.NotFound, first.ErrorCode);
            Assert.Equal(first.ErrorCode, again.ErrorCode);
        }


        /// <summary>
        /// A write arriving off the thread the host registered us on is refused.
        ///
        /// <para>Principia's plan members are main-thread only and a write destroys
        /// trajectory segments a renderer may be walking. The host does marshal
        /// commands onto the main thread, but only when it was built to, and the
        /// flag defaults off. An assumption that cannot express its own violation is
        /// the shape of defect this repo keeps finding, so it is a comparison.</para>
        /// </summary>
        [Fact]
        public void AWriteOffTheRegisteredThreadIsRefused()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Writes.Clear();

            CommandResult<Dictionary<string, object?>>? offThread = null;
            var worker = new System.Threading.Thread(
                () => offThread = commands.ReplaceBurn(
                    new PrincipiaBurnEditArgs
                    {
                        VesselId = Guid, RequestId = "t", BurnIndex = 0,
                    }));
            worker.Start();
            worker.Join();

            Assert.NotNull(offThread);
            Assert.Equal(PrincipiaWriteRefusal.SurfaceUnavailable, Refusal(offThread!));
            Assert.Contains("off the game's main thread", Detail(offThread!));
            Assert.Empty(plugin.Writes);
        }


        [Fact]
        public void AVesselThePluginNoLongerKnowsIsRefusedRatherThanLookedUp()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.Destroy(Guid);
            plugin.Writes.Clear();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "e", BurnIndex = 0 });

            Assert.Equal(PrincipiaWriteRefusal.VesselUnknown, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }
    }
}
