using System;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// What the walk does, decided on the craft, for one antenna, on one tick.
    /// KSP-free and RealAntennas-free, so every branch of it is reachable
    /// headlessly.
    ///
    /// <para><b>The signal is the craft's connectivity and nothing finer.</b>
    /// Nothing can say whether an entry WOULD close a link without aiming at it,
    /// because the pointing loss a dish takes depends on where it is currently
    /// aimed. So the walk tries an entry and reads the answer off the craft's own
    /// comms link, which on a RealAntennas install is RealAntennas' answer and is
    /// already this Uplink's authority over its own geometric margin (see
    /// <see cref="RealAntennasUplink.CaptureOnMain"/>, where a positive 49 dB
    /// margin once accompanied a link that was down).</para>
    ///
    /// <para><b>A loss restarts at the top.</b> The chain is ordered by
    /// preference, so the entry to try first after a loss is always the first
    /// one: the reason the preferred target failed an hour ago (an occultation)
    /// has probably passed. The alternative, resuming where the last walk
    /// stopped, leaves a craft on its last-resort target for the rest of the
    /// mission.</para>
    ///
    /// <para><b>A connected craft is never re-aimed.</b> Retrying the preferred
    /// entry while a later one is carrying the link costs the link, for a
    /// preference. So the walk holds at whatever worked and only moves again on
    /// the next loss, which is also when the preferred entry gets its next
    /// chance.</para>
    ///
    /// <para><b>The walk does not give up.</b> Past the last entry it wraps to
    /// the first and counts a lap. A chain that stopped after one pass would leave
    /// a craft dark on a target already proven not to work, and the operator
    /// asked for a fallback, not for one attempt at each. The lap count is what
    /// says the cause is not in the list.</para>
    /// </summary>
    internal static class RaChainPolicy
    {
        /// <summary>
        /// How long an applied entry is left alone before it is judged, when the
        /// chain does not name its own.
        ///
        /// <para>Thirty seconds of game time, chosen against the two costs it
        /// sits between rather than measured: shorter than this and a solve that
        /// has not finished, or a craft a few seconds from clearing a limb, reads
        /// as a target that does not work; longer and a real outage lasts longer
        /// than it needed to.</para>
        /// </summary>
        public const double DefaultSettleSeconds = 30.0;

        /// <summary>The smallest settle a chain may ask for, so a chain cannot slew a dish every tick.</summary>
        public const double MinimumSettleSeconds = 1.0;

        /// <summary>What the walk should do with an antenna this tick.</summary>
        internal enum Move
        {
            /// <summary>Nothing: the craft has a link, or nothing readable to act on.</summary>
            Hold,

            /// <summary>Nothing yet: the entry in place has not had its settle time.</summary>
            Settle,

            /// <summary>Aim the antenna at <see cref="Decision.Step"/>.</summary>
            Apply,
        }

        /// <summary>
        /// The walk's mutable state for one antenna. Held by the register, put in
        /// the save with the chain, and advanced only through
        /// <see cref="Decide"/> / <see cref="RecordApplied"/>.
        /// </summary>
        internal sealed class Walk
        {
            /// <summary>The entry currently aimed at, or null before the first one is applied.</summary>
            public int? ActiveStep;

            /// <summary>When <see cref="ActiveStep"/> was aimed at, in game time.</summary>
            public double? LastAppliedUt;

            /// <summary>Completed passes through the chain since the craft last had a link.</summary>
            public int Laps;
        }

        /// <summary>What to do, and which entry, plus the sentence that says why.</summary>
        internal readonly struct Decision
        {
            public Decision(Move move, int step, string state, string? detail)
            {
                Move = move;
                Step = step;
                State = state;
                Detail = detail;
            }

            public Move Move { get; }

            /// <summary>The entry to aim at, meaningful only for <see cref="Move.Apply"/>.</summary>
            public int Step { get; }

            /// <summary>The wire word for <c>RealAntennasAntennaChain.State</c>.</summary>
            public string State { get; }

            /// <summary>The wire sentence for <c>RealAntennasAntennaChain.Detail</c>.</summary>
            public string? Detail { get; }
        }

        public const string StateHolding = "holding";
        public const string StateSettling = "settling";
        public const string StateWalking = "walking";
        public const string StateBlocked = "blocked";

        /// <summary>
        /// The settle time in force: the chain's own, clamped to
        /// <see cref="MinimumSettleSeconds"/>, or
        /// <see cref="DefaultSettleSeconds"/> when it named none.
        ///
        /// <para>A non-finite request is treated as no request rather than
        /// refused at the command: it arrives as a double off the wire, and the
        /// honest reading of a NaN settle is that the client did not supply
        /// one.</para>
        /// </summary>
        public static double SettleSecondsFor(double? requested)
        {
            if (requested == null || double.IsNaN(requested.Value) || double.IsInfinity(requested.Value))
            {
                return DefaultSettleSeconds;
            }
            return Math.Max(MinimumSettleSeconds, requested.Value);
        }

        /// <summary>
        /// Records that the craft has a link, which is the only thing that clears
        /// the lap tally.
        ///
        /// <para>Cleared here rather than at the next loss so the read-back shows
        /// a holding chain with no laps against it, instead of the tally from an
        /// outage that has already ended. It is a separate call from
        /// <see cref="Decide"/> because a read of the chain must not move the
        /// walk: the channel describes it every tick, and a describe that mutated
        /// would make the numbers depend on who was subscribed.</para>
        /// </summary>
        internal static void NoteConnected(Walk walk) => walk.Laps = 0;

        /// <summary>
        /// What to do with one antenna's chain this tick. PURE: it reads the walk
        /// and never writes it, see <see cref="NoteConnected"/>.
        ///
        /// <para><paramref name="connected"/> is the craft's comms link:
        /// <c>null</c> means it could not be read, and an unreadable signal is a
        /// reason to do nothing. Advancing on it would slew a dish that may be the
        /// one carrying the link, on the strength of a read that never happened,
        /// which is the same mistake a <c>?? false</c> makes one layer up.</para>
        /// </summary>
        internal static Decision Decide(Walk walk, int stepCount, bool? connected, double nowUt, double settleSeconds)
        {
            if (stepCount <= 0)
            {
                return new Decision(Move.Hold, 0, StateBlocked, "This chain has no entries, so there is nothing to try.");
            }

            if (connected == null)
            {
                return new Decision(
                    Move.Hold,
                    0,
                    StateBlocked,
                    "The craft would not say whether it has a link, so the chain is held rather than moved on a reading nobody took.");
            }

            if (connected.Value)
            {
                return new Decision(Move.Hold, 0, StateHolding, null);
            }

            if (walk.ActiveStep != null && walk.LastAppliedUt != null)
            {
                var elapsed = nowUt - walk.LastAppliedUt.Value;
                // A negative elapsed is a clock that went backwards, which is what
                // a revert or a load does. The entry in place has effectively just
                // been applied, so it gets its settle time again rather than being
                // judged against a moment in another timeline.
                if (elapsed < settleSeconds)
                {
                    return new Decision(
                        Move.Settle,
                        walk.ActiveStep.Value,
                        StateSettling,
                        "Waiting to see whether the target in place gives the craft a link.");
                }
            }

            var next = NextStep(walk.ActiveStep, stepCount);
            return new Decision(
                Move.Apply,
                next,
                StateWalking,
                walk.ActiveStep == null
                    ? "The craft has no link, so the chain is starting at its first target."
                    : "The target in place did not give the craft a link, so the chain has moved on.");
        }

        /// <summary>
        /// The entry after the active one: the first entry when the walk has not
        /// started, and the first again after the last, wrapping.
        /// </summary>
        internal static int NextStep(int? activeStep, int stepCount)
        {
            if (activeStep == null)
            {
                return 0;
            }
            var next = activeStep.Value + 1;
            return next >= stepCount ? 0 : next;
        }

        /// <summary>
        /// Writes an applied entry into the walk. A wrap back to the first entry
        /// counts a lap, which is the only thing that ever increments it.
        /// </summary>
        internal static void RecordApplied(Walk walk, int step, int stepCount, double nowUt)
        {
            if (walk.ActiveStep != null && step == 0 && stepCount > 1)
            {
                walk.Laps++;
            }
            walk.ActiveStep = step;
            walk.LastAppliedUt = nowUt;
        }

        /// <summary>
        /// Forgets where the walk had got to, leaving the chain itself alone. Used
        /// when the chain is replaced: the new list's first entry is the one to
        /// try next, and an index into the old list means nothing against it.
        /// </summary>
        internal static void Rewind(Walk walk)
        {
            walk.ActiveStep = null;
            walk.LastAppliedUt = null;
            walk.Laps = 0;
        }
    }
}
