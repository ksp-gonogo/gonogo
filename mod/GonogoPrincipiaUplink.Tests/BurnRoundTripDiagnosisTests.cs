// What the round-trip refusal SAYS, and what the arm reports having checked.
//
// Both of these are about a message rather than a mechanism, and both exist
// because a message that overstated what its own check could know sent a reader
// somewhere false.
//
//   The refusal named a cause. "That is the struct-layout failure this check
//   exists for" was asserted by a comparison of nine values that reported none of
//   them, so a value Principia normalises on the way in was indistinguishable from
//   byte-level corruption and read as the latter. It was then repeated onward as a
//   measurement.
//
//   The arm named a state. `armed: true` was answered by a surface that had
//   round-tripped no burn at all, because a plan with no burns has none to
//   round-trip and the arm's gate passes on the integrator's verdict alone. A gate
//   may legitimately pass on partial verification. It may not report that as full
//   verification.
//
// Neither change relaxes anything. The same nine values are compared, any
// difference still refuses, and the write is still reverted.
using System.Collections.Generic;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class BurnRoundTripDiagnosisTests
    {
        private const string Guid = "vessel-1";

        // ── The refusal names the field ─────────────────────────────────────

        private static FakeBurn Burn(double thrust = 60.0) => new FakeBurn
        {
            thrust_in_kilonewtons = thrust,
            specific_impulse_in_seconds_g0 = 320.0,
            initial_time = 1000.0,
            is_inertially_fixed = false,
        };

        [Fact]
        public void An_unchanged_burn_has_no_difference_to_describe()
        {
            Assert.Null(PrincipiaLayoutProbe.DescribeBurnDifference(Burn(), Burn()));
            Assert.True(PrincipiaLayoutProbe.SameBurn(Burn(), Burn()));
        }

        /// <summary>
        /// The whole point: WHICH field, and both values. A refusal that says only
        /// "what came back is not what went in" cannot be acted on and cannot tell a
        /// layout fault from a normalisation.
        /// </summary>
        [Fact]
        public void A_changed_field_is_named_with_the_value_that_went_in_and_the_one_that_came_back()
        {
            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(Burn(60.0), Burn(120.0));

            Assert.NotNull(difference);
            Assert.Contains("thrust_in_kilonewtons", difference!);
            Assert.Contains("60", difference);
            Assert.Contains("120", difference);
            Assert.False(PrincipiaLayoutProbe.SameBurn(Burn(60.0), Burn(120.0)));
        }

        /// <summary>
        /// Every field that differs, not the first. A layout fault typically moves
        /// several at once, and a report naming one of them invites a reader to fix
        /// that one and re-run.
        /// </summary>
        [Fact]
        public void Every_differing_field_is_named_rather_than_the_first()
        {
            var went = Burn();
            var came = Burn();
            came.specific_impulse_in_seconds_g0 = 1.0;
            came.initial_time = 2000.0;

            var difference = PrincipiaLayoutProbe.DescribeBurnDifference(went, came);

            Assert.Contains("specific_impulse_in_seconds_g0", difference!);
            Assert.Contains("initial_time", difference);
        }

        /// <summary>
        /// The refusal no longer asserts a cause it cannot establish, and says so.
        /// Asserted on the string because the string is the whole deliverable here:
        /// the mechanism did not change.
        /// </summary>
        [Fact]
        public void The_refusal_hands_over_the_evidence_instead_of_naming_a_cause()
        {
            // The rig's own shape: an empty plan, so the insert BUILDS the first burn
            // and its own read-back is the only crossing that burn has ever made.
            // That is the path that refused live, and the one whose message was
            // unreadable.
            var (plugin, commands) = EmptyPlan();
            plugin.MisreadsThrustAfterAWrite = true;

            var edit = commands.InsertBurn(new PrincipiaBurnEditArgs
            {
                VesselId = Guid,
                RequestId = "i",
                BurnIndex = 0,
                IgnitionUt = 5000.0,
            });

            var detail = Receipt(edit)["refusalDetail"] as string;
            Assert.NotNull(detail);
            Assert.Contains("thrust_in_kilonewtons", detail!);
            // The sentence that used to state a cause the check could not know.
            Assert.DoesNotContain("That is the struct-layout failure", detail);
            // Still refused, still reverted: naming the field relaxed nothing.
            Assert.Empty(plugin.Known(Guid).Burns);
        }

        /// <summary>
        /// An empty plan that has nonetheless been armed, which is the rig's fixture:
        /// the surface arms on the integrator probe and the burn struct stands
        /// undemonstrated until an insert makes the first crossing.
        /// </summary>
        private static (FakePrincipiaPlugin Plugin, PlanCommands Commands) EmptyPlan()
        {
            var (plugin, commands) = Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0));
            Arm(commands);
            plugin.Writes.Clear();
            return (plugin, commands);
        }

        // ── The arm reports what it actually verified ───────────────────────

        /// <summary>
        /// The safety item. A plan with no burns has none to round-trip, so the burn
        /// struct stands undemonstrated while the integrator's is proven and the
        /// surface arms on that. That is allowed; reporting it as a plain "armed" is
        /// not, and this is the field that stops it.
        /// </summary>
        [Fact]
        public void An_arm_that_round_tripped_no_burn_says_so_on_the_write_surface()
        {
            var (_, commands) = Wire(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 0));

            var surface = WriteSurface(Arm(commands));

            Assert.Equal(true, surface["armed"]);
            Assert.Equal(false, surface["burnLayoutVerified"]);
            Assert.Equal(true, surface["integratorLayoutVerified"]);
        }

        /// <summary>
        /// And the complement, which is what makes the test above non-vacuous: a
        /// plan that DID round-trip a burn reports both verdicts proven. Without the
        /// pair, a surface that hard-coded false would pass.
        /// </summary>
        [Fact]
        public void An_arm_that_did_round_trip_a_burn_reports_both_verdicts_proven()
        {
            var (_, commands) = Wire();

            var surface = WriteSurface(Arm(commands));

            Assert.Equal(true, surface["armed"]);
            Assert.Equal(true, surface["burnLayoutVerified"]);
            Assert.Equal(true, surface["integratorLayoutVerified"]);
        }

        // ── The fixture, its own rather than a neighbour's ──────────────────

        private static (FakePrincipiaPlugin Plugin, PlanCommands Commands) Wire(
            System.Action<FakePrincipiaPlugin>? arrange = null)
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

        private static CommandResult<Dictionary<string, object?>> Arm(PlanCommands commands)
        {
            var armed = commands.Arm(
                new PrincipiaPlanArmArgs { VesselId = Guid, RequestId = "arm-1" });
            Assert.True(armed.Success);
            return armed;
        }

        private static Dictionary<string, object?> Receipt(
            CommandResult<Dictionary<string, object?>> result)
        {
            Assert.NotNull(result.Payload);
            return result.Payload!;
        }

        private static Dictionary<string, object?> WriteSurface(
            CommandResult<Dictionary<string, object?>> result)
        {
            var plan = Receipt(result)["plan"] as Dictionary<string, object?>;
            Assert.NotNull(plan);
            return (Dictionary<string, object?>)plan!["writeSurface"]!;
        }
    }
}
