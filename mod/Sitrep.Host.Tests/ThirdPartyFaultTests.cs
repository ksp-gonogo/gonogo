using System;
using Gonogo.KSP;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ThirdPartyFaultTests
    {
        [Fact]
        public void DescribeNamesWhatThrewAndItsMessage()
        {
            var text = ThirdPartyFault.Describe("that part's action", new InvalidOperationException("no fuel"));

            Assert.Equal("that part's action threw: no fuel", text);
        }

        [Fact]
        public void DescribeSurvivesAnExceptionWhoseMessageGetterThrows()
        {
            var text = ThirdPartyFault.Describe("staging", new HostileException());

            Assert.Equal("staging threw: HostileException", text);
        }

        private sealed class HostileException : Exception
        {
            public override string Message => throw new InvalidOperationException("getter");
        }
    }
}
