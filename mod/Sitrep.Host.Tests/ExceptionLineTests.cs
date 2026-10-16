using System;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ExceptionLineTests
    {
        private static Exception Thrown(Func<Exception> make)
        {
            try
            {
                throw make();
            }
            catch (Exception ex)
            {
                return ex;
            }
        }

        [Fact]
        public void AnExceptionFitsOnOneLineWithItsTypeMessageAndFirstFrame()
        {
            var ex = Thrown(() => new InvalidOperationException("first\nsecond"));

            var line = ExceptionLine.Describe(ex);

            Assert.DoesNotContain('\n', line);
            Assert.StartsWith("InvalidOperationException: first second at ", line);
            Assert.Contains(nameof(ExceptionLineTests), line);
        }

        [Fact]
        public void TheFrameDropsTheSourceLocation()
        {
            var line = ExceptionLine.Describe(Thrown(() => new Exception("x")));

            Assert.DoesNotContain(" in ", line);
        }

        [Fact]
        public void AnInnerExceptionFollowsTheOuterOne()
        {
            var ex = Thrown(() => new Exception("outer", new ArgumentException("inner")));

            var line = ExceptionLine.Describe(ex);

            Assert.Contains("Exception: outer", line);
            Assert.Contains(" <- ArgumentException: inner", line);
        }

        [Fact]
        public void AnExceptionNeverThrownHasNoFrame()
        {
            Assert.Equal("Exception: bare", ExceptionLine.Describe(new Exception("bare")));
        }

        [Fact]
        public void AFilePathInTheMessageKeepsOnlyItsFileName()
        {
            var ex = new System.IO.FileNotFoundException("Could not find file '/home/someone/KSP/GameData/Gonogo/gonogo.cfg'");

            var line = ExceptionLine.Describe(ex);

            Assert.DoesNotContain("someone", line);
            Assert.Contains(".../gonogo.cfg", line);
        }

        [Fact]
        public void NullRendersAsEmpty()
        {
            Assert.Equal("", ExceptionLine.Describe(null));
        }
    }
}
