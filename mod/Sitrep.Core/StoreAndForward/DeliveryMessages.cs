using System;
using System.Collections.Generic;

namespace Sitrep.Core.StoreAndForward
{
    /// <summary>
    /// A lane: every delayed command one command centre sends to one craft, in
    /// one timeline. Commands on a lane run in the order they were sent; lanes
    /// are never ordered against each other.
    /// </summary>
    public readonly struct LaneKey : IEquatable<LaneKey>
    {
        public LaneKey(long epoch, string vantage, string craft)
        {
            Epoch = epoch;
            Vantage = vantage;
            Craft = craft;
        }

        public long Epoch { get; }

        /// <summary>The command centre the lane's commands are sent from.</summary>
        public string Vantage { get; }

        /// <summary>The craft they are sent to, as a node id.</summary>
        public string Craft { get; }

        public bool Equals(LaneKey other) =>
            Epoch == other.Epoch
            && string.Equals(Vantage, other.Vantage, StringComparison.Ordinal)
            && string.Equals(Craft, other.Craft, StringComparison.Ordinal);

        public override bool Equals(object? obj) => obj is LaneKey other && Equals(other);

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = Epoch.GetHashCode();
                hash = (hash * 397) ^ StringComparer.Ordinal.GetHashCode(Vantage ?? "");
                return (hash * 397) ^ StringComparer.Ordinal.GetHashCode(Craft ?? "");
            }
        }

        public override string ToString() => Epoch + "|" + Vantage + "|" + Craft;
    }

    /// <summary>Anything the network carries from node to node.</summary>
    public abstract class DeliveryMessage
    {
        /// <summary>The mod-minted id: a node that receives an id it already holds or delivered ignores the second copy.</summary>
        public string Id { get; set; } = "";

        /// <summary>Where the message is going, as a node id.</summary>
        public abstract string Destination { get; }

        /// <summary>When the message is deleted wherever it is, or infinity for a report, which has no lifetime.</summary>
        public abstract double ExpiresUt { get; }

        /// <summary>
        /// The plan this message travels by: the one its command's sending centre
        /// held when the command left it. A relay routes the rest of the way from
        /// this and nothing newer, since a craft has no way to know what the
        /// centre has learned since. Null under a network that sends on the live
        /// path, and after a game load, which saves no plan.
        /// </summary>
        public IDeliveryRoutes? Plan { get; set; }

        /// <summary>
        /// The hops that plan chose when the message last left a node, the next one
        /// first. Saved with the game, so a message whose plan was lost to a load
        /// still knows which link it is waiting for.
        /// </summary>
        public List<PlannedHop> Route { get; set; } = new List<PlannedHop>();
    }

    /// <summary>A delayed command on its way to the craft.</summary>
    public sealed class CommandMessage : DeliveryMessage
    {
        public LaneKey Lane { get; set; }

        /// <summary>Its position on its lane, assigned at send.</summary>
        public long LaneSeq { get; set; }

        /// <summary>
        /// The latest expiry of any earlier command on the lane the sender had not
        /// seen resolved when this one was sent; null when there was none, which
        /// releases a waiting successor at once.
        /// </summary>
        public double? GapExpiresUt { get; set; }

        /// <summary>When it was sent.</summary>
        public double SentUt { get; set; }

        /// <summary>When it stops being worth running: an hour after it was sent, or an earlier deadline it carries.</summary>
        public double DeleteAtUt { get; set; }

        /// <summary>The command id.</summary>
        public string Command { get; set; } = "";

        /// <summary>Its arguments, as the client sent them.</summary>
        public object? Args { get; set; }

        /// <summary>The node the craft's handler runs it on, in the courier's own vocabulary.</summary>
        public string ExecNode { get; set; } = "";

        /// <summary>The control channel this command writes, when it is a channel's write half; null for every other command.</summary>
        public string? Channel { get; set; }

        /// <summary>Earlier lane numbers a hold discarded in favour of this one, which the craft counts as settled when this arrives.</summary>
        public List<long> Supersedes { get; set; } = new List<long>();

        /// <summary>Which copy of its lane number this is: 1 for the first, more after a send again.</summary>
        public int Attempt { get; set; } = 1;

        /// <summary>
        /// The id the client chose for the request that sent it, empty when it did
        /// not come from a client. Every copy carries it, and so does the reply,
        /// so a game that was restarted since can still find the client's answer.
        /// </summary>
        public string ClientRequestId { get; set; } = "";

        public override string Destination => Lane.Craft;

        public override double ExpiresUt => DeleteAtUt;
    }

    /// <summary>
    /// A cancel on its way to the craft, naming one lane number or that number
    /// and every later one the sender had assigned when it was pressed.
    /// </summary>
    public sealed class CancelMessage : DeliveryMessage
    {
        public LaneKey Lane { get; set; }

        /// <summary>The first lane number it names.</summary>
        public long FromSeq { get; set; }

        /// <summary>The last lane number it names: the same as <see cref="FromSeq"/> for one command.</summary>
        public long ThroughSeq { get; set; }

        /// <summary>When it was sent.</summary>
        public double SentUt { get; set; }

        /// <summary>The latest expiry over every copy of every number it names; past it, nothing it names can still arrive.</summary>
        public double DeleteAtUt { get; set; }

        /// <summary>
        /// The node this copy is headed for, when it is a second copy sent to a
        /// predicted hold rather than to the craft; null for the craft.
        /// </summary>
        public string? TargetNode { get; set; }

        /// <summary>Whether it names <paramref name="seq"/>.</summary>
        public bool Names(long seq) => seq >= FromSeq && seq <= ThroughSeq;

        public override string Destination => Lane.Craft;

        public override double ExpiresUt => DeleteAtUt;
    }

    /// <summary>What a journey report says happened.</summary>
    public enum JourneyKind
    {
        /// <summary>A node is holding the command for its next window.</summary>
        Held,

        /// <summary>A node that had held it sent it on.</summary>
        Departed,

        /// <summary>It reached its expiry where it was and was deleted.</summary>
        Expired,

        /// <summary>A cancel stopped it where it was.</summary>
        Cancelled,

        /// <summary>It reached the craft and waits for earlier lane numbers.</summary>
        Waiting,

        /// <summary>The craft discarded it: its lane number had already settled.</summary>
        Discarded,

        /// <summary>A cancel reached the craft first; the craft will refuse the command whenever it arrives.</summary>
        CancelStored,

        /// <summary>A cancel reached the craft after the command had run.</summary>
        CancelLate,

        /// <summary>A cancel reached a node after the command had left it, and follows it on.</summary>
        CancelLateHere,

        /// <summary>The command ran; the report carries its result.</summary>
        Reply,
    }

    /// <summary>A report on its way back to the command centre that sent a command.</summary>
    public sealed class ReportMessage : DeliveryMessage
    {
        /// <summary>The command centre it is going to.</summary>
        public string To { get; set; } = "";

        public JourneyKind Kind { get; set; }

        /// <summary>The id of the command, or cancel, it is about.</summary>
        public string About { get; set; } = "";

        public LaneKey Lane { get; set; }

        /// <summary>The lane number of the command it is about, or the cancel's first number.</summary>
        public long LaneSeq { get; set; }

        /// <summary>The node it is reporting from.</summary>
        public string At { get; set; } = "";

        /// <summary>When the thing it reports happened, at that node.</summary>
        public double AtUt { get; set; }

        /// <summary>For a hold, when the node predicts it will leave; for a departure, where it went.</summary>
        public double? UntilUt { get; set; }

        /// <summary>A short reason, for a discard or a late cancel.</summary>
        public string? Detail { get; set; }

        /// <summary>For a reply, what the command's handler returned.</summary>
        public object? Result { get; set; }

        /// <summary>The <see cref="CommandMessage.ClientRequestId"/> of the command it is about, empty for a cancel.</summary>
        public string ClientRequestId { get; set; } = "";

        /// <summary>The command id of the command it is about, empty for a cancel.</summary>
        public string Command { get; set; } = "";

        /// <summary>For a waiting report, the lane numbers the craft is still missing.</summary>
        public IReadOnlyList<long>? Missing { get; set; }

        /// <summary>When it reached its command centre: set as it is delivered there, and the same as <see cref="AtUt"/> for one made at the centre itself.</summary>
        public double LandedUt { get; set; }

        /// <summary>
        /// For a report that one copy of a command expired or was discarded:
        /// whether another copy of the same lane number, one sent again, is still
        /// unaccounted for and may yet run. Set as the report is delivered at its
        /// centre. While it is true the command is not finished.
        /// </summary>
        public bool OtherCopiesOut { get; set; }

        public override string Destination => To;

        public override double ExpiresUt => double.PositiveInfinity;
    }

    /// <summary>
    /// One sample's bytes as a craft's history holds it, shared by every span
    /// that carries it: a sample sent to two command centres is one payload and
    /// two entries, never two copies.
    /// </summary>
    public sealed class SpanPayload
    {
        /// <summary>The sample in whatever form its holder packed it to, opaque to the network.</summary>
        public object? Held { get; set; }

        /// <summary>What holding it costs, in the holder's budget units.</summary>
        public long Bytes { get; set; }

        /// <summary>What sending it costs against a release's allowance.</summary>
        public long ReleaseCost { get; set; }

        /// <summary>How many spans still carry it; the holder frees the payload when this reaches zero.</summary>
        public int Carriers { get; set; }
    }

    /// <summary>One sample of a span: the instant it describes and its payload.</summary>
    public readonly struct SpanSample
    {
        public SpanSample(double ut, SpanPayload payload)
        {
            Ut = ut;
            Payload = payload;
        }

        public double Ut { get; }

        public SpanPayload Payload { get; }
    }

    /// <summary>
    /// A stretch of one craft's history of one topic on its way to one command
    /// centre, oldest sample first. It travels, waits at relays and is received
    /// like any other message; unlike a command it has no lifetime and no lane,
    /// since each sample carries the instant it describes and the receiver puts
    /// it in order itself.
    /// </summary>
    public sealed class SpanMessage : DeliveryMessage
    {
        /// <summary>The node whose history this is.</summary>
        public string Craft { get; set; } = "";

        /// <summary>The command centre it is going to.</summary>
        public string Centre { get; set; } = "";

        /// <summary>The topic the samples belong to.</summary>
        public string Topic { get; set; } = "";

        /// <summary>The samples, oldest first.</summary>
        public List<SpanSample> Samples { get; set; } = new List<SpanSample>();

        /// <summary>Whether samples older than the first were dropped to stay in the hold store's budget, so the first sample delivered must state the hole before it.</summary>
        public bool StartsAfterAHole { get; set; }

        public override string Destination => Centre;

        public override double ExpiresUt => double.PositiveInfinity;
    }

    /// <summary>A sample a span lost to the hold store's budget, so its holder can state the hole.</summary>
    public readonly struct SpanShed
    {
        public SpanShed(string craft, string centre, string topic, double ut, SpanPayload payload)
        {
            Craft = craft;
            Centre = centre;
            Topic = topic;
            Ut = ut;
            Payload = payload;
        }

        public string Craft { get; }

        public string Centre { get; }

        public string Topic { get; }

        /// <summary>The instant the dropped sample described.</summary>
        public double Ut { get; }

        public SpanPayload Payload { get; }
    }
}
