using System;
using System.Collections.Generic;
using Gonogo.KSP.CommandCentres;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A command centre has to be REACHABLE, not merely a control source.
    ///
    /// <para><b>What was shipping.</b> <c>CrewedVesselSource</c> enumerated on
    /// <c>CommNode.isControlSource</c> alone, which says only that a command
    /// arriving at that node may be obeyed. A config patch can make a part a
    /// control point without giving it an antenna, and a node with no antenna
    /// power is disconnected by <c>CommNetwork.SetNodeConnection</c> before it
    /// looks at distance or occlusion, so the roster was offering a seat the
    /// network can never route to.</para>
    ///
    /// <para>These sit at the project root rather than under <c>CommandCentres/</c>
    /// because the rule is deliberately free of KSP types and runs on every
    /// checkout; that folder is dropped unless the reference assemblies are
    /// present. The source it gates, <c>CrewedVesselSource.cs</c>, needs a live
    /// <c>Vessel</c> and cannot be compiled here at all, which is why the wiring
    /// half below reads its shipped text.</para>
    /// </summary>
    public class CommandCentreReachTests
    {
        /// <summary>
        /// The motivating case, stated as the rule rather than as a branch for the
        /// one part family that hit it: a control source with no antenna power and
        /// no antenna part is unreachable.
        /// </summary>
        [Fact]
        public void a_control_source_carrying_no_antenna_is_not_reachable()
        {
            Assert.False(Reach(0.0, 0.0, Craft(withAntenna: false)));
        }

        [Fact]
        public void a_craft_carrying_an_antenna_part_is_reachable_even_when_the_stock_powers_are_zero()
        {
            // A network that replaces stock's range model zeroes both stock power
            // fields on every pass and keeps reachability in its own antenna list
            // instead. On such an install a power-only test is not merely weaker,
            // it is false for every vessel in the game; see CommandCentreReach.
            Assert.True(Reach(0.0, 0.0, Craft(withAntenna: true)));
        }

        /// <summary>
        /// Stock's own gate adds the two powers, and <c>CommNetVessel.UpdateComm</c>
        /// forces the case: when transmit is the larger of the two it is MOVED into
        /// the relay slot and transmit is zeroed, so a healthy relay-capable craft
        /// sits at <c>antennaTransmit.power == 0</c>. A test on either half alone
        /// would reject it.
        /// </summary>
        [Theory]
        [InlineData(0.0, 5000.0)]
        [InlineData(5000.0, 0.0)]
        public void either_power_alone_carries_the_node(double transmit, double relay)
        {
            Assert.True(Reach(transmit, relay, Craft(withAntenna: false)));
        }

        /// <summary>
        /// Unreadable parts are not evidence of absence. A vessel on rails with no
        /// ProtoVessel tells us nothing, and withdrawing a centre the operator can
        /// see on the strength of a failed read is the wrong way round.
        /// </summary>
        [Fact]
        public void parts_that_could_not_be_read_leave_the_centre_standing()
        {
            Assert.True(CommandCentreReach.CanBeReached<object>(0.0, 0.0, null, _ => false));
        }

        /// <summary>
        /// And a craft with no parts is the same failed read said differently: a
        /// vessel caught mid-load or mid-teardown has an empty list for a moment,
        /// and a centre blinking out of the picker for one pass is exactly the
        /// flicker this rule is written to avoid.
        /// </summary>
        [Fact]
        public void a_craft_with_no_parts_at_all_leaves_the_centre_standing()
        {
            Assert.True(CommandCentreReach.CanBeReached(0.0, 0.0, new bool[0], carries => carries));
        }

        /// <summary>
        /// The part walk costs a pass over every part of every control-source vessel
        /// and runs on every roster enumeration, so a node stock has already given a
        /// power to must not pay for it.
        /// </summary>
        [Fact]
        public void a_node_with_power_never_walks_the_parts()
        {
            var walked = 0;
            var reachable = CommandCentreReach.CanBeReached(
                5000.0,
                0.0,
                new[] { false },
                _ =>
                {
                    walked++;
                    return false;
                });

            Assert.True(reachable);
            Assert.Equal(0, walked);
        }

        /// <summary>
        /// The walk stops at the first antenna: a 300-part station should not be
        /// read to the end to learn what its first dish already said.
        /// </summary>
        [Fact]
        public void the_walk_stops_at_the_first_antenna()
        {
            var walked = 0;
            var reachable = CommandCentreReach.CanBeReached(
                0.0,
                0.0,
                new[] { true, true, true },
                carries =>
                {
                    walked++;
                    return carries;
                });

            Assert.True(reachable);
            Assert.Equal(1, walked);
        }

        /// <summary>
        /// Source text, not behaviour, and for the reason
        /// <c>AwayScienceArmIsWiredTests</c> spells out: a test that calls the rule
        /// proves the rule works and says nothing about whether the shipped
        /// enumeration reaches it. That gap is the whole defect here, since the rule
        /// did not exist and the enumeration was the only thing wrong.
        /// </summary>
        [Fact]
        public void the_crewed_vessel_enumeration_gates_on_reachability()
        {
            var source = CurrencyDelaySourceText.ReadRelative(
                System.IO.Path.Combine("CommandCentres", "CrewedVesselSource.cs"));

            Assert.Contains("CommandCentreReach.CanBeReached", source, StringComparison.Ordinal);
        }

        private static bool Reach(double transmit, double relay, IEnumerable<bool> parts) =>
            CommandCentreReach.CanBeReached(transmit, relay, parts, carries => carries);

        /// <summary>A craft as the rule sees it: one flag per part, "does it carry an antenna".</summary>
        private static IEnumerable<bool> Craft(bool withAntenna) =>
            new[] { false, withAntenna, false };
    }
}
