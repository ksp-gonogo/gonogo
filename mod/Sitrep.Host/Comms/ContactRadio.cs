using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>One hop of the path a craft's radio was using when it was read, as <c>comms.path</c> names its ends.</summary>
    public sealed class RadioHop
    {
        public RadioHop(string from, string to, bool toIsCraft, Dictionary<string, object?>? extensions = null)
        {
            From = from;
            To = to;
            ToIsCraft = toIsCraft;
            Extensions = extensions;
        }

        public string From { get; }

        public string To { get; }

        /// <summary>Whether the far end is a craft, whose id is then its bare guid, and not a ground station.</summary>
        public bool ToIsCraft { get; }

        /// <summary>The comms backend's own facts about the hop, as <see cref="CommsHop.Extensions"/> carries them, or null when it states none.</summary>
        public Dictionary<string, object?>? Extensions { get; }
    }

    /// <summary>
    /// What a craft's radio says of its own link home at one instant: whether
    /// it answers, how strong the link is, how the backend grades it, and the
    /// hops it was measured over.
    ///
    /// <para>The game solves a whole path at once, so the reading carries the
    /// state of every hop on it at the instant it was taken. It is therefore
    /// sent to each command centre no sooner than light leaving the farthest
    /// node on that path at that instant could reach the centre: a reading
    /// that says a relay near home has changed does not outrun the relay's own
    /// news. See <c>ChannelEngine.RecordCraftRadio</c>.</para>
    ///
    /// <para>Never sent to a client as it is. Each centre is sent
    /// <c>comms.signal</c> and <c>comms.degrade</c> made from the newest one
    /// it has heard.</para>
    /// </summary>
    public sealed class ContactRadio
    {
        /// <summary>How far a strength or a grading has to move before it is said again.</summary>
        public const double Quantum = 0.01;

        private static readonly IReadOnlyList<RadioHop> NoHops = new RadioHop[0];

        public ContactRadio(
            string craftId,
            bool connected,
            double strength,
            CommsDegrade degrade,
            IReadOnlyList<RadioHop>? hops = null,
            SignalQuantity quantity = SignalQuantity.Unknown)
        {
            CraftId = craftId;
            Connected = connected;
            Strength = strength;
            Quantity = quantity;
            Degrade = degrade;
            Hops = hops ?? NoHops;
        }

        /// <summary>The craft's plan node id, <c>vessel:&lt;guid&gt;</c>.</summary>
        public string CraftId { get; }

        public bool Connected { get; }

        /// <summary>The link's strength, as <see cref="CommsSignal.Strength"/> carries it.</summary>
        public double Strength { get; }

        /// <summary>Which quantity <see cref="Strength"/> is, as the backend that took the reading declares it.</summary>
        public SignalQuantity Quantity { get; }

        public CommsDegrade Degrade { get; }

        /// <summary>The hops the reading was measured over, from the craft outward. Empty when it had no path.</summary>
        public IReadOnlyList<RadioHop> Hops { get; }

        /// <summary>When the reading was taken. Set by whoever records it.</summary>
        public double CapturedUt { get; set; }

        /// <summary>Whether <paramref name="other"/> says nothing a centre would read differently: the same link, path and grading rule, and figures within <see cref="Quantum"/>.</summary>
        public bool SaysTheSameAs(ContactRadio? other)
        {
            if (other == null
                || other.CraftId != CraftId
                || other.Connected != Connected
                || Math.Abs(other.Strength - Strength) >= Quantum
                || other.Quantity != Quantity
                || other.Degrade.ModelId != Degrade.ModelId
                || other.Degrade.Level.HasValue != Degrade.Level.HasValue
                || (Degrade.Level.HasValue && Math.Abs(other.Degrade.Level!.Value - Degrade.Level.Value) >= Quantum)
                || other.Hops.Count != Hops.Count)
            {
                return false;
            }
            for (var i = 0; i < Hops.Count; i++)
            {
                if (other.Hops[i].From != Hops[i].From
                    || other.Hops[i].To != Hops[i].To
                    || !SameFacts(other.Hops[i].Extensions, Hops[i].Extensions))
                {
                    return false;
                }
            }
            return true;
        }

        /// <summary>
        /// Whether two bags of a backend's facts read the same: the same keys,
        /// and each value equal, a number being equal to one within a hundredth
        /// of it, so a rate that drifts with range is not said every tick.
        /// </summary>
        internal static bool SameFacts(IReadOnlyDictionary<string, object?>? a, IReadOnlyDictionary<string, object?>? b)
        {
            if (a == null || b == null)
            {
                return a == null && b == null;
            }
            if (a.Count != b.Count)
            {
                return false;
            }
            foreach (var fact in a)
            {
                if (!b.TryGetValue(fact.Key, out var other) || !SameFact(fact.Value, other))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool SameFact(object? a, object? b)
        {
            if (a is IReadOnlyDictionary<string, object?> bagA && b is IReadOnlyDictionary<string, object?> bagB)
            {
                return SameFacts(bagA, bagB);
            }
            if (a is double x && b is double y)
            {
                return x == y || Math.Abs(x - y) <= Quantum * Math.Max(Math.Abs(x), Math.Abs(y));
            }
            return Equals(a, b);
        }
    }
}
