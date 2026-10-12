using System.Globalization;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A number on the wire must read back as the same double, or an echoed value fails an
    /// equality check against the original. The writer must not lean on the runtime's
    /// default formatting, which under Mono keeps fifteen significant digits.
    /// </summary>
    public class JsonNumberRoundTripTests
    {
        [Theory]
        [InlineData(0.1 + 0.2, "0.30000000000000004")]
        [InlineData(13599840256.123456789, "13599840256.123457")]
        [InlineData(9007199254740993.0, "9007199254740992")]
        [InlineData(1.7976931348623157e308, "1.7976931348623157e+308")]
        [InlineData(5e-324, "5e-324")]
        public void a_number_is_written_so_it_reads_back_exactly(double value, string expected)
        {
            var json = EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "numbers",
                Payload = value,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            });

            using var document = JsonDocument.Parse(json);
            var written = document.RootElement.GetProperty("payload").GetRawText();

            Assert.Equal(expected, written);
            Assert.Equal(value, double.Parse(written, NumberStyles.Float, CultureInfo.InvariantCulture));
        }
    }
}
