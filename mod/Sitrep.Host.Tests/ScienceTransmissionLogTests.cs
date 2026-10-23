using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A transmission is on the wire only once its last packet has left the craft, the last
    /// twenty are kept, and one seen by watching is not counted twice beside the command that
    /// started it.
    /// </summary>
    public class ScienceTransmissionLogTests
    {
        [Fact]
        public void ATransmissionStillBeingSentIsNotOnTheWire()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "crewReport@Kerbin", "Crew Report", 5, 100, 106);

            Assert.Null(log.Release(105.9));
            Assert.Null(log.ToWire("v1"));
        }

        [Fact]
        public void ItArrivesOnTheTickItsLastPacketHasLeftAndIsStampedWhenItLeft()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "crewReport@Kerbin", "Crew Report", 5, 100, 106);

            Assert.Equal(106, log.Release(109));

            var wire = Assert.Single(log.ToWire("v1")!);
            Assert.Equal("crewReport@Kerbin", wire["subjectId"]);
            Assert.Equal("Crew Report", wire["title"]);
            Assert.Equal(5.0, wire["dataAmount"]);
            Assert.Equal(100.0, wire["startedAt"]);
            Assert.Equal(106.0, wire["completedAt"]);
        }

        [Fact]
        public void AnArrivedTransmissionIsReleasedOnce()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "a", "A", 1, 100, 101);
            log.Release(102);

            Assert.Null(log.Release(200));
        }

        [Fact]
        public void OnlyTheLastTwentyAreKeptOldestFirst()
        {
            var log = new ScienceTransmissionLog();
            for (var i = 0; i < 25; i++)
            {
                log.Expect("v1", "s" + i, "T" + i, 1, i, i + 0.5);
            }
            log.Release(1000);

            var wire = log.ToWire("v1")!;
            Assert.Equal(ScienceTransmissionLog.Capacity, wire.Count);
            Assert.Equal("s5", wire[0]["subjectId"]);
            Assert.Equal("s24", wire[wire.Count - 1]["subjectId"]);
        }

        [Fact]
        public void ATransmissionWatchedAndAlsoCommandedIsKeptAsTheCommandRecordedIt()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "crewReport@Kerbin", "Crew Report", 5, 100, 106);

            log.ExpectObserved("v1", "crewReport@Kerbin", "Crew Report", 5, 100.4, 107.2);
            log.Release(110);

            var wire = Assert.Single(log.ToWire("v1")!);
            Assert.Equal(106.0, wire["completedAt"]);
        }

        [Fact]
        public void ADuplicateIsAlsoCaughtAfterTheCommandsOwnEntryHasArrived()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "crewReport@Kerbin", "Crew Report", 5, 100, 106);
            log.Release(106.5);

            log.ExpectObserved("v1", "crewReport@Kerbin", "Crew Report", 5, 100.4, 107.2);
            log.Release(110);

            Assert.Single(log.ToWire("v1")!);
        }

        [Fact]
        public void AWatchedTransmissionNoCommandStartedIsRecorded()
        {
            var log = new ScienceTransmissionLog();

            log.ExpectObserved("v1", "mysteryGoo@Kerbin", "Mystery Goo", 10, 200, 230);

            Assert.Equal(230, log.Release(231));
            Assert.Equal("Mystery Goo", Assert.Single(log.ToWire("v1")!)["title"]);
        }

        [Fact]
        public void TheSameSubjectSentAgainLaterIsASecondTransmission()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "crewReport@Kerbin", "Crew Report", 5, 100, 106);

            log.ExpectObserved("v1", "crewReport@Kerbin", "Crew Report", 5, 400, 406);
            log.Release(500);

            Assert.Equal(2, log.ToWire("v1")!.Count);
        }

        [Fact]
        public void ATransmissionGivenUpBeforeItArrivedIsTakenBackAndNeverPublished()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "crewReport@Kerbin", "Crew Report", 5, 100, 106);

            Assert.True(log.Cancel("v1", "crewReport@Kerbin", 100.3));

            Assert.Null(log.Release(200));
            Assert.Null(log.ToWire("v1"));
        }

        [Fact]
        public void ATransmissionThatAlreadyArrivedIsTakenBackWhenItIsLaterReportedGivenUp()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "crewReport@Kerbin", "Crew Report", 5, 100, 106);
            log.Release(107);

            Assert.True(log.Cancel("v1", "crewReport@Kerbin", 100));

            Assert.Null(log.ToWire("v1"));
        }

        [Fact]
        public void ACommandedTwoSecondTransmissionArrivesOnTheTickAfterItsStreamEndsAndIsNotListedTwice()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("v1", "temperatureScan@KerbinSrfLanded", "Temperature Scan", 8, 1719.0, 1721.07);

            Assert.Null(log.Release(1721.0));
            log.ExpectObserved("v1", "temperatureScan@KerbinSrfLanded", "Temperature Scan", 8, 1719.0, 1721.1);

            Assert.Equal(1721.07, log.Release(1721.1));
            Assert.Single(log.ToWire("v1")!);
        }

        [Fact]
        public void OnlyTheActiveVesselsArrivalsAreOnTheWire()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("probe", "tempScan", "Temperature Scan", 8, 100, 102);
            log.Expect("pod", "crewReport", "Crew Report", 5, 200, 203);
            log.Release(300);

            var wire = Assert.Single(log.ToWire("pod")!);
            Assert.Equal("Crew Report", wire["title"]);
            Assert.Equal("Temperature Scan", Assert.Single(log.ToWire("probe")!)["title"]);
            Assert.Null(log.ToWire("another"));
        }

        [Fact]
        public void AWatchedTransmissionIsKeptWithTheVesselThatSentIt()
        {
            var log = new ScienceTransmissionLog();
            log.ExpectObserved("probe", "mysteryGoo", "Mystery Goo", 10, 200, 230);
            log.Release(231);

            Assert.Null(log.ToWire("pod"));
            Assert.Single(log.ToWire("probe")!);
        }

        [Fact]
        public void TheSameSubjectOnTwoVesselsAtTheSameMomentIsTwoTransmissions()
        {
            var log = new ScienceTransmissionLog();
            log.Expect("probe", "crewReport@Kerbin", "Crew Report", 5, 100, 106);
            log.ExpectObserved("pod", "crewReport@Kerbin", "Crew Report", 5, 100.4, 107);
            log.Release(110);

            Assert.Single(log.ToWire("probe")!);
            Assert.Single(log.ToWire("pod")!);
        }
    }
}
