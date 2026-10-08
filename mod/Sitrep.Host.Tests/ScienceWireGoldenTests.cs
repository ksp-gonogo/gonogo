using System.Collections.Generic;
using System.Text.Json;
using Sitrep.Contract.Serialization;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The five elected-science channels' wire text, held byte for byte. The
    /// producers return typed entries and the writer flattens them; this fixes
    /// that the text a client receives is what the dictionary producers wrote
    /// before, for a snapshot that covers present values, absent ones, a
    /// non-finite number and a missing key.
    /// </summary>
    public class ScienceWireGoldenTests
    {
        private static KspSnapshot Snapshot() => new KspSnapshot
        {
            Ut = 100.0,
            Values = new Dictionary<string, object?>
            {
                ["science"] = new Dictionary<string, object?>
                {
                    ["experiments"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partName"] = "Mystery Goo Containment Pod",
                            ["location"] = "experiment",
                            ["experimentId"] = "mysteryGoo",
                            ["subjectId"] = "mysteryGoo@KerbinSrfLanded",
                            ["title"] = "Mystery Goo Observation",
                            ["dataAmount"] = 5.0,
                            ["scienceValueRatio"] = 1.0,
                            ["baseTransmitValue"] = 0.3,
                            ["transmitBonus"] = 1.0,
                            ["labValue"] = 1.0,
                            ["deployed"] = true,
                            ["inoperable"] = false,
                            ["situation"] = "LANDED",
                        },
                        new Dictionary<string, object?>
                        {
                            ["partName"] = "Science Jr.",
                            ["location"] = "container",
                            ["experimentId"] = null,
                            ["dataAmount"] = double.NaN,
                            ["deployed"] = null,
                        },
                    },
                    ["instruments"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partId"] = "4012",
                            ["partName"] = "Thermometer",
                            ["experimentId"] = "temperatureScan",
                            ["title"] = "Temperature Scan",
                            ["deployed"] = false,
                            ["inoperable"] = false,
                            ["rerunnable"] = true,
                            ["resettable"] = true,
                            ["dataIsCollectable"] = false,
                        },
                    },
                    ["lab"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partName"] = "Mobile Processing Lab",
                            ["dataStored"] = 120.5,
                            ["dataStorage"] = 750.0,
                            ["storedScience"] = 3.25,
                            ["processingData"] = true,
                            ["statusText"] = "Processing",
                            ["scientistCount"] = 2,
                            ["scienceRate"] = 0.75,
                            ["isOperational"] = true,
                        },
                    },
                    ["sensors"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partId"] = "4013",
                            ["partName"] = "Accelerometer",
                            ["type"] = "ACC",
                            ["readout"] = "1.02 g",
                            ["active"] = true,
                        },
                    },
                    ["experimentBreakdown"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["subjectId"] = "mysteryGoo@KerbinSrfLanded",
                            ["biome"] = "Shores",
                            ["situation"] = "SrfLanded",
                            ["expTitle"] = "Mystery Goo Observation",
                            ["dataMits"] = 5.0,
                            ["remainingPotential"] = double.PositiveInfinity,
                        },
                    },
                },
            },
        };

        private static string Render(object? value)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "science",
                Payload = value,
                Meta = new Meta
                {
                    Source = "science",
                    ValidAt = 0,
                    Seq = 1,
                    DeliveredAt = 0,
                    Vantage = "v",
                    Quality = Quality.OnRails,
                    Active = true,
                    Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            };
            using var doc = JsonDocument.Parse(EnvelopeCodec.WriteStreamData(msg));
            return doc.RootElement.GetProperty("payload").GetRawText();
        }

        private static string All()
        {
            var snapshot = Snapshot();
            return string.Join(
                "\n",
                Render(ScienceViewProvider.BuildExperiments(snapshot)),
                Render(ScienceViewProvider.BuildInstruments(snapshot)),
                Render(ScienceViewProvider.BuildLab(snapshot)),
                Render(ScienceViewProvider.BuildSensors(snapshot)),
                Render(ScienceViewProvider.BuildExperimentBreakdown(snapshot)));
        }

        /// <summary>
        /// Captured from the dictionary producers before they returned typed
        /// entries, one line per channel in the order <see cref="All"/> renders them.
        /// </summary>
        private static readonly string[] Expected =
        {
                "[{\"partName\":\"Mystery Goo Containment Pod\",\"location\":\"experiment\",\"experimentId\":\"mysteryGoo\",\"subjectId\":\"mysteryGoo@KerbinSrfLanded\",\"title\":\"Mystery Goo Observation\",\"dataAmount\":5,\"scienceValueRatio\":1,\"baseTransmitValue\":0.3,\"transmitBonus\":1,\"labValue\":1,\"deployed\":true,\"inoperable\":false,\"situation\":\"LANDED\",\"valueModel\":\"stock\"},{\"partName\":\"Science Jr.\",\"location\":\"container\",\"experimentId\":null,\"subjectId\":null,\"title\":null,\"dataAmount\":null,\"scienceValueRatio\":null,\"baseTransmitValue\":null,\"transmitBonus\":null,\"labValue\":null,\"deployed\":null,\"inoperable\":null,\"situation\":null,\"valueModel\":\"stock\"}]",
                "[{\"partId\":\"4012\",\"partName\":\"Thermometer\",\"experimentId\":\"temperatureScan\",\"title\":\"Temperature Scan\",\"deployed\":false,\"inoperable\":false,\"rerunnable\":true,\"resettable\":true,\"dataIsCollectable\":false}]",
                "[{\"partName\":\"Mobile Processing Lab\",\"dataStored\":120.5,\"dataStorage\":750,\"storedScience\":3.25,\"processingData\":true,\"statusText\":\"Processing\",\"scientistCount\":2,\"scienceRate\":0.75,\"isOperational\":true,\"valueModel\":\"stock\"}]",
                "[{\"partId\":\"4013\",\"partName\":\"Accelerometer\",\"type\":\"ACC\",\"readout\":\"1.02 g\",\"active\":true}]",
                "[{\"subjectId\":\"mysteryGoo@KerbinSrfLanded\",\"biome\":\"Shores\",\"situation\":\"SrfLanded\",\"expTitle\":\"Mystery Goo Observation\",\"dataMits\":5,\"remainingPotential\":null,\"valueModel\":\"stock\"}]",
        };

        [Fact]
        public void TheFiveChannelsWriteTheTextTheDictionaryProducersWrote()
        {
            Assert.Equal(string.Join("\n", Expected), All());
        }
    }
}
