using GonogoRp1Uplink;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Every scalar on this Uplink's own wire types declares a unit. Nothing
    /// outside the type itself forces that once a payload lives in its own
    /// assembly, and a number with no declared unit reaches the client as a bare
    /// magnitude with no ladder and no screen-reader wording.
    ///
    /// <para>The second assertion is the one that can catch what the first
    /// cannot: an exhaustiveness sweep passes vacuously over an EMPTY set, which
    /// is exactly what a type quietly losing <c>[SitrepContract]</c> leaves
    /// behind.</para>
    /// </summary>
    public class Rp1UnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(Rp1CentreEntry).Assembly,
                "Units.BuildPoints");

        [Fact]
        public void TheContractTypesAreExactlyTheFortyWireShapes() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(Rp1CentreEntry).Assembly,
                nameof(Rp1CentreEntry),
                nameof(Rp1ComplexEntry),
                nameof(Rp1BuildItemEntry),
                nameof(Rp1WarehouseItemEntry),
                nameof(Rp1BuildableCraftEntry),
                nameof(Rp1BuildableComplex),
                nameof(Rp1PadEntry),
                nameof(Rp1OperationEntry),
                nameof(Rp1ConstructionEntry),
                nameof(Rp1ResearchEntry),
                nameof(Rp1Personnel),
                nameof(Rp1RushTerms),
                nameof(Rp1Confidence),
                nameof(Rp1ProgramEntry),
                nameof(Rp1ProgramSlots),
                nameof(Rp1ProgramSpeedOption),
                nameof(Rp1ProgramPaymentEntry),
                nameof(Rp1FundingCurveEntry),
                nameof(Rp1FundingCurveKey),
                nameof(Rp1CrewEntry),
                nameof(Rp1CrewProgram),
                nameof(Rp1LeaderEntry),
                nameof(Rp1HireTarget),
                nameof(Rp1FundTarget),
                nameof(Rp1TargetCancelArgs),
                nameof(Rp1TrainingCourseEntry),
                nameof(Rp1TrainingTemplateEntry),
                nameof(Rp1TrainingEnrolArgs),
                nameof(Rp1TrainingLeaveArgs),
                nameof(Rp1HireTargetSetArgs),
                nameof(Rp1FundTargetSetArgs),
                // The shapes here that are not Topic payloads: the command
                // args. They are held to the same rule because they cross the
                // same wire, and an id with no declared unit reads to a client as
                // a number nobody labelled.
                nameof(Rp1BuildRepeatArgs),
                nameof(Rp1RolloutArgs),
                nameof(Rp1VehicleArgs),
                nameof(Rp1ComplexRushArgs),
                nameof(Rp1PersonnelAssignArgs),
                nameof(Rp1BuildStartArgs),
                nameof(Rp1FacilityUpgradeArgs),
                nameof(Rp1TechResearchArgs),
                nameof(Rp1StrategyActivateArgs));
    }
}
