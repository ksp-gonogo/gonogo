using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class PartIdRuleTests
    {
        [Fact]
        public void AnIdTwoPartsCarryIsRefusedWithAReasonThatSaysSo()
        {
            var refusal = PartIdRule.AmbiguousRefusal("4204781", matches: 2);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.WrongState, refusal!.ErrorCode);
            Assert.Contains("more than one part", refusal.Detail);
            Assert.Contains("4204781", refusal.Detail);
        }

        [Theory]
        [InlineData(0)]
        [InlineData(1)]
        public void AnIdNamingAtMostOnePartIsNotRefusedHere(int matches)
        {
            Assert.Null(PartIdRule.AmbiguousRefusal("4204781", matches));
        }
    }
}
