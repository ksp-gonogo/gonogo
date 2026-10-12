using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>A science credit the game raises with no subject publishes no subject, rather than an empty one.</summary>
    public class CurrencyEventBuilderTests
    {
        [Fact]
        public void ACreditWithNoSubjectPublishesNullForIt()
        {
            var payload = CurrencyEventBuilder.BuildScienceCredit("guid", "Probe", 4.0, null, null, 100.0);

            Assert.True(payload.ContainsKey("subjectId"));
            Assert.Null(payload["subjectId"]);
            Assert.Null(payload["subjectTitle"]);
        }
    }
}
