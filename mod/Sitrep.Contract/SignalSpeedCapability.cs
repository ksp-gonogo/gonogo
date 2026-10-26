using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The <c>signalSpeed</c> capability: how fast signals travel between a
    /// command centre and a craft in this save, as the operator has set it.
    /// Resolve it through <see cref="IUplinkHost.Kernel"/> as an
    /// <see cref="ISignalSpeed"/>. Useful for an Uplink that computes light
    /// times of its own, such as a camera mod stamping each frame with the
    /// delay of what it drew, and must use the same speed the delay of every
    /// command and reading uses. Gonogo registers the only provider.
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class SignalSpeedCapability
    {
        /// <summary>The capability id, <c>"signalSpeed"</c>.</summary>
        public const string Id = "signalSpeed";

        /// <summary>The speed of light in vacuum, in metres per second: the speed a save with no light-speed setting runs at.</summary>
        public const double LightSpeedMetresPerSecond = 299792458.0;
    }

    /// <summary>
    /// How fast signals travel at one moment, as
    /// <see cref="ISignalSpeed.Current"/> reports it.
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class SignalSpeedReading
    {
        /// <summary>Builds a reading. Nothing but the provider needs to.</summary>
        /// <param name="metresPerSecond">The speed in metres per second, or null when signals are not delayed.</param>
        public SignalSpeedReading(double? metresPerSecond)
        {
            MetresPerSecond = metresPerSecond;
        }

        /// <summary>
        /// The speed signals travel at, in metres per second: positive and
        /// finite. The speed of light in vacuum when nothing has set another.
        /// Null when signals are not delayed (the operator has switched signal
        /// delay off, or the save models no comms network), where every signal
        /// arrives at once; null is not a speed of zero.
        /// </summary>
        public double? MetresPerSecond { get; }

        /// <summary>Whether two readings state the same speed.</summary>
        public bool Same(SignalSpeedReading? other) =>
            other != null && MetresPerSecond == other.MetresPerSecond;
    }

    /// <summary>
    /// How fast signals travel in this save, read only, with a notice when the
    /// operator changes it. Used by an Uplink that passes the speed on to
    /// another mod, such as a camera mod's light-time stamp.
    ///
    /// <para>Safe to read from any thread. <see cref="Changed"/> is raised on
    /// the game's main thread.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface ISignalSpeed : ISitrepProvider
    {
        /// <summary>The speed signals travel at now. Never null.</summary>
        SignalSpeedReading Current { get; }

        /// <summary>
        /// Raised with the new reading after the speed changes, whether the
        /// operator set the light speed, switched signal delay on or off, or a
        /// modifier an Uplink holds moved it. Not raised for a change that
        /// leaves the speed as it was.
        /// </summary>
        event Action<SignalSpeedReading>? Changed;
    }
}
