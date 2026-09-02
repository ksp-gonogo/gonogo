using System;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The two stock career purchases RP-1 re-models as queued projects.
    ///
    /// <para>The case that matters is the registration one. Both commands ship as
    /// live buttons gated on career mode and the STOCK facility caps, and RP-1
    /// guards its own equivalents at its UI layer only: its Harmony patch on
    /// KSCFacilityContextMenu, with nothing at all on
    /// <c>UpgradeableFacility.SetLevel</c>. So a press upgraded the facility
    /// instantly at the stock price, beside a construction queue that never heard
    /// of it, into a state RP-1's own model cannot produce. Nothing warned,
    /// because nothing was asked.</para>
    ///
    /// <para>What this cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: it proves the walk reads the members it claims to, and
    /// nothing whatever about the values a running RP-1 would hold.</para>
    /// </summary>
    [Collection("rp0-static-graph")]
    public class Rp1CareerProjectGateTests : IDisposable
    {
        /// <summary>
        /// Spelled out rather than referenced, for the reason the Uplink spells
        /// out <c>ksp.launch</c>: these belong to core, which an Uplink may not
        /// reference, and a third-party author naming somebody else's command is
        /// in exactly this position.
        /// </summary>
        private const string UpgradeFacilityCommand = "career.facility.upgrade";

        private const string UnlockTechCommand = "career.tech.unlock";

        private readonly Rp1CareerProjectGate _gate = new Rp1CareerProjectGate();

        public Rp1CareerProjectGateTests()
        {
            SpaceCenterManagement.Instance = null;
            Confidence.Instance = null;
        }

        public void Dispose()
        {
            SpaceCenterManagement.Instance = null;
            Confidence.Instance = null;
        }

        private GateVerdict Ask(string quantity) =>
            _gate.Evaluate(
                new CommandRequirement { Kind = Rp1CareerProjectGate.GateKind, Quantity = quantity },
                new NoArguments());

        /// <summary>
        /// The empty bag the engine evaluates a static requirement with, and the
        /// only bag these two ever see: neither reads an argument.
        /// </summary>
        private sealed class NoArguments : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }

        // ── The bug, reproduced ────────────────────────────────────────────────

        /// <summary>
        /// Both commands come back from registration carrying an RP-1 condition.
        /// Without this the Uplink registers a launch gate and a build gate and
        /// contributes nothing to either of these, which is what left the stock
        /// write reachable on a live RP-1 career.
        /// </summary>
        [Fact]
        public void Both_stock_career_purchases_carry_an_RP1_condition()
        {
            var host = Registered();

            Assert.NotEmpty(host.RequirementsFor(UpgradeFacilityCommand));
            Assert.NotEmpty(host.RequirementsFor(UnlockTechCommand));
        }

        /// <summary>
        /// A contributed requirement nobody can evaluate is a startup failure, so
        /// the kind the two name has to be one this Uplink also registered.
        /// </summary>
        [Fact]
        public void The_kind_they_name_has_an_evaluator_behind_it()
        {
            var host = Registered();

            var kinds = host.RequirementsFor(UpgradeFacilityCommand)
                .Concat(host.RequirementsFor(UnlockTechCommand))
                .Select(r => r.Kind)
                .Distinct()
                .ToList();

            Assert.Equal(new[] { Rp1CareerProjectGate.GateKind }, kinds);
            Assert.Contains(host.GateEvaluators, e => e.Kind == Rp1CareerProjectGate.GateKind);
        }

        /// <summary>
        /// Neither reads an argument, which is what lets the engine answer them
        /// with an empty bag and draw both controls dark ahead of the press. A
        /// requirement that named one would abstain for the addressability sample
        /// and leave the button live until somebody pressed it.
        /// </summary>
        [Fact]
        public void Neither_condition_waits_on_an_argument()
        {
            var host = Registered();

            Assert.Empty(Assert.Single(host.RequirementsFor(UpgradeFacilityCommand)).Needs);
            Assert.Empty(Assert.Single(host.RequirementsFor(UnlockTechCommand)).Needs);
        }

        // ── What the operator reads ────────────────────────────────────────────

        /// <summary>
        /// Under a managed career the upgrade is refused, and the refusal says
        /// what RP-1 makes of the act and which command starts the same job. A
        /// bare refusal would be a worse bug than the write it prevents, and a
        /// refusal naming a BUILDING rather than the command is the drift this
        /// pins: it sent an operator into the game for something on their own
        /// board for as long as rp1.facility.upgrade went unnamed.
        /// </summary>
        [Fact]
        public void A_facility_upgrade_is_refused_with_the_reason_in_words()
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement { enabledForSave = true };

            var verdict = Ask(Rp1CareerProjectGate.FacilityUpgrade);

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.ModeUnavailable, verdict.ErrorCode);
            Assert.Equal(
                "RP-1 builds a facility upgrade as a construction project with its own cost and duration, "
                + "so it has to be queued rather than bought outright. Use rp1.facility.upgrade",
                verdict.Detail);
        }

        /// <summary>The research half, and a different sentence: the two are different commands.</summary>
        [Fact]
        public void A_tech_unlock_is_refused_with_the_reason_in_words()
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement { enabledForSave = true };

            var verdict = Ask(Rp1CareerProjectGate.TechUnlock);

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.ModeUnavailable, verdict.ErrorCode);
            Assert.Equal(
                "RP-1 researches a tech node as a queued project with its own duration, "
                + "so it has to be queued rather than bought outright. Use rp1.tech.research",
                verdict.Detail);
        }

        // ── The arms that must NOT refuse, and the ones that must ──────────────

        /// <summary>
        /// RP-1 installed beside a save it declines to run has no queue to defer
        /// to, so the stock purchase is the whole of what happens and both
        /// controls stay live.
        /// </summary>
        [Fact]
        public void A_save_RP1_does_not_manage_keeps_the_stock_purchase()
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement { enabledForSave = false };

            Assert.All(
                Rp1CareerProjectGate.Requirements(),
                r => Assert.Equal(GateOutcome.Pass, Ask(r.Quantity).Outcome));
        }

        /// <summary>
        /// The scenario module absent means whether RP-1 manages this save cannot
        /// be read, and Unknown refuses. The direction is the whole point: the
        /// write this guards raises a facility a tier and cannot be taken back, so
        /// a question that could not be answered leaves it blocked.
        /// </summary>
        [Fact]
        public void An_unreadable_space_centre_leaves_the_write_blocked()
        {
            Assert.All(
                Rp1CareerProjectGate.Requirements(),
                r =>
                {
                    var verdict = Ask(r.Quantity);
                    Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
                    Assert.Equal("RP-1's space centre is not loaded", verdict.Detail);
                });
        }

        /// <summary>
        /// A quantity this kind does not answer is Unknown rather than Pass. An
        /// unanswerable question is not a satisfied one, and the alternative is a
        /// typo in a requirement reading as a condition that holds.
        /// </summary>
        [Fact]
        public void A_quantity_this_kind_does_not_answer_is_not_a_pass()
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement { enabledForSave = true };

            var verdict = Ask("crewHire");

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
            Assert.Contains("crewHire", verdict.Detail);
        }

        /// <summary>The Uplink registered into a probe host, so the contributions can be read back.</summary>
        private static StarvationProbeHost Registered()
        {
            var host = new StarvationProbeHost(new Kernel());
            new Rp1ScUplink().Register(host);
            return host;
        }
    }
}
