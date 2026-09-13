using Xunit;
using Sitrep.Core;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <see cref="Courier.ReadRawAtVantage"/>: the payload one vantage has been
    /// told about a topic, with the delay applied from the Courier's own ledger.
    ///
    /// <para>The archive's read behaviour is pinned by its own suite and by the
    /// golden fixtures. What can only be asserted HERE is that the delay comes
    /// from the network rather than from the caller, which is the whole reason
    /// this method is on the Courier: a caller that looked the archive up itself
    /// would be picking its own light time.</para>
    /// </summary>
    public class CourierReadRawAtVantageTests
    {
        [Fact]
        public void AnswersWithWhatTheVantageHasBeenTold()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("ksc", "system", 5);
            var courier = new Courier(clock, network);

            courier.Record("system", "bodies", "old", 0);
            courier.Record("system", "bodies", "new", 10);

            // now = 12, delay 5, so the scene is 7: the sample recorded at 10
            // has not arrived yet and the one at 0 is still current there.
            Assert.Equal("old", courier.ReadRawAtVantage("system", "bodies", "ksc", 12));

            // now = 16, scene 11, and the newer one has landed.
            Assert.Equal("new", courier.ReadRawAtVantage("system", "bodies", "ksc", 16));
        }

        /// <summary>
        /// Two vantages at different distances disagree about what is current,
        /// which is the entire point of asking per vantage rather than per
        /// topic.
        /// </summary>
        [Fact]
        public void TwoVantagesAtDifferentDistancesGetDifferentAnswers()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            network.SetDelay("near", "system", 1);
            network.SetDelay("far", "system", 8);
            var courier = new Courier(clock, network);

            courier.Record("system", "bodies", "old", 0);
            courier.Record("system", "bodies", "new", 10);

            Assert.Equal("new", courier.ReadRawAtVantage("system", "bodies", "near", 12));
            Assert.Equal("old", courier.ReadRawAtVantage("system", "bodies", "far", 12));
        }

        /// <summary>
        /// A node nothing has ever been recorded for answers null rather than
        /// minting an empty archive: asking a question must not create the state
        /// that answers it.
        /// </summary>
        [Fact]
        public void AnUnknownNodeAnswersNull()
        {
            var courier = new Courier(new ManualClock(), new StubNetwork());

            Assert.Null(courier.ReadRawAtVantage("nobody", "bodies", "ksc", 12));
        }
    }
}
