using System.Collections.Generic;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A craft's thrusters against the propellant it holds decide whether its
    /// delta-v is provably nothing, which is a fact, or merely unread, which is not.
    /// </summary>
    public class PartsPropulsionTests
    {
        private static readonly string[] Bipropellant = { "LiquidFuel", "Oxidizer" };

        private static IReadOnlyList<IReadOnlyList<string>?> Thrusters(params string[]?[] each) => each;

        private static Dictionary<string, double> Holding(params (string Name, double Amount)[] resources)
        {
            var held = new Dictionary<string, double>();
            foreach (var (name, amount) in resources)
            {
                held[name] = amount;
            }
            return held;
        }

        [Fact]
        public void ACraftWithNoEnginesCannotPush()
        {
            Assert.False(PartsPropulsion.CanPush(Thrusters(), Holding(("LiquidFuel", 90.0))));
        }

        [Fact]
        public void AnEngineWithItsPropellantSpentCannotPush()
        {
            Assert.False(PartsPropulsion.CanPush(Thrusters(Bipropellant), Holding(("LiquidFuel", 0.0), ("Oxidizer", 0.0))));
            Assert.False(PartsPropulsion.CanPush(Thrusters(Bipropellant), Holding()));
        }

        [Fact]
        public void ANeverLoadedCraftWithAnEngineAndFuelIsNotReadAsHavingNothing()
        {
            Assert.True(PartsPropulsion.CanPush(Thrusters(Bipropellant), Holding(("LiquidFuel", 360.0), ("Oxidizer", 440.0))));
        }

        [Fact]
        public void PropellantAThrusterDoesNotDrawDoesNotCount()
        {
            Assert.False(PartsPropulsion.CanPush(Thrusters(Bipropellant), Holding(("MonoPropellant", 30.0))));
            Assert.True(PartsPropulsion.CanPush(Thrusters(Bipropellant, new[] { "MonoPropellant" }), Holding(("MonoPropellant", 30.0))));
        }

        [Fact]
        public void AnAirBreathingEngineIsNeverOutOfAir()
        {
            Assert.True(PartsPropulsion.CanPush(Thrusters(new[] { "LiquidFuel", "IntakeAir" }), Holding()));
        }

        [Fact]
        public void AThrusterWhosePropellantsCouldNotBeReadLeavesItUnknownNotZero()
        {
            Assert.Null(PartsPropulsion.CanPush(Thrusters((string[]?)null), Holding()));
            Assert.Null(PartsPropulsion.CanPush(Thrusters(new string[0]), Holding(("LiquidFuel", 90.0))));
        }

        [Fact]
        public void AReadableThrusterWithPropellantAnswersBesideAnUnreadableOne()
        {
            Assert.True(PartsPropulsion.CanPush(Thrusters(null, Bipropellant), Holding(("Oxidizer", 5.0))));
        }
    }
}
