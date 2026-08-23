using System;
using Sitrep.Contract;

namespace Sitrep.Core
{
    /// <summary>
    /// Builds the input a propagation may honestly start from: the newest VESSEL
    /// state that has actually reached a vantage, carrying the instant it was true.
    ///
    /// <para>The propagation seam cannot supply this on its own.
    /// <c>PropagationTarget</c> carries an identity rather than a state, so anything
    /// solved through it starts from the running game's truth, which is ahead of
    /// everything the operator can see.</para>
    ///
    /// <para>There is deliberately no fall-back to live state. A vantage that has
    /// heard nothing gets a refusal, because the alternative is showing it something
    /// its light has not carried: at half an hour of delay, the difference between a
    /// craft that is fine and one that stopped existing four minutes ago.</para>
    ///
    /// <para><b>This is about vessels, and only vessels.</b> Where a planet will be is
    /// not delay-sensitive: an operator knows Duna's position in two hundred days for
    /// the same reason an astronomer does, and nothing about that is news carried by
    /// light from a spacecraft. Body ephemerides may come from anywhere. Routing them
    /// through here would refuse to draw a solar system on the grounds that nobody has
    /// radioed in its shape.</para>
    /// </summary>
    public static class DelayedStateReader
    {
        /// <summary>
        /// Read <paramref name="topic"/> as <paramref name="vantage"/> may currently
        /// see it, and turn it into a state a solve can be seeded from.
        ///
        /// <para><paramref name="toState"/> converts whatever the channel carries
        /// (orbital elements, on the wire today) into a position and velocity about a
        /// centre. It is supplied rather than built in because that conversion is
        /// orbital mechanics and this is the archive layer. What this guarantees is
        /// that the INSTANT travels with the value, whatever the value turns out to
        /// be.</para>
        /// </summary>
        public static DelayedObservation Read(
            Archive archive,
            string topic,
            string vantage,
            double delaySeconds,
            double nowUt,
            Func<object?, StateAboutBody?> toState)
        {
            if (archive == null)
            {
                throw new ArgumentNullException(nameof(archive));
            }
            if (toState == null)
            {
                throw new ArgumentNullException(nameof(toState));
            }
            if (double.IsNaN(delaySeconds) || double.IsNaN(nowUt) || delaySeconds < 0)
            {
                return DelayedObservation.Refused(
                    DelayedStateRefusal.DelayUnknown,
                    "This vantage's one-way delay is not known, so what it may currently see "
                        + "cannot be established.");
            }

            var sample = archive.ReadAtVantage(topic, vantage, delaySeconds, nowUt, out var sceneUt);
            if (sample == null)
            {
                return DelayedObservation.Refused(
                    DelayedStateRefusal.NothingArrived,
                    "Nothing about '" + topic + "' has reached this vantage yet. That is a fact "
                        + "about the observer rather than about the craft.");
            }

            var converted = toState(sample.Value.Value);
            if (converted == null)
            {
                return DelayedObservation.Refused(
                    DelayedStateRefusal.BeyondRetainedHistory,
                    "The arrived sample for '" + topic + "' carries no state a propagation could "
                        + "be seeded from.");
            }

            // The stamp is the SAMPLE's own instant, never `sceneUt`. They differ
            // whenever a channel is slower than the read: a value recorded well before
            // the window edge is still the newest thing that has arrived, and dating
            // it at the edge asserts the craft held that state later than it did.
            // `sceneUt` is what the vantage can currently SEE; the sample's ValidAt is
            // when the thing seen was TRUE.
            return DelayedObservation.At(
                converted.Value.State,
                converted.Value.CentreBodyIndex,
                sample.Value.ValidAt,
                sceneUt);
        }
    }

    /// <summary>A state and the body it is expressed about.</summary>
    public readonly struct StateAboutBody
    {
        public StateAboutBody(StateVector state, int centreBodyIndex)
        {
            State = state;
            CentreBodyIndex = centreBodyIndex;
        }

        public StateVector State { get; }
        public int CentreBodyIndex { get; }
    }
}
