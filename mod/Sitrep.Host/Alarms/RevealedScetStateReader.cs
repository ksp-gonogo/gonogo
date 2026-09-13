using System;
using System.Collections.Generic;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// Reads a threshold against what ONE VANTAGE HAS BEEN TOLD, rather than
    /// against the simulation's own state.
    ///
    /// <para>The twin of <see cref="SnapshotScetStateReader"/>, and the ONLY
    /// difference between them is where the payload comes from. That one builds
    /// it from this tick's snapshot, upstream of the reveal gate, which is what
    /// makes a SCET alarm a SCET alarm. This one takes the payload the archive
    /// says has arrived at <see cref="_vantage"/>, which is a light-time old and
    /// different at every place. Once a payload is in hand the question is
    /// identical, so both walk it through <see cref="ScetPayload"/>.</para>
    ///
    /// <para><b>No fall-back to live state, ever.</b> A vantage that has been
    /// told nothing gets <see cref="ScetReadingStatus.NotObservable"/>, and an
    /// alarm that cannot be read does not fire. Substituting the game's own
    /// reading would answer the question this reader exists to refuse.</para>
    ///
    /// <para><b>It can never answer <see cref="ScetReadingStatus.SubjectGone"/>,
    /// and that is not an omission.</b> That status is a permanent fact the
    /// simulation knows and a command centre does not: the craft is destroyed,
    /// so the condition can never be met again. Saying it here would carry news
    /// of a loss to a place whose light has not brought it yet, which is the one
    /// leak the whole delay model exists to prevent. A vantage whose craft is
    /// gone simply stops being told anything new, and its alarm sits
    /// unreadable, which is what an operator at that distance genuinely
    /// knows.</para>
    /// </summary>
    public sealed class RevealedScetStateReader : IScetStateReader
    {
        /// <summary>
        /// What a topic looks like at this vantage now: the arrived payload, or
        /// null if nothing has reached it. Supplied as a delegate because the
        /// archive and the delay ledger both live in the Courier, which this
        /// assembly's alarm arm has no business holding.
        /// </summary>
        private readonly Func<string, string, double, object?> _readAtVantage;

        private readonly string _vantage;
        private readonly double _nowUt;

        /// <summary>
        /// One tick's worth of answers, so several alarms on one Topic cost one
        /// archive read. Within the tick only: the whole point of the read is
        /// that it moves with the vantage's own clock, and a cache that outlived
        /// the tick would freeze the vantage at whatever it had been told when
        /// the reader was built.
        /// </summary>
        private readonly Dictionary<string, object?> _payloads =
            new Dictionary<string, object?>(StringComparer.Ordinal);

        public RevealedScetStateReader(
            Func<string, string, double, object?> readAtVantage, string vantage, double nowUt)
        {
            _readAtVantage = readAtVantage ?? throw new ArgumentNullException(nameof(readAtVantage));
            _vantage = vantage ?? "";
            _nowUt = nowUt;
        }

        public ScetReading Read(string subject, string topic, string fieldPath)
        {
            if (string.IsNullOrEmpty(topic) || string.IsNullOrEmpty(fieldPath) || _vantage.Length == 0)
            {
                return ScetReading.NotObservable;
            }

            if (!_payloads.TryGetValue(topic, out var payload))
            {
                try
                {
                    payload = _readAtVantage(topic, _vantage, _nowUt);
                }
                catch (Exception)
                {
                    // Fail-soft to the same posture every other unreadable
                    // threshold takes. An archive read that threw is a reason
                    // this alarm cannot be evaluated this tick, not a reason to
                    // take the rest of the roster down with it.
                    payload = null;
                }
                _payloads[topic] = payload;
            }

            if (payload is not IDictionary<string, object?> root)
            {
                return ScetReading.NotObservable;
            }

            // The same provenance rule the snapshot reader applies, and it
            // matters MORE here: the arrived payload is whatever was true when
            // it left, so an alarm armed against one craft must not answer off a
            // frame another craft sent.
            if (ScetPayload.ReadSource(root) is not { } source
                || !string.Equals(source, subject, StringComparison.Ordinal))
            {
                return ScetReading.NotObservable;
            }

            return ScetPayload.ReadNumber(root, fieldPath) is { } value
                ? ScetReading.Observed(value)
                : ScetReading.NotObservable;
        }
    }
}
