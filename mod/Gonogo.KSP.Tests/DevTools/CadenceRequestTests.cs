using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>A cadence request is taken whole or refused whole, with the reason, so a typo never half-applies.</summary>
    public sealed class CadenceRequestTests
    {
        [Fact]
        public void RatesReportAndResetAreRead()
        {
            var request = CadenceRequest.TryParse(
                new[] { "vessel.flight 5", "vessel.landing\t10" }, report: "10", reset: "true", out var error);

            Assert.Null(error);
            Assert.NotNull(request);
            Assert.Equal(new[] { ("vessel.flight", 5.0), ("vessel.landing", 10.0) }, request!.Rates);
            Assert.Equal(10.0, request.ReportSeconds);
            Assert.True(request.Reset);
        }

        [Theory]
        [InlineData("vessel.flight")]
        [InlineData("vessel.flight five")]
        [InlineData("vessel.flight 5 6")]
        public void AMalformedRateRefusesTheWholeRequest(string rate)
        {
            Assert.Null(CadenceRequest.TryParse(new[] { "vessel.landing 5", rate }, null, null, out var error));
            Assert.Contains(rate, error);
        }

        [Fact]
        public void ANegativeOrUnreadableReportIntervalIsRefused()
        {
            Assert.Null(CadenceRequest.TryParse(new[] { "vessel.flight 5" }, "-1", null, out _));
            Assert.Null(CadenceRequest.TryParse(new[] { "vessel.flight 5" }, "soon", null, out _));
        }

        [Fact]
        public void ARequestThatAsksForNothingIsRefused()
        {
            Assert.Null(CadenceRequest.TryParse(new string[0], null, null, out var error));
            Assert.NotNull(error);
        }

        [Fact]
        public void AResetAloneIsARequest()
        {
            var request = CadenceRequest.TryParse(new string[0], null, "True", out _);

            Assert.NotNull(request);
            Assert.True(request!.Reset);
            Assert.Empty(request.Rates);
            Assert.Null(request.ReportSeconds);
        }
    }
}
