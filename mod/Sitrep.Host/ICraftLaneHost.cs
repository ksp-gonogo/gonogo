using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The host side of craft lanes: every craft's vessel readings kept on that
    /// craft's own node, so a centre is told them after that craft's own signal
    /// delay whichever craft is active, and a screen reading an active-vessel
    /// topic is shown the active craft's lane.
    /// </summary>
    public interface ICraftLaneHost
    {
        /// <summary>
        /// Declares that <paramref name="topic"/> describes whichever craft is
        /// active: each reading is also kept in that craft's lane, and a screen
        /// subscribed to it reads the active craft's lane, re-pointed at a switch.
        /// Call while registering, before the engine starts.
        /// </summary>
        void FollowActiveCraft(string topic);

        /// <summary>
        /// Builds every following topic for the craft <paramref name="vesselId"/>
        /// from <paramref name="snapshot"/>, which holds that one craft as its
        /// <c>vessel</c> entry, with each topic's own mapper, and keeps the
        /// readings in that craft's lane at <see cref="KspSnapshot.Ut"/>. A
        /// topic whose mapper reads nothing for this craft is left without a
        /// reading rather than given an empty one. Meant for a craft that is not the
        /// active one, whose lane is kept from its own readings; a reading of a
        /// craft that has just become active is still its reading at that instant.
        /// </summary>
        void WriteCraftSnapshot(string vesselId, KspSnapshot snapshot);

        /// <summary>
        /// Keeps <paramref name="value"/> in the lane of the craft
        /// <paramref name="vesselId"/> as <c>craft.&lt;guid&gt;.&lt;fact&gt;</c>, at
        /// <paramref name="ut"/>: something the game holds about that craft that no
        /// active-vessel topic carries, such as the tanks in its saved snapshot.
        /// Ignored for a <paramref name="fact"/> that names an active-vessel topic.
        /// </summary>
        void HoldCraftFact(string vesselId, string fact, object? value, double ut);
    }
}
