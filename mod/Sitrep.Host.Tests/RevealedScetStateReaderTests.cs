using System;
using System.Collections.Generic;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Reading a threshold against what ONE VANTAGE HAS BEEN TOLD.
    ///
    /// <para>The archive and the delay ledger are stubbed to a delegate, which
    /// is the whole seam: everything asserted here is about what the reader does
    /// with a payload once it has one, and that is exactly the half that decides
    /// whether a command-vantage alarm means anything.</para>
    /// </summary>
    public class RevealedScetStateReaderTests
    {
        private const string Vantage = "ksc";

        private static Dictionary<string, object?> Flight(string source, double altitude) =>
            new Dictionary<string, object?>
            {
                ["meta"] = new Dictionary<string, object?> { ["source"] = source },
                ["altitudeAsl"] = altitude,
            };

        private sealed class Archive
        {
            public object? Payload;
            public Exception? Throws;
            public readonly List<string> Asked = new List<string>();

            public object? Read(string topic, string vantage, double nowUt)
            {
                Asked.Add(topic + "@" + vantage + "@" + nowUt);
                if (Throws != null)
                {
                    throw Throws;
                }
                return Payload;
            }
        }

        [Fact]
        public void ReadsTheNumberOutOfWhatHasArrivedAtTheVantage()
        {
            var archive = new Archive { Payload = Flight("vessel:abc", 101_000) };
            var reader = new RevealedScetStateReader(archive.Read, Vantage, 1000);

            var reading = reader.Read("vessel:abc", "vessel.flight", "altitudeAsl");

            Assert.Equal(ScetReadingStatus.Observed, reading.Status);
            Assert.Equal(101_000, reading.Value);
            Assert.Equal(new[] { "vessel.flight@ksc@1000" }, archive.Asked);
        }

        /// <summary>
        /// A vantage that has heard nothing gets a refusal, never the game's own
        /// answer. The whole point of the reader is that "I have not been told"
        /// is a real state, and at half an hour of delay it is the difference
        /// between a craft that is fine and one that stopped existing four
        /// minutes ago.
        /// </summary>
        [Fact]
        public void NothingArrivedIsNotObservable()
        {
            var reader = new RevealedScetStateReader(new Archive().Read, Vantage, 1000);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read("vessel:abc", "vessel.flight", "altitudeAsl").Status);
        }

        /// <summary>
        /// A payload about somebody else's craft is not an answer to a question
        /// that names this one, exactly as the snapshot reader has it.
        /// </summary>
        [Fact]
        public void APayloadAboutAnotherCraftIsNotObservable()
        {
            var archive = new Archive { Payload = Flight("vessel:other", 101_000) };
            var reader = new RevealedScetStateReader(archive.Read, Vantage, 1000);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read("vessel:abc", "vessel.flight", "altitudeAsl").Status);
        }

        /// <summary>
        /// And it is never <c>SubjectGone</c>, whatever the archive says. That
        /// status is a permanent fact the simulation knows and a command centre
        /// does not, so answering it here would carry news of a loss to a place
        /// whose light has not brought it.
        /// </summary>
        [Fact]
        public void ItCanNeverSayTheSubjectIsGone()
        {
            var archive = new Archive { Payload = Flight("vessel:other", 1) };
            var reader = new RevealedScetStateReader(archive.Read, Vantage, 1000);

            foreach (var subject in new[] { "vessel:abc", "game", "" })
            {
                Assert.NotEqual(
                    ScetReadingStatus.SubjectGone,
                    reader.Read(subject, "vessel.flight", "altitudeAsl").Status);
            }
        }

        /// <summary>
        /// One archive read per Topic per tick, so several alarms watching one
        /// Topic cost one cursor move rather than one each.
        /// </summary>
        [Fact]
        public void TheArchiveIsAskedOncePerTopicPerTick()
        {
            var archive = new Archive { Payload = Flight("vessel:abc", 101_000) };
            var reader = new RevealedScetStateReader(archive.Read, Vantage, 1000);

            reader.Read("vessel:abc", "vessel.flight", "altitudeAsl");
            reader.Read("vessel:abc", "vessel.flight", "altitudeAsl");

            Assert.Single(archive.Asked);
        }

        /// <summary>
        /// A read that throws costs this alarm its tick and nothing else. The
        /// roster is walked entry by entry and one unreadable condition must not
        /// take the rest of it inert.
        /// </summary>
        [Fact]
        public void AThrowingReadIsJustAnUnreadableCondition()
        {
            var archive = new Archive { Throws = new InvalidOperationException("archive") };
            var reader = new RevealedScetStateReader(archive.Read, Vantage, 1000);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read("vessel:abc", "vessel.flight", "altitudeAsl").Status);
        }

        /// <summary>
        /// With no vantage there is no ledger to read, and the archive is not
        /// asked at all: a blank vantage would otherwise mint a cursor under the
        /// empty key and pin that topic's history to it.
        /// </summary>
        [Fact]
        public void AnEmptyVantageAsksNothing()
        {
            var archive = new Archive { Payload = Flight("vessel:abc", 101_000) };
            var reader = new RevealedScetStateReader(archive.Read, "", 1000);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read("vessel:abc", "vessel.flight", "altitudeAsl").Status);
            Assert.Empty(archive.Asked);
        }
    }
}
