using Xunit;

namespace Sitrep.Host.Tests
{
    [Collection("PathRedactorRoots")]
    public class PathRedactorTests : System.IDisposable
    {
        public PathRedactorTests() => PathRedactor.ClearRoots();

        public void Dispose() => PathRedactor.ClearRoots();

        [Fact]
        public void TextWithNoPathIsUnchanged()
        {
            const string text = "vessel.flight read failed, 3 more since the last line (a/b and/or c)";

            Assert.Equal(text, PathRedactor.Redact(text));
        }

        [Fact]
        public void ARegisteredRootBecomesItsLabelEvenWithSpacesInIt()
        {
            PathRedactor.AddRoot(@"C:\Program Files (x86)\Steam\Kerbal Space Program", "<KSP>");

            var line = PathRedactor.Redact(@"C:\Program Files (x86)\Steam\Kerbal Space Program\GameData\Gonogo\gonogo.cfg is missing");

            Assert.Equal(@"<KSP>\GameData\Gonogo\gonogo.cfg is missing", line);
        }

        [Fact]
        public void ARootMatchesInTheOtherSeparatorStyleAndAnyCase()
        {
            PathRedactor.AddRoot("/home/player/KSP", "<KSP>");

            Assert.Equal("<KSP>/GameData/x.cfg", PathRedactor.Redact("/HOME/player/ksp/GameData/x.cfg"));
            Assert.Equal("<KSP>\\GameData\\x.cfg", PathRedactor.Redact("\\home\\player\\KSP\\GameData\\x.cfg"));
        }

        [Fact]
        public void AnUnregisteredWindowsPathKeepsOnlyItsLastSegment()
        {
            Assert.Equal(
                "could not load .../Thing.dll: bad image",
                PathRedactor.Redact(@"could not load C:\Users\someone\Mods\Thing.dll: bad image"));
        }

        [Fact]
        public void AnUnregisteredUnixPathKeepsOnlyItsLastSegment()
        {
            Assert.Equal(
                "could not load .../Thing.dll: bad image",
                PathRedactor.Redact("could not load /home/someone/Mods/Thing.dll: bad image"));
        }
    }
}
