using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.ActiveVessel
{
    /// <summary>
    /// The commands that cannot act on the craft gonogo is reporting while a
    /// kerbal is outside it, and therefore have to refuse.
    ///
    /// <para>The active-vessel seam moved every READ onto the craft a kerbal
    /// stepped out of. It could not move the WRITES, because the stock calls
    /// underneath them take no vessel: <c>FlightInputHandler</c> applies its
    /// control state only to <c>vessel == FlightGlobals.ActiveVessel</c>,
    /// <c>StageManager.ActivateStage</c> reads the same property, and
    /// <c>FlightGlobals.SetVesselTarget</c> ends in
    /// <c>ActiveVessel.targetObject = tgt</c>. Every one of those is the KERBAL
    /// during an EVA, so each command reported success and moved nothing.</para>
    ///
    /// <para>Asserted structurally, over the shipped source, for the reason
    /// <c>ManeuverWriteAuthorityTests</c> and
    /// <c>CurrencyDelaySettlePumpIsWiredTests</c> already give: these command
    /// bodies reach Unity assemblies the reference set does not ship, so a
    /// headless test cannot enter them at all. The DECISION each one delegates
    /// to is <see cref="Gonogo.KSP.EvaCommandRule"/>, which names no KSP type
    /// and is entered directly below.</para>
    /// </summary>
    public class EvaCommandRefusalTests
    {
        /// <summary>
        /// Nothing is refused when the reported craft IS the one KSP is flying,
        /// which is every moment but an EVA. A rule that refused here would take
        /// out five commands for the whole of a normal flight.
        /// </summary>
        [Fact]
        public void NothingRefusesWhenTheReportedCraftIsTheOneKspIsFlying()
        {
            Assert.Null(EvaCommandRule.RefusalFor(false, EvaCommandRule.Throttle));
        }

        /// <summary>
        /// <c>WrongState</c>, not <c>NotClearToProceed</c>. The distinction the
        /// contract draws is whether waiting resolves it: this resolves when the
        /// kerbal boards, which is an act. And <c>NotClearToProceed</c>'s
        /// documented authority is <c>FlightGlobals.ClearToSave()</c>, which
        /// reads KSP's own active vessel and so judges the KERBAL - the one
        /// check that structurally cannot see this state.
        /// </summary>
        [Theory]
        [InlineData(nameof(EvaCommandRule.Throttle))]
        [InlineData(nameof(EvaCommandRule.Stage))]
        [InlineData(nameof(EvaCommandRule.Target))]
        [InlineData(nameof(EvaCommandRule.Recover))]
        [InlineData(nameof(EvaCommandRule.Maneuver))]
        public void EveryRefusalIsWrongStateAndCarriesItsOwnReason(string which)
        {
            var detail = (string)typeof(EvaCommandRule).GetField(which)!.GetValue(null)!;

            var refusal = EvaCommandRule.RefusalFor(true, detail);

            Assert.Equal(CommandErrorCode.WrongState, refusal!.Value.Code);
            Assert.Equal(detail, refusal.Value.Detail);
            // An empty detail is legal on a Refusal and would be useless here:
            // five commands sharing one code need the sentence to tell them
            // apart, and each one names a different stock mechanism.
            Assert.NotEqual("", refusal.Value.Detail);
        }

        /// <summary>
        /// File, then the declaration whose body has to consult the rule. One
        /// case per command rather than a single sweep: fixing four of five
        /// leaves the fifth reporting a success it did not perform, and a sweep
        /// that passed on four would not say which.
        /// </summary>
        public static TheoryData<string, string> RefusingCommands => new TheoryData<string, string>
        {
            { "KspVesselActuator.cs", "public CommandResult SetThrottle(" },
            { "KspVesselActuator.cs", "public CommandResult<int> Stage(" },
            { "KspVesselActuator.cs", "public CommandResult SetTarget(" },
            { "KspVesselActuator.cs", "public CommandResult ClearTarget(" },
            { "KspFlightOpsActuator.cs", "public CommandResult Recover(" },
        };

        [Theory]
        [MemberData(nameof(RefusingCommands))]
        public void EveryCommandThatCannotReachTheCraftAsksTheEvaRule(string file, string declaration)
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative(file), declaration);

            Assert.Contains("EvaCommandRule.RefusalFor(", body);
        }

        /// <summary>
        /// The stage command's own reason for going first. It calls
        /// <c>ActionGroups.ToggleGroup(Stage)</c> on the reported craft whether
        /// or not the stack advances, which is what stock's own key does; during
        /// an EVA the stack cannot advance at all, so the toggle is the only
        /// thing that happens, and it fires whatever the player bound to Stage.
        /// A refusal placed after it would still leave the side effect.
        /// </summary>
        [Fact]
        public void TheStageRefusalComesBeforeTheActionGroupItWouldOtherwiseFire()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspVesselActuator.cs"),
                "public CommandResult<int> Stage(");

            var refusal = body.IndexOf("EvaCommandRule.RefusalFor(", StringComparison.Ordinal);
            var toggle = body.IndexOf("ToggleGroup(", StringComparison.Ordinal);

            Assert.True(refusal >= 0, "Stage does not consult the EVA rule at all");
            Assert.True(toggle >= 0, "Stage no longer fires the Stage action group");
            Assert.True(refusal < toggle, "Stage fires the action group before it refuses");
        }

        /// <summary>
        /// The plan READ is not a refusal and cannot be one: an
        /// <c>IManeuverPlanSource</c> answers with a list or with null, and null
        /// is the contract's "this craft cannot hold a plan at all". A craft a
        /// kerbal has stepped out of holds whatever it held; KSP has only taken
        /// the live solver away (<c>Vessel.MakeInactive</c> ->
        /// <c>DetachPatchedConicsSolver</c>, which SAVES the plan into
        /// <c>flightPlanNode</c> on its way out). So the backend has to read the
        /// saved plan rather than report the craft plannerless.
        /// </summary>
        [Fact]
        public void ThePlanBackendReadsTheSavedPlanRatherThanReportingNoPlanner()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("StockManeuverPlanBackend.cs"),
                "public IList<Sitrep.Contract.ManeuverNode>? Plan(");

            Assert.Contains("flightPlanNode", body);
        }

        /// <summary>
        /// A scan that cannot see a violation reports zero, and zero reads as
        /// success. The instrument is the brace matcher plus a substring, so the
        /// thing to prove is that a body WITHOUT the call comes back without it:
        /// <c>SetSas</c> is a command that legitimately does not refuse (the
        /// action group is written straight onto the reported craft), so it is a
        /// standing negative control rather than a planted string.
        /// </summary>
        [Fact]
        public void TheScanCanSeeACommandThatDoesNotConsultTheRule()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspVesselActuator.cs"),
                "public CommandResult SetSas(");

            Assert.DoesNotContain("EvaCommandRule.RefusalFor(", body);
        }

        /// <summary>
        /// And that the matcher is reading a BODY rather than the rest of the
        /// file: a declaration that does not exist has to fail as a broken
        /// instrument, not as a finding about the code.
        /// </summary>
        [Fact]
        public void TheScanFailsLoudlyOnADeclarationThatMoved()
        {
            Assert.Throws<InvalidOperationException>(() =>
                CurrencyDelaySourceText.MethodBody(
                    CurrencyDelaySourceText.ReadRelative("KspVesselActuator.cs"),
                    "public CommandResult NoSuchCommand("));
        }
    }
}
