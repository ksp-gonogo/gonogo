using System.Collections.Generic;
using Gonogo.KSP.SilenceTracking;
using Xunit;

namespace Gonogo.KSP.Tests.SilenceTracking
{
    /// <summary>
    /// The body table is read once per game instant: a sweep at one instant shares
    /// one read, and a later instant sees the elements the bodies carry then.
    /// </summary>
    public class InstantSnapshotTests
    {
        private sealed class Reader
        {
            public int Reads;
            public List<string> Next = new List<string> { "elements" };

            public List<string> Read()
            {
                Reads++;
                return new List<string>(Next);
            }
        }

        [Fact]
        public void CallsAtOneInstantShareOneRead()
        {
            var reader = new Reader();
            var snapshot = new InstantSnapshot<List<string>>(reader.Read, list => list.Count > 0);

            var first = snapshot.At(100.0);
            var second = snapshot.At(100.0);

            Assert.Same(first, second);
            Assert.Equal(1, reader.Reads);
        }

        [Fact]
        public void ALaterInstantReadsWhatTheBodiesCarryThen()
        {
            var reader = new Reader();
            var snapshot = new InstantSnapshot<List<string>>(reader.Read, list => list.Count > 0);

            snapshot.At(100.0);
            reader.Next = new List<string> { "osculating" };
            var later = snapshot.At(101.0);

            Assert.Equal(new[] { "osculating" }, later);
            Assert.Equal(2, reader.Reads);
        }

        [Fact]
        public void AnEmptyReadIsNotKept()
        {
            var reader = new Reader { Next = new List<string>() };
            var snapshot = new InstantSnapshot<List<string>>(reader.Read, list => list.Count > 0);

            snapshot.At(100.0);
            reader.Next = new List<string> { "elements" };

            Assert.Equal(new[] { "elements" }, snapshot.At(100.0));
            Assert.Equal(2, reader.Reads);
        }

        [Fact]
        public void WithNoClockEveryCallReads()
        {
            var reader = new Reader();
            var snapshot = new InstantSnapshot<List<string>>(reader.Read, list => list.Count > 0);

            snapshot.At(null);
            snapshot.At(null);

            Assert.Equal(2, reader.Reads);
        }
    }
}
