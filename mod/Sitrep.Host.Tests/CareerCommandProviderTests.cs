using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="CareerCommandProvider"/>'s <c>Handle*</c> glue
    /// against a <see cref="FakeCareerActuator"/> — proves typed args reach the
    /// correct actuator method with the correct values (never scrambled), that
    /// an empty/whitespace id is rejected as <see cref="CommandErrorCode.NotFound"/>
    /// before the actuator is ever called, and that the actuator's own typed
    /// failure (a contract in the wrong state, an unaffordable spend) is passed
    /// straight through. The engine-level <c>delayed</c> disposition is proven
    /// separately; this project doesn't reference <see cref="ChannelEngine"/>.
    /// </summary>
    public class CareerCommandProviderTests
    {
        [Fact]
        public void HandleActivateStrategyThreadsBothStrategyIdAndFactorUnscrambled()
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleActivateStrategy(
                actuator,
                new ActivateStrategyArgs { StrategyId = "OutsourceRnDStrategy", Factor = 0.75 });

            Assert.Equal("OutsourceRnDStrategy", actuator.LastActivateStrategyId);
            Assert.Equal(0.75, actuator.LastActivateStrategyFactor);
            Assert.True(result.Success);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        public void HandleActivateStrategyRejectsEmptyIdBeforeEverCallingTheActuator(string id)
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleActivateStrategy(actuator, new ActivateStrategyArgs { StrategyId = id });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastActivateStrategyId);
            Assert.Null(actuator.LastActivateStrategyFactor);
        }

        [Fact]
        public void HandleActivateStrategySurfacesTheActuatorsModeUnavailableError()
        {
            var actuator = new FakeCareerActuator { ActivateStrategyResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = CareerCommandProvider.HandleActivateStrategy(actuator, new ActivateStrategyArgs { StrategyId = "MassiveStrategy" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Fact]
        public void HandleDeactivateStrategyPassesStrategyIdThrough()
        {
            var actuator = new FakeCareerActuator();

            CareerCommandProvider.HandleDeactivateStrategy(actuator, new DeactivateStrategyArgs { StrategyId = "OutsourceRnDStrategy" });

            Assert.Equal("OutsourceRnDStrategy", actuator.LastDeactivateStrategyId);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        public void HandleDeactivateStrategyRejectsEmptyIdBeforeEverCallingTheActuator(string id)
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleDeactivateStrategy(actuator, new DeactivateStrategyArgs { StrategyId = id });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastDeactivateStrategyId);
        }

        [Fact]
        public void HandleUnlockTechPassesTechIdThrough()
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleUnlockTech(actuator, new UnlockTechArgs { TechId = "advRocketry" });

            Assert.Equal("advRocketry", actuator.LastUnlockTechId);
            Assert.True(result.Success);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        public void HandleUnlockTechRejectsEmptyIdBeforeEverCallingTheActuator(string id)
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleUnlockTech(actuator, new UnlockTechArgs { TechId = id });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastUnlockTechId);
        }

        [Fact]
        public void HandleUnlockTechSurfacesTheActuatorsUnaffordableRangeError()
        {
            var actuator = new FakeCareerActuator { UnlockTechResult = CommandResult.Fail(CommandErrorCode.Range) };

            var result = CareerCommandProvider.HandleUnlockTech(actuator, new UnlockTechArgs { TechId = "nuclearPropulsion" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
        }

        [Fact]
        public void HandleAcceptContractPassesContractIdThrough()
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleAcceptContract(actuator, new ContractActionArgs { ContractId = "42" });

            Assert.Equal("42", actuator.LastAcceptContractId);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleDeclineContractPassesContractIdThrough()
        {
            var actuator = new FakeCareerActuator();

            CareerCommandProvider.HandleDeclineContract(actuator, new ContractActionArgs { ContractId = "43" });

            Assert.Equal("43", actuator.LastDeclineContractId);
        }

        [Fact]
        public void HandleCancelContractPassesContractIdThrough()
        {
            var actuator = new FakeCareerActuator();

            CareerCommandProvider.HandleCancelContract(actuator, new ContractActionArgs { ContractId = "44" });

            Assert.Equal("44", actuator.LastCancelContractId);
        }

        [Fact]
        public void ContractHandlersRouteToDistinctActuatorMethods()
        {
            var actuator = new FakeCareerActuator();

            CareerCommandProvider.HandleAcceptContract(actuator, new ContractActionArgs { ContractId = "1" });
            CareerCommandProvider.HandleDeclineContract(actuator, new ContractActionArgs { ContractId = "2" });
            CareerCommandProvider.HandleCancelContract(actuator, new ContractActionArgs { ContractId = "3" });

            Assert.Equal("1", actuator.LastAcceptContractId);
            Assert.Equal("2", actuator.LastDeclineContractId);
            Assert.Equal("3", actuator.LastCancelContractId);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        public void HandleAcceptContractRejectsEmptyIdBeforeEverCallingTheActuator(string id)
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleAcceptContract(actuator, new ContractActionArgs { ContractId = id });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastAcceptContractId);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        public void HandleDeclineContractRejectsEmptyIdBeforeEverCallingTheActuator(string id)
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleDeclineContract(actuator, new ContractActionArgs { ContractId = id });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastDeclineContractId);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        public void HandleCancelContractRejectsEmptyIdBeforeEverCallingTheActuator(string id)
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleCancelContract(actuator, new ContractActionArgs { ContractId = id });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastCancelContractId);
        }

        [Fact]
        public void HandleCancelContractSurfacesTheActuatorsModeUnavailableErrorForAWrongStateContract()
        {
            var actuator = new FakeCareerActuator { CancelContractResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = CareerCommandProvider.HandleCancelContract(actuator, new ContractActionArgs { ContractId = "99" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Fact]
        public void HandleUpgradeFacilityPassesFacilityIdThrough()
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleUpgradeFacility(actuator, new UpgradeFacilityArgs { FacilityId = "VehicleAssemblyBuilding" });

            Assert.Equal("VehicleAssemblyBuilding", actuator.LastUpgradeFacilityId);
            Assert.True(result.Success);
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        public void HandleUpgradeFacilityRejectsEmptyIdBeforeEverCallingTheActuator(string id)
        {
            var actuator = new FakeCareerActuator();

            var result = CareerCommandProvider.HandleUpgradeFacility(actuator, new UpgradeFacilityArgs { FacilityId = id });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastUpgradeFacilityId);
        }

        [Fact]
        public void HandleUpgradeFacilitySurfacesTheActuatorsUnaffordableRangeError()
        {
            var actuator = new FakeCareerActuator { UpgradeFacilityResult = CommandResult.Fail(CommandErrorCode.Range) };

            var result = CareerCommandProvider.HandleUpgradeFacility(actuator, new UpgradeFacilityArgs { FacilityId = "LaunchPad" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
        }
    }
}
