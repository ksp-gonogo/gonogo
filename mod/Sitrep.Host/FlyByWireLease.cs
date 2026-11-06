namespace Sitrep.Host
{
    /// <summary>
    /// The time a fly-by-wire override stays armed without word from the console that
    /// armed it. Arming starts the lease and <c>vessel.control.holdFlyByWire</c>
    /// renews it; once it lapses the override is dropped, so a console that crashed,
    /// closed or lost its connection cannot leave the craft holding the stick.
    /// </summary>
    public sealed class FlyByWireLease
    {
        /// <summary>How long an override stays armed without a renewal, in seconds. Several renewal intervals, so jitter on the link never drops a live override.</summary>
        public const double LeaseSeconds = 5.0;

        private double? _expiresAt;

        /// <summary>True while a lease is running.</summary>
        public bool Held => _expiresAt.HasValue;

        /// <summary>Starts or extends the lease from <paramref name="now"/>, in seconds on any steady clock.</summary>
        public void Renew(double now) => _expiresAt = now + LeaseSeconds;

        /// <summary>Ends the lease without waiting for it to lapse.</summary>
        public void Release() => _expiresAt = null;

        /// <summary>True when a lease is running and <paramref name="now"/> is past its end.</summary>
        public bool HasLapsed(double now) => _expiresAt.HasValue && now >= _expiresAt.Value;
    }
}
