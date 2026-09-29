using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;

namespace Sitrep.Host.Commcast
{
    /// <summary>
    /// Commcast on the mod: groups of command centres sharing one thread, and the
    /// text, acknowledgements and live radio said to them.
    ///
    /// <para>Everything is said by one centre to others. It goes up as an instant
    /// command and comes down addressed (<see cref="IAddressedStreamHost"/>), so
    /// each listener receives it one light-time after it was said from where it
    /// was said, and a centre that is not addressed receives nothing at all.</para>
    ///
    /// <para>A speaker addresses the members IT can see. Membership is an add-only
    /// timeline of changes, and a change counts at a vantage once it has crossed
    /// there from its author. So a centre brought in far away starts hearing a
    /// transmission already under way from the first batch its speaker spoke
    /// after word of the change reached it.</para>
    ///
    /// <para>Radio is also LISTED, on <c>commcast.transmissions</c>, at every centre
    /// the speaker's signal reaches, member or not: addressing is who hears the
    /// audio, not a secret. Listing is detection only; a group is joined by
    /// invitation, never by a centre adding itself.</para>
    /// </summary>
    public sealed class CommcastUplink : ISitrepUplink
    {
        public const string UplinkId = "commcast";
        public const string TrafficTopic = "commcast.traffic";
        public const string RadioTopic = "commcast.radio";
        public const string TransmissionsTopic = "commcast.transmissions";
        public const string OpenCommand = "commcast.group.open";
        public const string AddCommand = "commcast.group.add";
        public const string SendCommand = "commcast.message.send";
        public const string AckCommand = "commcast.message.ack";
        public const string TransmitCommand = "commcast.radio.transmit";

        /// <summary>
        /// Audio chunks accepted per second, across every talker. One talker on
        /// the 20 ms grid is 50; five times that fails a stuck key or a client
        /// sending unbatched rather than a busy net.
        /// </summary>
        private static readonly PerfBudget RadioChunksBudget = new PerfBudget(
            "Commcast radio chunks in/sec", threshold: 250, windowSec: 1.0, unit: "chunks");

        /// <summary>Messages, acknowledgements and membership changes accepted per second.</summary>
        private static readonly PerfBudget TrafficBudget = new PerfBudget(
            "Commcast traffic items in/sec", threshold: 50, windowSec: 1.0, unit: "items");

        /// <summary>A batch longer than a second is a client that stopped batching to the grid.</summary>
        private const int MaxChunksPerBatch = 50;

        private const int MaxMembers = 64;

        /// <summary>How many sent messages are remembered for acknowledging.</summary>
        private const int MessageMemory = 4096;

        /// <summary>How many keyings are remembered at once; the oldest is forgotten first.</summary>
        private const int TransmissionMemory = 256;

        /// <summary>
        /// Game seconds between discovery rows for one keying, so a connection that
        /// subscribes partway through learns of it within this long.
        /// </summary>
        private const double RowIntervalUt = 1.0;

        private sealed class MembershipChange
        {
            public double Ut;
            public string Author = "";
            public Sitrep.Core.DelayStamp Stamp = null!;
            public HashSet<string> Reached = null!;
            public List<string> Added = null!;
        }

        private sealed class SentMessage
        {
            public string Author = "";
            public HashSet<string> To = null!;
        }

        private sealed class Transmission
        {
            public string From = "";
            public string GroupId = "";
            public double StartedUt;
            public double LastRowUt = double.NegativeInfinity;
            public bool Ended;
        }

        private readonly Dictionary<string, List<MembershipChange>> _groups =
            new Dictionary<string, List<MembershipChange>>(StringComparer.Ordinal);

        private readonly Dictionary<string, SentMessage> _messages =
            new Dictionary<string, SentMessage>(StringComparer.Ordinal);
        private readonly Queue<string> _messageOrder = new Queue<string>();

        private readonly Dictionary<string, Transmission> _transmissions =
            new Dictionary<string, Transmission>(StringComparer.Ordinal);
        private readonly Queue<string> _transmissionOrder = new Queue<string>();

        private IUplinkHost? _host;
        private IAddressedStreamHost? _streams;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = UplinkId,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = TrafficTopic,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.Delayed,
                    Recordable = false,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = TransmissionsTopic,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.Delayed,
                    Recordable = false,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = RadioTopic,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.Delayed,
                    Recordable = false,
                    OpaquePayload = true,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
            },
            Commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = OpenCommand },
                new CommandDeclaration { Command = AddCommand },
                new CommandDeclaration { Command = SendCommand },
                new CommandDeclaration { Command = AckCommand },
                new CommandDeclaration { Command = TransmitCommand },
            },
        };

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _host = host;
            _streams = host as IAddressedStreamHost
                ?? throw new InvalidOperationException("commcast needs a host that carries addressed streams");
            _streams.DeclareAddressedTopic(TrafficTopic);
            _streams.DeclareAddressedTopic(RadioTopic);
            _streams.DeclareAddressedTopic(TransmissionsTopic);

            host.AddVantageCommandHandler<CommcastGroupOpenArgs, CommandResult>(OpenCommand, HandleOpen);
            host.AddVantageCommandHandler<CommcastGroupAddArgs, CommandResult>(AddCommand, HandleAdd);
            host.AddVantageCommandHandler<CommcastMessageSendArgs, CommandResult>(SendCommand, HandleSend);
            host.AddVantageCommandHandler<CommcastMessageAckArgs, CommandResult>(AckCommand, HandleAck);
            host.AddVantageCommandHandler<CommcastRadioTransmitArgs, CommandResult>(TransmitCommand, HandleTransmit);
        }

        private double Now() => _host!.NowUt();

        /// <summary>A speaker must be standing somewhere: the delay exemption is not a place anything can be said from.</summary>
        private static CommandResult? RefuseNowhere(string from) =>
            string.IsNullOrEmpty(from) || from == ChannelEngine.MetaVantage
                ? CommandResult.Fail(CommandErrorCode.WrongState, "only a command centre can speak")
                : null;

        private CommandResult HandleOpen(CommcastGroupOpenArgs? args, string from)
        {
            var nowhere = RefuseNowhere(from);
            if (nowhere != null)
            {
                return nowhere;
            }
            if (args == null || string.IsNullOrEmpty(args.GroupId))
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a group needs the client's own id");
            }
            if (_groups.ContainsKey(args.GroupId))
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "a group already holds that id");
            }
            var members = Distinct(args.Members.Append(from));
            if (members.Count > MaxMembers)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a group holds at most " + MaxMembers + " centres");
            }

            var now = Now();
            var change = Change(now, from, members, members);
            _groups[args.GroupId] = new List<MembershipChange> { change };
            PublishMembers(args.GroupId, from, args.Author, now, change, members);
            return CommandResult.Ok();
        }

        private CommandResult HandleAdd(CommcastGroupAddArgs? args, string from)
        {
            var nowhere = RefuseNowhere(from);
            if (nowhere != null)
            {
                return nowhere;
            }
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "no group was named");
            }
            var now = Now();
            var refusal = RefuseNonMember(args.GroupId, from, now, out var known);
            if (refusal != null)
            {
                return refusal;
            }
            var added = Distinct(args.Added.Where(id => !known.Contains(id)));
            if (added.Count == 0)
            {
                return CommandResult.Ok();
            }
            var members = Distinct(known.Concat(added));
            if (members.Count > MaxMembers)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a group holds at most " + MaxMembers + " centres");
            }

            var change = Change(now, from, members, added);
            _groups[args.GroupId].Add(change);
            PublishMembers(args.GroupId, from, args.Author, now, change, members);
            return CommandResult.Ok();
        }

        private CommandResult HandleSend(CommcastMessageSendArgs? args, string from)
        {
            var nowhere = RefuseNowhere(from);
            if (nowhere != null)
            {
                return nowhere;
            }
            if (args == null || string.IsNullOrEmpty(args.Id))
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a message needs the client's own id");
            }
            var now = Now();
            var refusal = RefuseNonMember(args.GroupId, from, now, out var known);
            if (refusal != null)
            {
                return refusal;
            }

            var to = Addressed(from, known);
            Remember(args.Id, new SentMessage { Author = from, To = new HashSet<string>(to, StringComparer.Ordinal) });
            PublishTraffic(new CommcastTraffic
            {
                Kind = "text",
                Id = args.Id,
                GroupId = args.GroupId,
                From = from,
                Author = args.Author,
                SentUt = now,
                To = to,
                Body = args.Body,
            });
            return CommandResult.Ok();
        }

        private CommandResult HandleAck(CommcastMessageAckArgs? args, string from)
        {
            var nowhere = RefuseNowhere(from);
            if (nowhere != null)
            {
                return nowhere;
            }
            if (args == null || !_messages.TryGetValue(args.MessageId, out var message))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "no message with that id is on record");
            }
            if (!message.To.Contains(from))
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "that message was not addressed here");
            }

            var now = Now();
            var to = _streams!.HasRoute(from, message.Author) ? new List<string> { message.Author } : new List<string>();
            PublishTraffic(new CommcastTraffic
            {
                Kind = "ack",
                From = from,
                Author = args.Author,
                SentUt = now,
                To = to,
                MessageId = args.MessageId,
            });
            return CommandResult.Ok();
        }

        private CommandResult HandleTransmit(CommcastRadioTransmitArgs? args, string from)
        {
            var nowhere = RefuseNowhere(from);
            if (nowhere != null)
            {
                return nowhere;
            }
            if (args == null || string.IsNullOrEmpty(args.TransmissionId))
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a transmission needs the client's own id");
            }
            if (args.Chunks.Count > MaxChunksPerBatch)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "a batch carries at most " + MaxChunksPerBatch + " chunks");
            }
            var now = Now();
            var refusal = RefuseNonMember(args.GroupId, from, now, out var known);
            if (refusal != null)
            {
                return refusal;
            }

            var segments = new List<byte[]>(args.Chunks.Count + 1);
            segments.Add(Array.Empty<byte>());
            foreach (var chunk in args.Chunks)
            {
                try
                {
                    segments.Add(Convert.FromBase64String(chunk));
                }
                catch (FormatException)
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "a chunk is not base64");
                }
            }

            if (!_transmissions.TryGetValue(args.TransmissionId, out var transmission))
            {
                transmission = new Transmission { From = from, GroupId = args.GroupId, StartedUt = now };
                _transmissions[args.TransmissionId] = transmission;
                _transmissionOrder.Enqueue(args.TransmissionId);
                while (_transmissionOrder.Count > TransmissionMemory)
                {
                    _transmissions.Remove(_transmissionOrder.Dequeue());
                }
            }
            if (transmission.From != from || transmission.GroupId != args.GroupId)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "that transmission belongs to another speaker or group");
            }

            var to = Addressed(from, known);
            segments[0] = Encoding.UTF8.GetBytes(Json(ToWire(new CommcastRadioBatch
            {
                TransmissionId = args.TransmissionId,
                GroupId = args.GroupId,
                From = from,
                Author = args.Author,
                StartedUt = transmission.StartedUt,
                Seq = args.Seq,
                End = args.End,
                To = to,
            })));
            RadioChunksBudget.Record(args.Chunks.Count, now);
            _streams!.PublishAddressed(RadioTopic, segments, now, from, to);
            PublishRow(args.TransmissionId, transmission, args.Author, to, args.End, now);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Tell every centre the speaker reaches that a keying is under way: when it
        /// begins, at most once a <see cref="RowIntervalUt"/> while it lasts, and when
        /// it ends. Each row crosses from the speaker as the audio does, so the two
        /// agree about when the transmission began at any vantage.
        /// </summary>
        private void PublishRow(
            string transmissionId, Transmission transmission, CommcastAuthor author, List<string> to, bool end, double now)
        {
            if (!end && now - transmission.LastRowUt < RowIntervalUt)
            {
                return;
            }
            transmission.LastRowUt = now;
            transmission.Ended = end;
            _streams!.PublishAddressed(TransmissionsTopic, ToWire(new CommcastTransmissionRow
            {
                Phase = end ? "ended" : "open",
                TransmissionId = transmissionId,
                GroupId = transmission.GroupId,
                From = transmission.From,
                Author = author,
                StartedUt = transmission.StartedUt,
                To = to,
                Topic = RadioTopic,
            }), now, transmission.From, _streams.ReachedFrom(transmission.From));
        }

        /// <summary>
        /// A refusal unless <paramref name="speaker"/> belongs to the group as its
        /// own vantage knows it at <paramref name="now"/>; otherwise null, with
        /// <paramref name="known"/> set to that membership.
        /// </summary>
        private CommandResult? RefuseNonMember(string groupId, string speaker, double now, out List<string> known)
        {
            known = new List<string>();
            if (string.IsNullOrEmpty(groupId) || !_groups.TryGetValue(groupId, out var changes))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "no group with that id is known");
            }
            known = MembersKnownAt(changes, speaker, now);
            return known.Contains(speaker)
                ? null
                : CommandResult.Fail(CommandErrorCode.WrongState, "this centre is not a member of that group as far as it knows");
        }

        /// <summary>The group's members as <paramref name="vantage"/> knows them at <paramref name="ut"/>.</summary>
        private static List<string> MembersKnownAt(List<MembershipChange> changes, string vantage, double ut)
        {
            var members = new List<string>();
            foreach (var change in changes)
            {
                if (change.Author != vantage
                    && !(change.Reached.Contains(vantage) && change.Ut + change.Stamp.For(vantage) <= ut))
                {
                    continue;
                }
                foreach (var id in change.Added)
                {
                    if (!members.Contains(id))
                    {
                        members.Add(id);
                    }
                }
            }
            return members;
        }

        /// <summary>The speaker, and every member it knows of that a signal from it can reach.</summary>
        private List<string> Addressed(string speaker, IEnumerable<string> members)
        {
            var to = new List<string> { speaker };
            foreach (var member in members)
            {
                if (member != speaker && _streams!.HasRoute(speaker, member))
                {
                    to.Add(member);
                }
            }
            to.Sort(StringComparer.Ordinal);
            return to;
        }

        private MembershipChange Change(double now, string author, List<string> members, List<string> added) =>
            new MembershipChange
            {
                Ut = now,
                Author = author,
                Stamp = _streams!.StampFrom(author),
                Reached = new HashSet<string>(Addressed(author, members), StringComparer.Ordinal),
                Added = added,
            };

        private void PublishMembers(
            string groupId, string from, CommcastAuthor author, double now, MembershipChange change, List<string> members)
        {
            var to = change.Reached.OrderBy(id => id, StringComparer.Ordinal).ToList();
            PublishTraffic(new CommcastTraffic
            {
                Kind = "members",
                Id = groupId + "@" + now.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
                GroupId = groupId,
                From = from,
                Author = author,
                SentUt = now,
                To = to,
                Members = members.OrderBy(id => id, StringComparer.Ordinal).ToList(),
                Added = change.Added.OrderBy(id => id, StringComparer.Ordinal).ToList(),
            });
        }

        private void PublishTraffic(CommcastTraffic item)
        {
            TrafficBudget.Record(1, item.SentUt);
            _streams!.PublishAddressed(TrafficTopic, ToWire(item), item.SentUt, item.From, item.To);
        }

        private void Remember(string id, SentMessage message)
        {
            if (!_messages.ContainsKey(id))
            {
                _messageOrder.Enqueue(id);
            }
            _messages[id] = message;
            while (_messageOrder.Count > MessageMemory)
            {
                _messages.Remove(_messageOrder.Dequeue());
            }
        }

        private static List<string> Distinct(IEnumerable<string> ids) =>
            ids.Where(id => !string.IsNullOrEmpty(id)).Distinct(StringComparer.Ordinal).ToList();

        private static string Json(object? value)
        {
            var sb = new StringBuilder();
            JsonWriter.AppendValue(sb, value);
            return sb.ToString();
        }

        private static Dictionary<string, object?> ToWire(CommcastAuthor? author) => new Dictionary<string, object?>
        {
            ["name"] = author?.Name ?? "",
            ["stationKey"] = author?.StationKey ?? "",
            ["seat"] = author?.Seat ?? "",
        };

        private static Dictionary<string, object?> ToWire(CommcastTraffic item)
        {
            var wire = new Dictionary<string, object?>
            {
                ["kind"] = item.Kind,
                ["groupId"] = item.GroupId,
                ["from"] = item.From,
                ["author"] = ToWire(item.Author),
                ["sentUt"] = item.SentUt,
                ["to"] = item.To,
            };
            if (item.Id != null)
            {
                wire["id"] = item.Id;
            }
            if (item.Members != null)
            {
                wire["members"] = item.Members;
            }
            if (item.Added != null)
            {
                wire["added"] = item.Added;
            }
            if (item.Body != null)
            {
                wire["body"] = item.Body;
            }
            if (item.MessageId != null)
            {
                wire["messageId"] = item.MessageId;
            }
            return wire;
        }

        private static Dictionary<string, object?> ToWire(CommcastTransmissionRow row) => new Dictionary<string, object?>
        {
            ["phase"] = row.Phase,
            ["transmissionId"] = row.TransmissionId,
            ["groupId"] = row.GroupId,
            ["from"] = row.From,
            ["author"] = ToWire(row.Author),
            ["startedUt"] = row.StartedUt,
            ["to"] = row.To,
            ["topic"] = row.Topic,
        };

        private static Dictionary<string, object?> ToWire(CommcastRadioBatch batch) => new Dictionary<string, object?>
        {
            ["transmissionId"] = batch.TransmissionId,
            ["groupId"] = batch.GroupId,
            ["from"] = batch.From,
            ["author"] = ToWire(batch.Author),
            ["startedUt"] = batch.StartedUt,
            ["seq"] = batch.Seq,
            ["end"] = batch.End,
            ["to"] = batch.To,
        };
    }
}
