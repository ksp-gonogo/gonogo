using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Science
{
    /// <summary>Which converter on a part a switch request means.</summary>
    public class ConverterPickTests
    {
        [Fact]
        public void ANameIsMatchedAmongSeveralConvertersOnOnePart()
        {
            var index = ConverterPick.Of(new[] { "Ore to Fuel", "Ore to Oxidizer" }, "Ore to Oxidizer", out var refusal);

            Assert.Equal(1, index);
            Assert.Null(refusal);
        }

        [Fact]
        public void NoNameMeansTheOnlyConverter()
        {
            Assert.Equal(0, ConverterPick.Of(new[] { "Fuel Cell" }, null, out _));
            Assert.Equal(0, ConverterPick.Of(new[] { "Fuel Cell" }, "", out _));
        }

        [Fact]
        public void NoNameOnAPartWithSeveralIsRefusedRatherThanGuessed()
        {
            var index = ConverterPick.Of(new[] { "A", "B" }, null, out var refusal);

            Assert.Equal(-1, index);
            Assert.Equal(CommandErrorCode.NotFound, refusal!.Value.Code);
        }

        [Fact]
        public void AnUnknownNameIsNotFound()
        {
            var index = ConverterPick.Of(new[] { "A" }, "Z", out var refusal);

            Assert.Equal(-1, index);
            Assert.Equal(CommandErrorCode.NotFound, refusal!.Value.Code);
        }

        [Fact]
        public void APartWithNoConverterIsNotFound()
        {
            Assert.Equal(-1, ConverterPick.Of(new string[0], "A", out var refusal));
            Assert.Equal(CommandErrorCode.NotFound, refusal!.Value.Code);
        }
    }
}
