using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// A publisher that can say a sample as a named craft rather than as the
    /// one being flown: what a craft reports of its own end, which it sends
    /// over its own link.
    /// </summary>
    public interface ICraftSaidPublisher : IChannelPublisher
    {
        /// <summary>
        /// Publishes <paramref name="payload"/> as said by the craft
        /// <paramref name="vesselId"/> at <paramref name="ut"/>. It reaches each
        /// command centre at the craft's own signal delay as of its last
        /// contact, and no centre at all when the craft had no route when it
        /// said it, or carried no radio.
        /// </summary>
        /// <param name="vesselId">The craft's bare guid.</param>
        void PublishSaidBy(string vesselId, object? payload, double ut);
    }
}
