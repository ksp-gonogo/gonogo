using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>The save payloads as a client receives them, with an absent slot and an absent reason written as null.</summary>
    public class SaveSlotsWireTests
    {
        private static string Write(object payload)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "ksp.saves",
                Payload = payload,
                Meta = new Meta
                {
                    Source = "ksp",
                    Vantage = "v",
                    Quality = Quality.OnRails,
                    Active = true,
                    Staleness = Staleness.Fresh,
                },
            };
            using var doc = JsonDocument.Parse(EnvelopeCodec.WriteStreamData(msg));
            return doc.RootElement.GetProperty("payload").GetRawText();
        }

        [Fact]
        public void AnEmptySlotIsNullAndAFilledOneCarriesItsIdAndUt()
        {
            var json = Write(new SaveSlots { Quicksave = new SaveSummary { SaveId = "a1", Ut = 12.5 } });
            Assert.Equal("{\"quicksave\":{\"saveId\":\"a1\",\"ut\":12.5},\"previousQuicksave\":null}", json);
        }

        [Fact]
        public void AFinishedLoadCarriesEveryField()
        {
            var json = Write(new GameLoaded { LoadId = "l", Outcome = GameLoaded.Failed, FailReason = "no", SaveUt = 1, FromUt = 2, RequestedBy = "Station 3" });
            Assert.Equal("{\"loadId\":\"l\",\"outcome\":\"failed\",\"failReason\":\"no\",\"saveUt\":1,\"fromUt\":2,\"requestedBy\":\"Station 3\"}", json);
        }

        [Fact]
        public void ALoadThatDidNotFailWritesANullReason()
        {
            Assert.Contains("\"failReason\":null", Write(new GameLoaded { Outcome = GameLoaded.Loaded }));
        }

        [Fact]
        public void TheCommandRepliesCarryTheirFields()
        {
            Assert.Equal("{\"saveId\":\"s\",\"ut\":3}", Write(new SaveWritten { SaveId = "s", Ut = 3 }));
            Assert.Equal("{\"saveId\":\"s\",\"saveUt\":3,\"loadId\":\"l\"}", Write(new LoadScheduled { SaveId = "s", SaveUt = 3, LoadId = "l" }));
        }
    }
}
