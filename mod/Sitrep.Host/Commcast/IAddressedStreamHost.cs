using System.Collections.Generic;
using Sitrep.Core;

namespace Sitrep.Host.Commcast
{
    /// <summary>
    /// Streams whose every sample is said BY one command centre TO a named set of
    /// others: it crosses from the speaker to each listener at that pair's
    /// light-time, and a listener outside the set never receives it.
    ///
    /// <para>Implemented by the engine and reached by casting the
    /// <c>IUplinkHost</c> handed to <c>Register</c>, because the only producer is
    /// gonogo's own messaging Uplink.</para>
    /// </summary>
    public interface IAddressedStreamHost
    {
        /// <summary>
        /// Mark a topic the calling Uplink declared as addressed. Registration time
        /// only. Its samples then leave only through <see cref="PublishAddressed"/>.
        /// </summary>
        void DeclareAddressedTopic(string topic);

        /// <summary>
        /// Send <paramref name="payload"/> from <paramref name="fromCentre"/>, valid
        /// at <paramref name="validAtUt"/>, to every centre in
        /// <paramref name="audience"/>. Courier thread only, which is where a
        /// command handler runs.
        /// </summary>
        void PublishAddressed(
            string topic,
            object payload,
            double validAtUt,
            string fromCentre,
            IEnumerable<string> audience);

        /// <summary>
        /// Whether a signal from <paramref name="fromCentre"/> has a routed path to
        /// <paramref name="toCentre"/> right now. A centre always reaches itself.
        /// </summary>
        bool HasRoute(string fromCentre, string toCentre);

        /// <summary>
        /// The delay a signal leaving <paramref name="fromCentre"/> now is sent
        /// under, per listening vantage: the same stamp a published sample carries.
        /// </summary>
        DelayStamp StampFrom(string fromCentre);
    }
}
