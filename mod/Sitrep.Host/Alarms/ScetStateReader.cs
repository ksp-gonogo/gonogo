using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>What a reading attempt came back with.</summary>
    public enum ScetReadingStatus
    {
        /// <summary>
        /// Nothing to compare this tick, and no statement about why. No vessel
        /// loaded yet, the alarm's craft is not the one the payload describes,
        /// the path names nothing, or the value is not a finite number.
        ///
        /// <para>Deliberately one status rather than four. An alarm that cannot
        /// be read simply does not fire, and telling the four apart would only
        /// let the roster act differently on distinctions that all mean "not
        /// now".</para>
        /// </summary>
        NotObservable,

        /// <summary>A finite number was read, and <see cref="ScetReading.Value"/> is it.</summary>
        Observed,

        /// <summary>
        /// The craft the alarm names is gone from the simulation entirely, so
        /// the condition can never be met again. Distinct from
        /// <see cref="NotObservable"/> because it is permanent and because it is
        /// something the simulation knows and the command centre does not.
        /// </summary>
        SubjectGone,
    }

    /// <summary>One attempt to read the value a threshold condition watches.</summary>
    public readonly struct ScetReading
    {
        public ScetReadingStatus Status { get; }

        /// <summary>The reading, meaningful only when <see cref="Status"/> is <see cref="ScetReadingStatus.Observed"/>.</summary>
        public double Value { get; }

        private ScetReading(ScetReadingStatus status, double value)
        {
            Status = status;
            Value = value;
        }

        public static ScetReading Observed(double value) =>
            new ScetReading(ScetReadingStatus.Observed, value);

        public static readonly ScetReading NotObservable =
            new ScetReading(ScetReadingStatus.NotObservable, 0);

        public static readonly ScetReading SubjectGone =
            new ScetReading(ScetReadingStatus.SubjectGone, 0);
    }

    /// <summary>
    /// What the roster is handed so it can evaluate a threshold: one question,
    /// "what does this craft's Topic say at this field right now".
    ///
    /// <para>The seam exists so <see cref="ScetAlarmRoster"/> stays what it is:
    /// told the clock, told the readings, deciding only what should happen. The
    /// reading itself is taken upstream of the reveal gate, which is the whole
    /// point of a SCET threshold and the only part of it that touches the
    /// game's own state.</para>
    /// </summary>
    public interface IScetStateReader
    {
        /// <summary>
        /// Read <paramref name="fieldPath"/> out of <paramref name="topic"/>'s
        /// payload, for the craft named by <paramref name="subject"/> in the
        /// <c>"vessel:&lt;guid&gt;"</c> / <c>"game"</c> vocabulary
        /// <see cref="ScetAlarm.Subject"/> uses.
        /// </summary>
        ScetReading Read(string subject, string topic, string fieldPath);

        /// <summary>
        /// <paramref name="topic"/>'s whole payload, when it is about
        /// <paramref name="subject"/>; null when there is none to read or it is
        /// about something else. For a condition that needs more than one number
        /// out of a payload, under the same provenance rule
        /// <see cref="Read"/> applies.
        /// </summary>
        IDictionary<string, object?>? ReadPayload(string subject, string topic);
    }

    /// <summary>
    /// A reader that can find any contract the career has finished, not only
    /// the recent ones a career payload lists. Without one, a contract missing
    /// from every list may have finished out of the payload's sight, so it is
    /// not taken as having left the career.
    /// </summary>
    public interface IScetFinishedContracts
    {
        /// <summary>
        /// Every contract the career has finished, keyed by contract id, each in
        /// the career payload's contract shape; null when the list could not be
        /// read or is not about <paramref name="subject"/>.
        /// </summary>
        IDictionary<string, object?>? FinishedContracts(string subject);
    }

    /// <summary>Where a contract objective stands against the state an alarm waits for.</summary>
    internal enum ContractParameterMatch
    {
        /// <summary>Nothing could be read this tick, which says nothing about the objective.</summary>
        Unread,

        /// <summary>The objective is in the target state.</summary>
        Holds,

        /// <summary>The objective is not in the target state yet, and its contract is still active.</summary>
        NotYet,

        /// <summary>The objective will never be in the target state: its contract finished with it elsewhere, or left the career.</summary>
        Never,
    }

    /// <summary>
    /// Getting a provenance stamp and a number out of one wire payload.
    ///
    /// <para>Shared because the two readers differ only in where the payload
    /// came from: <see cref="SnapshotScetStateReader"/> builds it from this
    /// tick's snapshot, <see cref="RevealedScetStateReader"/> takes the one the
    /// archive says a vantage has been told. What a payload means once you hold
    /// it is the same question either way, and two copies of this walk would be
    /// two chances for a SCET alarm and its command-vantage twin to disagree for
    /// a reason that has nothing to do with delay.</para>
    /// </summary>
    internal static class ScetPayload
    {
        /// <summary>
        /// The payload's own provenance stamp, which is the only thing that
        /// stops an alarm armed against one craft answering off another's
        /// readings after the player switches vessels. A payload that does not
        /// say who it is about is not an answer to a question that names a
        /// craft.
        /// </summary>
        internal static string? ReadSource(IDictionary<string, object?> root) =>
            root.TryGetValue("meta", out var raw)
                && raw is IDictionary<string, object?> meta
                && meta.TryGetValue("source", out var source)
                    ? source as string
                    : null;

        /// <summary>
        /// Walk a dotted path to a finite number, or null for anything else.
        ///
        /// <para>A bool or a string at the end of the path is a miss rather than
        /// a coercion. A threshold is a comparison between two numbers, and
        /// turning <c>true</c> into 1 would let an operator arm "landed &gt; 0.5"
        /// and get an alarm whose meaning nothing on screen explains.</para>
        /// </summary>
        internal static double? ReadNumber(IDictionary<string, object?> root, string fieldPath)
        {
            object? current = root;
            var from = 0;
            while (from <= fieldPath.Length)
            {
                var dot = fieldPath.IndexOf('.', from);
                var segment = dot < 0
                    ? fieldPath.Substring(from)
                    : fieldPath.Substring(from, dot - from);
                if (segment.Length == 0
                    || current is not IDictionary<string, object?> node
                    || !node.TryGetValue(segment, out current))
                {
                    return null;
                }
                if (dot < 0)
                {
                    break;
                }
                from = dot + 1;
            }

            return AsFiniteNumber(current);
        }

        /// <summary>
        /// Where one objective of one contract stands against
        /// <paramref name="target"/>, read out of a <c>career.status</c> payload.
        ///
        /// <para>The contract is looked for among the active ones, then among the
        /// recently completed and recently failed ones, then in
        /// <paramref name="finishedById"/>: completing or failing the last objective
        /// takes the contract out of the active list in the same stock call, so an
        /// objective that reached its target that way is only to be found among the
        /// finished. The recent lists are bounded, and a burst of completions pushes
        /// a contract out of them within a tick, so only the whole finished list can
        /// say a contract is not there.</para>
        ///
        /// <para><see cref="ContractParameterMatch.Unread"/> when the lists could not
        /// be read at all, which is a different claim from an empty one, and for an
        /// objective found with no readable ordinal, which says nothing about its
        /// state. A match is decided on the ordinal, never the name, so a renamed
        /// state cannot silently stop an alarm matching. An objective of a finished
        /// contract can no longer change, so one not in its target state there, a
        /// finished contract with no such objective, and a contract found in none of
        /// the lists including <paramref name="finishedById"/> are all
        /// <see cref="ContractParameterMatch.Never"/>. With no
        /// <paramref name="finishedById"/>, a contract found in none of the lists is
        /// <see cref="ContractParameterMatch.Unread"/>.</para>
        /// </summary>
        /// <param name="finishedById">Every contract the career has finished, by id, or null when the reader cannot say.</param>
        internal static ContractParameterMatch MatchContractParameter(
            IDictionary<string, object?> career,
            IDictionary<string, object?>? finishedById,
            string contractId,
            string parameterTitle,
            KspParameterState target)
        {
            int? position = null;
            return MatchContractParameter(career, finishedById, contractId, parameterTitle, target, ref position);
        }

        /// <summary>
        /// <see cref="MatchContractParameter(IDictionary{string, object}, IDictionary{string, object}, string, string, KspParameterState)"/>
        /// that also follows the objective by its position in the contract's list.
        ///
        /// <para>An objective's title is the game's display text and can change
        /// with its state: a state objective titled "Vessel state" reads "Vessel
        /// state: Altitude ..." once it is complete. A title that matched is
        /// therefore recorded as a position in <paramref name="position"/>, and
        /// a contract's list in which no title matches is read at that position,
        /// so the objective the alarm was armed on is still the one judged after
        /// it renames itself. With no position recorded, and no title that
        /// matches, the objective is not found.</para>
        /// </summary>
        /// <param name="position">Where the armed objective sat in its contract's list when its title last matched, updated on each match; null before one.</param>
        internal static ContractParameterMatch MatchContractParameter(
            IDictionary<string, object?> career,
            IDictionary<string, object?>? finishedById,
            string contractId,
            string parameterTitle,
            KspParameterState target,
            ref int? position)
        {
            if (!career.TryGetValue("contracts", out var rawContracts)
                || rawContracts is not IDictionary<string, object?> contracts
                || !contracts.TryGetValue("active", out var rawActive)
                || rawActive is not IEnumerable<object?> active)
            {
                return ContractParameterMatch.Unread;
            }

            if (FindContract(active, contractId) is { } live)
            {
                return MatchParameter(live, parameterTitle, target, finished: false, ref position);
            }
            foreach (var finishedList in new[] { "completedRecent", "failedRecent" })
            {
                if (contracts.TryGetValue(finishedList, out var rawFinished)
                    && rawFinished is IEnumerable<object?> finished
                    && FindContract(finished, contractId) is { } done)
                {
                    return MatchParameter(done, parameterTitle, target, finished: true, ref position);
                }
            }
            if (finishedById == null)
            {
                return ContractParameterMatch.Unread;
            }
            if (finishedById.TryGetValue(contractId, out var rawEarlier)
                && rawEarlier is IDictionary<string, object?> earlier)
            {
                return MatchParameter(earlier, parameterTitle, target, finished: true, ref position);
            }
            return ContractParameterMatch.Never;
        }

        private static IDictionary<string, object?>? FindContract(IEnumerable<object?> list, string contractId)
        {
            foreach (var rawContract in list)
            {
                if (rawContract is IDictionary<string, object?> contract
                    && contract.TryGetValue("id", out var id)
                    && string.Equals(id as string, contractId, StringComparison.Ordinal))
                {
                    return contract;
                }
            }
            return null;
        }

        private static ContractParameterMatch MatchParameter(
            IDictionary<string, object?> contract,
            string parameterTitle,
            KspParameterState target,
            bool finished,
            ref int? position)
        {
            var notYet = finished ? ContractParameterMatch.Never : ContractParameterMatch.NotYet;
            if (!contract.TryGetValue("parameters", out var rawParameters)
                || rawParameters is not IEnumerable<object?> parameters)
            {
                return ContractParameterMatch.Unread;
            }

            var list = parameters.ToList();
            var at = -1;
            for (var i = 0; i < list.Count; i++)
            {
                if (list[i] is IDictionary<string, object?> candidate
                    && candidate.TryGetValue("title", out var title)
                    && string.Equals(title as string, parameterTitle, StringComparison.Ordinal))
                {
                    at = i;
                    break;
                }
            }
            if (at < 0 && position is { } remembered && remembered < list.Count)
            {
                at = remembered;
            }
            if (at < 0 || list[at] is not IDictionary<string, object?> parameter)
            {
                return notYet;
            }

            position = at;
            parameter.TryGetValue("stateOrdinal", out var ordinal);
            if (AsFiniteNumber(ordinal) is not { } state)
            {
                return ContractParameterMatch.Unread;
            }
            return state == (int)target ? ContractParameterMatch.Holds : notYet;
        }

        private static double? AsFiniteNumber(object? value)
        {
            double number;
            switch (value)
            {
                case double d: number = d; break;
                case float f: number = f; break;
                case int i: number = i; break;
                case long l: number = l; break;
                case short s: number = s; break;
                case byte b: number = b; break;
                case decimal m: number = (double)m; break;
                // An enum reaches the wire as its integer, and a threshold on one
                // is a legitimate way to ask "has the situation changed".
                case Enum e: number = Convert.ToDouble(e, CultureInfo.InvariantCulture); break;
                default: return null;
            }
            return double.IsNaN(number) || double.IsInfinity(number) ? null : number;
        }
    }
}
