using System;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>How a currency event's delay was determined. See <see cref="KscDelay"/>.</summary>
    public enum KscDelayKind
    {
        /// <summary>A genuine zero: signal delay is switched off, so events land immediately and honestly.</summary>
        Instant,

        /// <summary>A live CommNet control path whose last hop is home. The one and only way a delay gets measured.</summary>
        Routed,

        /// <summary>No route home. NOT a delay of any length — an absence of one.</summary>
        Unroutable,
    }

    /// <summary>
    /// The delay applied to one currency event, as a value that cannot be
    /// silently coerced into a number.
    ///
    /// <para><b>This type exists to make a specific bug unwriteable.</b> The
    /// delay used to be a <c>double?</c>, and every call site ended
    /// <c>?? 0.0</c> — so "no route home" and "no delay" collapsed into the
    /// same zero, and science transmitted from the far side of the system was
    /// credited instantly. There were five such sites. A nullable double
    /// invites that; a struct with no implicit conversion to <c>double</c> and
    /// no <c>GetValueOrDefault</c> does not. Reading the seconds requires
    /// naming the <see cref="KscDelayKind.Unroutable"/> case first, which is
    /// the whole point.</para>
    ///
    /// <para>The rule it enforces (see
    /// <c>local_docs/design/2026-08-15-unroutable-currency-consensus.md</c>): a
    /// currency event is delayed by exactly ONE number, the one-way light-time
    /// of a live control path whose last hop is home. There is no second way to
    /// compute a delay, and specifically no straight-line distance fallback —
    /// a chord through the planet a craft is hiding behind is not a signal
    /// path.</para>
    /// </summary>
    public readonly struct KscDelay : IEquatable<KscDelay>
    {
        public static readonly KscDelay Instant = new KscDelay(KscDelayKind.Instant, 0.0);
        public static readonly KscDelay Unroutable = new KscDelay(KscDelayKind.Unroutable, 0.0);

        private readonly double _seconds;

        private KscDelay(KscDelayKind kind, double seconds)
        {
            Kind = kind;
            _seconds = seconds;
        }

        public KscDelayKind Kind { get; }

        /// <summary>
        /// A measured one-way light-time. Rejects a negative or non-finite
        /// value rather than carrying it into the ledger, where it would
        /// reveal in the past.
        /// </summary>
        public static KscDelay Routed(double oneWaySeconds)
        {
            if (double.IsNaN(oneWaySeconds) || double.IsInfinity(oneWaySeconds) || oneWaySeconds < 0.0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(oneWaySeconds),
                    "A routed light-time must be finite and non-negative; got " + oneWaySeconds);
            }
            return new KscDelay(KscDelayKind.Routed, oneWaySeconds);
        }

        public bool IsUnroutable => Kind == KscDelayKind.Unroutable;

        /// <summary>
        /// The seconds to add to the event UT, for the two kinds that have
        /// one. THROWS for <see cref="KscDelayKind.Unroutable"/>: there is no
        /// number to give, and returning zero is the defect this type exists to
        /// prevent. Call sites must branch on <see cref="IsUnroutable"/> and
        /// queue the event Blocked instead.
        /// </summary>
        public double Seconds
        {
            get
            {
                if (Kind == KscDelayKind.Unroutable)
                {
                    throw new InvalidOperationException(
                        "An unroutable currency event has no light-time. Queue it Blocked with the "
                        + "silence-declaration deadline instead of treating the absence as zero.");
                }
                return _seconds;
            }
        }

        /// <summary>
        /// The reveal UT for an event that happened at <paramref name="eventUt"/>.
        /// <paramref name="silenceDeclarationSeconds"/> is the policy deadline
        /// an unroutable event waits out — the point at which KSC stops waiting
        /// and reconciles the books. It is honestly a policy, not a pretend
        /// measurement, and it is what makes the never-regains-contact case
        /// terminate at all.
        /// </summary>
        public double RevealUt(double eventUt, double silenceDeclarationSeconds) =>
            Kind == KscDelayKind.Unroutable
                ? eventUt + silenceDeclarationSeconds
                : eventUt + _seconds;

        public bool Equals(KscDelay other) =>
            Kind == other.Kind && _seconds.Equals(other._seconds);

        public override bool Equals(object obj) => obj is KscDelay other && Equals(other);

        public override int GetHashCode() => ((int)Kind * 397) ^ _seconds.GetHashCode();

        public override string ToString() =>
            Kind == KscDelayKind.Routed ? "Routed(" + _seconds.ToString("F3") + "s)" : Kind.ToString();
    }
}
