// A fixture, excluded from compilation. One declared and registered command and one
// declared and published topic, each written once on each side, so the wiring walk
// in Sitrep.Core.Tests/UplinkWiringCoverageTests.cs always has a pairing to read and
// to plant a violation in, at any number of real Uplinks including none.
namespace Gonogo.PlantedUplink
{
    internal sealed class PlantedWiring
    {
        private const string PlantedCommand = "planted.wiring.command";
        private const string PlantedTopic = "planted.wiring.topic";

        internal static object[] Declarations() => new object[]
        {
            new CommandDeclaration { Command = PlantedCommand },
            new ChannelDeclaration { Topic = PlantedTopic },
        };

        internal static void Register(IUplinkHost host)
        {
            host.AddCommandHandler<object, object>(PlantedCommand, args => args);
            host.Publisher(PlantedTopic);
        }
    }
}
