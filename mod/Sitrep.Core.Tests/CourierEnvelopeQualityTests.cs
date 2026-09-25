using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;
using Sitrep.Core;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The envelope's <see cref="Meta.Quality"/> is the payload's own. A client reads the
    /// envelope, so an envelope that always said <see cref="Quality.OnRails"/> made a craft
    /// under physics look like a coast however honestly its payload was stamped.
    /// </summary>
    public class CourierEnvelopeQualityTests
    {
        private static Dictionary<string, object?> VesselPayload(Quality quality) => new Dictionary<string, object?>
        {
            ["sma"] = 850_000.0,
            ["meta"] = new Dictionary<string, object?>
            {
                ["source"] = "vessel:8cbc9ce1-8f6f-4b60-87fa-e9ecf2cc1e98",
                ["quality"] = (int)quality,
            },
        };

        private static List<StreamData> DeliverOne(object? payload)
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());
            var delivered = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.orbit", "KSC", delivered.Add);

            courier.Record("system", "vessel.orbit", payload, 5);
            clock.AdvanceTo(5);

            return delivered;
        }

        [Fact]
        public void A_payload_stamped_loaded_arrives_in_an_envelope_that_says_loaded()
        {
            var delivered = DeliverOne(VesselPayload(Quality.Loaded));

            Assert.Single(delivered);
            Assert.Equal(Quality.Loaded, delivered[0].Meta.Quality);
        }

        [Fact]
        public void A_payload_stamped_on_rails_arrives_in_an_envelope_that_says_on_rails()
        {
            var delivered = DeliverOne(VesselPayload(Quality.OnRails));

            Assert.Equal(Quality.OnRails, delivered[0].Meta.Quality);
        }

        [Fact]
        public void A_payload_that_states_no_quality_is_on_rails()
        {
            Assert.Equal(Quality.OnRails, DeliverOne("v0")[0].Meta.Quality);
            Assert.Equal(Quality.OnRails, DeliverOne(new Dictionary<string, object?> { ["sma"] = 1.0 })[0].Meta.Quality);
        }

        [Fact]
        public void A_catch_up_carries_the_payloads_quality_as_well_as_a_live_delivery()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());
            courier.Record("system", "vessel.orbit", VesselPayload(Quality.Loaded), 0);
            clock.AdvanceTo(0);

            var lateJoiner = new List<StreamData>();
            courier.SubscribeStream("system", "vessel.orbit", "KSC", lateJoiner.Add);

            Assert.Single(lateJoiner);
            Assert.Equal(Quality.Loaded, lateJoiner[0].Meta.Quality);
        }
    }
}
