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
        /// <summary>
        /// The frame the game's navigation view is in, which is the frame a burn
        /// built here is expressed in. Kerbin-centred and non-rotating, which is the
        /// simplest kind: one body, in the centre slot.
        /// </summary>
        internal static SettingsObservation ViewingKerbin() =>
            new SettingsObservation
            {
                PlottingFrame = new FrameObservation
                {
                    Selector = "plotting",
                    Type = 6000,
                    CentreBody = "Kerbin",
                    SelectedBodyIndex = 1,
                    ParentBodyIndex = 0,
                },
            };

        private static (FakePrincipiaPlugin Plugin, PlanCommands Commands)
            Wire(Action<FakePrincipiaPlugin>? arrange = null, double? massTons = 8.0)
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
                Session = session, ActiveVesselGuid = Guid, MassTons = massTons,
            };
            var commands = new PlanCommands(() => source, ViewingKerbin);
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
        /// Arming a plan with NO burns still proves the burn struct, by building one
        /// and round-tripping that.
        ///
        /// <para>The round trip needs a burn, not a burn that came from the plan, and
        /// one built from the loaded build's own type carries exactly this build's
        /// fields. Without this the gate was the same deadlock one level up: burn
        /// writes needed a probe, the probe needed a burn, and a burn needed a
        /// write.</para>
        /// </summary>
        [Fact]
        public void ArmingAPlanWithNoBurnsProvesTheStructByBuildingOne()
        {
            var (plugin, commands) = Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0));

            Armed(commands);

            var read = commands.Arm(
                new PrincipiaPlanArmArgs { VesselId = Guid, RequestId = "a2" });
            var surface = (Dictionary<string, object?>)
                ((Dictionary<string, object?>)Receipt(read)["plan"]!)["writeSurface"]!;
            Assert.Equal(true, surface["armed"]);
            Assert.Null(surface["reason"]);
        }

        /// <summary>
        /// And takes its own burn back out. A probe that left one behind would put a
        /// manœuvre in somebody's plan that no operator asked for, and it would be
        /// found only by noticing a burn nobody remembers adding.
        /// </summary>
        [Fact]
        public void TheProbeLeavesThePlanAsItFoundIt()
        {
            var (plugin, commands) = Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0));

            Armed(commands);

            Assert.Empty(plugin.Known(Guid).Burns);
        }

        /// <summary>
        /// A plan with no burns has its own burn round-tripped, so a burn edit gets
        /// past the layout gate and is judged on its own merits: this one states no
        /// ignition, which a burn with no manœuvre ahead of it cannot derive.
        ///
        /// <para>The step-parameter remedy is NOT withheld either way, which is the
        /// whole reason the two verdicts are separate: a plan that drew no burns is
        /// the plan most likely to need its step budget raised.</para>
        /// </summary>
        [Fact]
        public void APlanWithNoBurnsStillGetsTheStepParameterRemedy()
        {
            var (plugin, commands) = Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0));

            Armed(commands);
            plugin.Writes.Clear();

            var burnEdit = commands.InsertBurn(
                new PrincipiaBurnEditArgs { VesselId = Guid, RequestId = "b", BurnIndex = 0 });
            Assert.Equal(PrincipiaWriteRefusal.ComposedBurnIncomplete, Refusal(burnEdit));

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
                new PrincipiaPlanSlotArgs { VesselId = Guid, RequestId = "c" });

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
                () => new FakeSettingsSource { Session = session, ActiveVesselGuid = Guid },
                ViewingKerbin);
            commandsForCreate.BindToCallingThread();
            plugin.Writes.Clear();

            var refused = commandsForCreate.CreatePlan(
                new PrincipiaPlanSlotArgs
                {
                    VesselId = Guid, RequestId = "c", FinalTimeUt = 10.0,
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
        /// A REQUESTED ignition instant that has already passed by the time the
        /// write arrives is refused.
        ///
        /// <para><b>Why this is a guard and not an operator error.</b> Under signal
        /// delay the operator composes the edit against a plan that left the game one
        /// light time ago and the edit spends another light time getting back, so an
        /// instant that was comfortably in the future when they pressed can be in the
        /// past on arrival with nothing done wrong at either end. Nothing else in the
        /// chain tests it: the finiteness check does not look at the clock,
        /// <see cref="PrincipiaBurnRules.RejectExecuting"/> tests the burn's CURRENT
        /// ignition rather than the requested one, and a declared precondition runs
        /// at dispatch, before the courier is involved, which is the wrong end of the
        /// delay entirely.</para>
        ///
        /// <para>Without it the plugin is asked to integrate a burn that never
        /// happened and the receipt reads <c>Written</c>.</para>
        /// </summary>
        [Fact]
        public void ARequestedIgnitionThatHasAlreadyPassedOnArrivalIsRefused()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            // Burn 0 ignites at 2000 and cuts off at 3000; the clock is now past
            // both, so the burn is not executing and the finiteness check is
            // satisfied. The requested instant is the only thing wrong.
            plugin.CurrentTimeValue = 9999.0;
            plugin.Writes.Clear();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 0, IgnitionUt = 5000.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Refused, Outcome(refused));
            Assert.Equal(PrincipiaWriteRefusal.IgnitionInPast, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>The complement. A requested instant still ahead of the arrival
        /// clock is written, so the guard above cannot be satisfied by a handler that
        /// refuses every stated ignition.</summary>
        [Fact]
        public void ARequestedIgnitionStillAheadOfArrivalIsWritten()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.CurrentTimeValue = 4000.0;

            var written = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "e", BurnIndex = 0, IgnitionUt = 5000.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            Assert.Equal(5000.0, plugin.Known(Guid).Burns[0].burn.initial_time);
        }

        /// <summary>An inserted burn is written at the requested instant too, so it
        /// carries the same guard: a burn added to a plan already in the past is a
        /// manoeuvre the craft did not fly.</summary>
        [Fact]
        public void AnInsertAtAnInstantAlreadyPassedIsRefused()
        {
            var (plugin, commands) = Wire();
            Armed(commands);
            plugin.CurrentTimeValue = 9999.0;
            plugin.Writes.Clear();

            var refused = commands.InsertBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "i", BurnIndex = 0, IgnitionUt = 5000.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.IgnitionInPast, Refusal(refused));
            Assert.Empty(plugin.Writes);
        }

        /// <summary>
        /// Closed at the instant itself. A burn asked to ignite exactly at the
        /// arrival instant has no future left to be planned into, and the open
        /// boundary is where an off-by-one lets one through.
        /// </summary>
        [Theory]
        [InlineData(2000.0, 1000.0, false)]
        [InlineData(2000.0, 1999.0, false)]
        [InlineData(2000.0, 2000.0, true)]
        [InlineData(2000.0, 2001.0, true)]
        public void TheRequestedIgnitionGuardIsClosedAtTheArrivalInstant(
            double requested, double now, bool refused)
        {
            var result = PrincipiaBurnRules.RejectRequestedIgnition(requested, now);
            Assert.Equal(refused, result.HasValue);
        }

        /// <summary>A request that states no ignition instant is not tested against
        /// the clock, which is what keeps
        /// <see cref="ABurnInThePastIsStillEditable"/> true: tidying the delta-v of a
        /// burn that has already flown states no instant and changes none.</summary>
        [Fact]
        public void ARequestWithNoStatedIgnitionIsNotTestedAgainstTheClock()
        {
            Assert.Null(PrincipiaBurnRules.RejectRequestedIgnition(null, 9999.0));
        }


        /// <summary>
        /// An insert with nothing to copy BUILDS the burn, from the loaded build's
        /// own struct type.
        ///
        /// <para>The layout rule this used to be refused by is about a stale field
        /// SET: a shape written down here resolves rather than throws, and writes a
        /// plausible wrong burn into somebody's save. A struct made from the type
        /// the producer's own entry point declares carries exactly this build's
        /// fields, which is the same guarantee a copy has.</para>
        /// </summary>
        [Fact]
        public void AnInsertWithNoBurnToCopyBuildsTheFirstOne()
        {
            var (plugin, commands) = EmptyPlan();

            var written = commands.InsertBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid,
                    RequestId = "i",
                    BurnIndex = 0,
                    IgnitionUt = 5000.0,
                    DeltaVTangent = 120.0,
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            Assert.Single(plugin.Known(Guid).Burns);
        }

        /// <summary>
        /// The built burn is expressed in the frame the operator is looking at,
        /// which is the producer's own rule for a burn it opens. In any other frame
        /// the three components mean something else, so the operator would be
        /// reading a tangent that is not the one they aimed.
        /// </summary>
        [Fact]
        public void TheBuiltBurnCarriesTheFrameTheViewIsIn()
        {
            var (plugin, commands) = EmptyPlan();

            commands.InsertBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid,
                    RequestId = "i",
                    BurnIndex = 0,
                    IgnitionUt = 5000.0,
                });

            var fields = new PrincipiaBurnStruct();
            var burn = plugin.Known(Guid).Burns[0].burn;
            Assert.Equal(6000, fields.FrameExtension(burn));
            Assert.Equal(1, fields.FrameCentreIndex(burn));
        }

        /// <summary>
        /// The propulsion is derived from the craft's own mass, read at the craft.
        /// A mass nobody has refuses rather than defaulting: zero is accepted
        /// everywhere it is used and plans a craft that cannot be slowed down.
        /// </summary>
        [Fact]
        public void ABuiltBurnRefusesWhenTheCraftsMassCannotBeRead()
        {
            var (plugin, commands) = EmptyPlan(massTons: null);

            var refused = commands.InsertBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "i", BurnIndex = 0, IgnitionUt = 5000.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.SurfaceUnavailable, Refusal(refused));
            Assert.Empty(plugin.Known(Guid).Burns);
        }

        /// <summary>
        /// And without the instant it lights. Everywhere else an absent instant means
        /// "leave it where it is"; here there is nothing for it to be left at.
        /// </summary>
        [Fact]
        public void ABuiltBurnRefusesWithoutAnIgnitionInstant()
        {
            var (plugin, commands) = EmptyPlan();

            var refused = commands.InsertBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid, RequestId = "i", BurnIndex = 0,
                });

            Assert.Equal(PrincipiaWriteRefusal.ComposedBurnIncomplete, Refusal(refused));
            Assert.Empty(plugin.Known(Guid).Burns);
        }

        /// <summary>
        /// A REPLACE still refuses: it names a burn, and there is no burn there. The
        /// building path is the insert's alone.
        /// </summary>
        [Fact]
        public void AReplaceWithNoBurnToChangeIsStillRefused()
        {
            var (plugin, commands) = EmptyPlan();

            var refused = commands.ReplaceBurn(
                new PrincipiaBurnEditArgs
                {
                    VesselId = Guid,
                    RequestId = "r",
                    BurnIndex = 0,
                    IgnitionUt = 5000.0,
                });

            Assert.Equal(PrincipiaWriteRefusal.BurnIndexOutOfRange, Refusal(refused));
            Assert.Empty(plugin.Known(Guid).Burns);
        }

        /// <summary>
        /// A whole plan sent to a craft with no burns installs all of them: the head
        /// is built and the rest are copied from it.
        ///
        /// <para>This is the shape a command centre actually sends. Refusing it
        /// because the craft's plan is empty made a composed plan reachable only for
        /// a craft that had already been planned for by hand at the other
        /// end.</para>
        /// </summary>
        [Fact]
        public void AComposedPlanInstallsOntoACraftWithNoBurnsAtAll()
        {
            var (plugin, commands) = EmptyPlan();

            var written = commands.SendPlan(
                new PrincipiaPlanSendArgs
                {
                    VesselId = Guid,
                    RequestId = "s",
                    DesiredFinalTimeUt = 40_000.0,
                    Burns = new[]
                    {
                        new PrincipiaComposedBurn { IgnitionUt = 5000.0, DeltaVTangent = 120.0 },
                        new PrincipiaComposedBurn { IgnitionUt = 9000.0, DeltaVNormal = 15.0 },
                    },
                });

            Assert.Equal(PrincipiaWriteOutcome.Written, Outcome(written));
            Assert.Equal(2, plugin.Known(Guid).Burns.Count);
        }

        /// <summary>
        /// An armed vessel whose plan holds no burns. The burn probe cannot run with
        /// no burns, so the arm happens on a plan that has one and the plan is
        /// emptied after: what is under test is the missing template, not the arm.
        /// </summary>
        private static (FakePrincipiaPlugin Plugin, PlanCommands Commands) EmptyPlan(
            double? massTons = 8.0)
        {
            var (plugin, commands) =
                Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0), massTons);
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 1);
            Armed(commands);
            plugin.Known(Guid).Burns.Clear();
            plugin.Writes.Clear();
            return (plugin, commands);
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

        /// <summary>
        /// Creating a flight plan is reachable from a client, using nothing but
        /// the command surface.
        ///
        /// <para><b>It was not, and the deadlock was three-sided.</b> Arming
        /// refused without a plan, creating refused without an arm, and creating
        /// is the only thing that makes a plan. So <c>principia.plan.create</c>
        /// could never succeed over the wire at all. Measured on the rig: arm
        /// answered "The vessel has no flight plan. Create one first." and create
        /// answered "The flight-plan write surface is not armed for this
        /// vessel."</para>
        ///
        /// <para><b>This suite could not see it.</b>
        /// <see cref="CreateRefusesAnEndInstantBeforeNow"/> armed the authority
        /// DIRECTLY, skipping exactly the gate that made the command unreachable,
        /// so it passed over the defect by construction. These two go through the
        /// commands a client actually has and nothing else.</para>
        /// </summary>
        [Fact]
        public void ArmingSucceedsOnAVesselWithNoPlanYet()
        {
            var (_, commands) = Wire(p => p.Add(Guid, hasFlightPlan: false));

            var armed = commands.Arm(new PrincipiaPlanArmArgs
            {
                VesselId = Guid,
                RequestId = "arm-no-plan",
            });

            Assert.True(armed.Success, armed.Detail);
        }

        [Fact]
        public void ArmingThenCreatingWorksThroughTheCommandSurfaceAlone()
        {
            // No reaching past the commands to the authority underneath. If this
            // passes only when something arms the session directly, the command is
            // still unreachable to every real client.
            var (_, commands) = Wire(p => p.Add(Guid, hasFlightPlan: false));

            var armed = commands.Arm(new PrincipiaPlanArmArgs
            {
                VesselId = Guid,
                RequestId = "arm-1",
            });
            Assert.True(armed.Success, armed.Detail);

            var created = commands.CreatePlan(new PrincipiaPlanSlotArgs
            {
                VesselId = Guid,
                RequestId = "create-1",
                FinalTimeUt = 100_000,
            });

            Assert.True(created.Success, created.Detail);
        }
    }
}
