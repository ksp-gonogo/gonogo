using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class GateArgumentsTests
    {
        private sealed class Typed
        {
            public string Vessel { get; set; } = "typed";
        }

        [Fact]
        public void ABagKeyedByWireNameAnswersToTheNameADeclarationSpells()
        {
            var args = new GateArguments(new Dictionary<string, object> { ["vessel"] = "abc", ["allow"] = true });

            Assert.True(args.TryGet("Vessel", out var vessel));
            Assert.Equal("abc", vessel);
            Assert.True(args.TryGet("allow", out _));
        }

        [Theory]
        [InlineData("PartId", "partId")]
        [InlineData("Vessel", "vessel")]
        [InlineData("CoreId", "coreId")]
        public void EveryArgumentADeclaredSubjectNamesResolvesFromItsWireSpelling(string declared, string wire)
        {
            var args = new GateArguments(new Dictionary<string, object> { [wire] = "x" });

            Assert.True(args.TryGet(declared, out var value));
            Assert.Equal("x", value);
        }

        [Fact]
        public void ATypedObjectAnswersToEitherSpelling()
        {
            var args = new GateArguments(new Typed());

            Assert.True(args.TryGet("vessel", out var vessel));
            Assert.Equal("typed", vessel);
        }

        [Fact]
        public void AnArgumentTheBagLacksIsAbsent()
        {
            var args = new GateArguments(new Dictionary<string, object> { ["vessel"] = "abc" });

            Assert.False(args.TryGet("PartId", out _));
        }
    }
}
