using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// A save load request is read the same way on every poll, and a request that was
    /// acted on never runs twice while a new one always does.
    /// </summary>
    public sealed class AutoLoadRequestTests
    {
        [Fact]
        public void TheFormatThePreviousVersionReadStillParses()
        {
            var request = AutoLoadRequest.Parse(
                new[] { "mod testing", "", "flight", "file=quicksave #3", "newsandbox" }, fileStamp: "t1");

            Assert.Equal("mod testing", request.SaveName);
            Assert.Equal("quicksave #3", request.SfsFile);
            Assert.True(request.RestoreFlight);
            Assert.True(request.NewSandbox);
        }

        [Fact]
        public void AnExplicitIdIsTheRequestId()
        {
            var request = AutoLoadRequest.Parse(new[] { "save", "id = run 7" }, fileStamp: "t1");

            Assert.Equal("run 7", request.Id);
        }

        [Fact]
        public void WithoutAnIdTheFileStampIdentifiesTheRequest()
        {
            var first = AutoLoadRequest.Parse(new[] { "save" }, fileStamp: "t1");
            var rewritten = AutoLoadRequest.Parse(new[] { "save" }, fileStamp: "t2");

            Assert.Equal("t1", first.Id);
            Assert.NotEqual(first.Id, rewritten.Id);
        }

        [Fact]
        public void TheDefaultFileIsPersistent()
        {
            Assert.Equal("persistent", AutoLoadRequest.Parse(new[] { "save" }, "t").SfsFile);
        }

        [Fact]
        public void ARequestIsActedOnOnceAndAnotherIdActsAgain()
        {
            var watch = new AutoLoadWatch();

            Assert.True(watch.TryClaim("a"));
            Assert.False(watch.TryClaim("a"));
            Assert.False(watch.TryClaim("a"));
            Assert.True(watch.TryClaim("b"));
            Assert.False(watch.TryClaim("b"));
        }

        [Fact]
        public void AnOldIdDoesNotRunAgainAfterANewerOne()
        {
            var watch = new AutoLoadWatch();
            watch.TryClaim("a");
            watch.TryClaim("b");

            Assert.False(watch.TryClaim("a"));
        }

        [Theory]
        [InlineData("persistent", true)]
        [InlineData("quicksave #3", true)]
        [InlineData("../persistent", false)]
        [InlineData("a/b", false)]
        [InlineData("c:x", false)]
        public void AFileNameMustStayInsideTheSaveFolder(string file, bool allowed)
        {
            Assert.Equal(allowed, AutoLoadRequest.IsSiblingFile(file));
        }
    }
}
