using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// Where an object that has left the game would be now, placed by the rule
    /// it was last placed by, for a stock day after it left.
    /// </summary>
    public class GonePlacesTests
    {
        private static Func<double, Vector3d?> MovingAlongX() => ut => new Vector3d(ut, 0.0, 0.0);

        private static Dictionary<string, Func<double, Vector3d?>> Present(params string[] keys) =>
            keys.ToDictionary(key => key, _ => MovingAlongX());

        [Fact]
        public void AnObjectMissingFromAPassIsPlacedByItsLastRuleFromThenOn()
        {
            var places = new GonePlaces();
            places.Note(Present("vessel:a", "vessel:b"), 10.0);
            Assert.Empty(places.At(10.0));

            places.Note(Present("vessel:b"), 11.0);

            var gone = Assert.Single(places.At(500.0));
            Assert.Equal("vessel:a", gone.Key);
            Assert.Equal(500.0, gone.At.x);
        }

        [Fact]
        public void AnObjectNamedAgainIsNoLongerGone()
        {
            var places = new GonePlaces();
            places.Note(Present("vessel:a"), 10.0);
            places.Note(Present(), 11.0);

            places.Note(Present("vessel:a"), 12.0);

            Assert.Empty(places.At(12.0));
        }

        [Fact]
        public void AGoneObjectIsForgottenAStockDayAfterItWent()
        {
            var places = new GonePlaces();
            places.Note(Present("vessel:a"), 10.0);
            places.Note(Present(), 11.0);

            places.Note(Present(), 11.0 + CraftSighting.GoneSightHorizonSeconds);
            Assert.Single(places.At(11.0 + CraftSighting.GoneSightHorizonSeconds));

            places.Note(Present(), 12.0 + CraftSighting.GoneSightHorizonSeconds);
            Assert.Empty(places.At(12.0 + CraftSighting.GoneSightHorizonSeconds));
        }

        [Fact]
        public void ATimelineRewoundToBeforeAnObjectWentForgetsItsGoing()
        {
            var places = new GonePlaces();
            places.Note(Present("vessel:a"), 10.0);
            places.Note(Present(), 20.0);

            places.Note(Present(), 15.0);

            Assert.Empty(places.At(15.0));
        }

        [Fact]
        public void AnObjectItsRuleCannotPlaceIsLeftOut()
        {
            var places = new GonePlaces();
            places.Note(new Dictionary<string, Func<double, Vector3d?>> { ["vessel:a"] = _ => null }, 10.0);
            places.Note(Present(), 11.0);

            Assert.Empty(places.At(12.0));
        }
    }
}
