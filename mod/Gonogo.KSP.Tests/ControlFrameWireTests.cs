using System.Collections.Generic;
using Gonogo.KSP;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class ControlFrameWireTests
    {
        private static ControlFrame Kerbin(ControlFrameOption[]? settable) => new ControlFrame
        {
            Kind = ControlFrameKind.BodyCentredInertial,
            CentreBody = "Kerbin",
            TargetFrameSelected = false,
            SettableFrames = settable,
        };

        [Fact]
        public void AViewThatCannotBeMovedTravelsAsAnEmptyListNotAsAbsent()
        {
            var wire = ControlFrameWire.Flatten(Kerbin(new ControlFrameOption[0]));

            var settable = Assert.IsType<List<object?>>(wire["settableFrames"]);
            Assert.Empty(settable);
        }

        [Fact]
        public void ASourceThatDidNotSayTravelsAsNull()
        {
            var wire = ControlFrameWire.Flatten(Kerbin(null));

            Assert.True(wire.ContainsKey("settableFrames"));
            Assert.Null(wire["settableFrames"]);
        }

        [Fact]
        public void EachSettableFrameTravelsFlattenedWithItsKindAsAnOrdinal()
        {
            var wire = ControlFrameWire.Flatten(Kerbin(new[]
            {
                new ControlFrameOption
                {
                    Kind = ControlFrameKind.BarycentricRotating,
                    PrimaryBody = "Kerbin",
                    SecondaryBody = "Mun",
                },
            }));

            var settable = Assert.IsType<List<object?>>(wire["settableFrames"]);
            var option = Assert.IsType<Dictionary<string, object?>>(Assert.Single(settable));
            Assert.Equal((int)ControlFrameKind.BarycentricRotating, option["kind"]);
            Assert.Null(option["centreBody"]);
            Assert.Equal("Kerbin", option["primaryBody"]);
            Assert.Equal("Mun", option["secondaryBody"]);
            Assert.Null(option["targetFrameSelected"]);
        }
    }
}
