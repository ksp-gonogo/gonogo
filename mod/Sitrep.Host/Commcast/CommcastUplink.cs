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
    /// each listener receives it one signal delay after it was said from where it
    /// was said, and a centre that is not addressed receives nothing at all.</para>
    ///
    /// <para>A speaker addresses the members it can see. Membership is an add-only
    /// timeline of changes, and a change counts at a vantage once it has crossed
    /// there from its author. So a centre brought in far away starts hearing a
    /// transmission already under way from the first batch its speaker spoke
    /// after word of the change reached it.</para>
    ///
    /// <para>Radio is also listed, on <c>commcast.transmissions</c>, at every centre
    /// the speaker's signal reaches, member or not: addressing is who hears the
    /// audio, not a secret. Listing is detection only; a group is joined by
    /// invitation, never by a centre adding itself.</para>
    /// </summary>
    public sealed class CommcastUplink : ISitrepUplink
    {
        public const string UplinkId = "commcast";
        public const string LedgerTopic = "commcast.ledger";
        public const string RadioTopic = "commcast.radio";
        public const string TransmissionsTopic = "commcast.transmissions";
        public const string OpenCommand = "commcast.group.open";
        public const string AddCommand = "commcast.group.add";
        public const string SendCommand = "commcast.message.send";
        public const string AckCommand = "commcast.message.ack";
        public const string TransmitCommand = "commcast.radio.transmit";

        /// <summary>The host's own commands between two centres: a message reaching its recipient, and a recipient telling the sender it was read. Not commands a client can send.</summary>
        internal const string DeliverLaneId = "commcast.deliver";
        internal const string ReadLaneId = "commcast.read";

        /// <summary>How long a message waits for a path before it is deleted wherever it is: one game day, at the stock calendar's length.</summary>
        public const double MessageLifetimeSeconds = Sitrep.Core.GameDayDefaults.StockDaySeconds;

        /// <summary>
        /// Audio chunks accepted per second, across every talker. One talker on
        /// the 20 ms grid is 50; five times that fails a stuck key or a client
        /// sending unbatched rather than a busy net.
        /// </summary>
        private static readonly PerfBudget RadioChunksBudget = new PerfBudget(
            "Commcast radio chunks in/sec", threshold: 250, windowSec: 1.0, unit: "chunks");

        /// <summary>
        /// Messages and membership changes accepted per second, across every
        /// speaker. A message to a whole group is one, however many it is
        /// addressed to, so fifty in a second is a screen that has run away
        /// and not a busy net.
        /// </summary>
        internal static readonly PerfBudget SaidBudget = new PerfBudget(
            "Commcast messages and membership changes in/sec", threshold: 50, windowSec: 1.0, unit: "items");

        /// <summary>
        /// Acknowledgements accepted per second. Every screen at every centre
        /// a message reached acknowledges it when it is released there, each
        /// with a command of its own, and members at like distances do so
        /// together. A full group of 64 answering in one second with two
        /// screens at every centre is 126; this covers that and no more.
        /// </summary>
        internal static readonly PerfBudget AcknowledgedBudget = new PerfBudget(
            "Commcast acknowledgements in/sec", threshold: 150, windowSec: 1.0, unit: "acknowledgements");

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

            /// <summary>Everyone in the group as its author knew it when this was said, which is what it told everyone it reached.</summary>
            public List<string> Members = null!;

            /// <summary>How the author described itself.</summary>
            public CommcastAuthor Said = new CommcastAuthor();

            /// <summary>When word of this change reached a centre it had no path to when it was said, by a letter kept for it.</summary>
            public Dictionary<string, double> LetterArrival = new Dictionary<string, double>(StringComparer.Ordinal);
        }

        /// <summary>One entry of a centre's ledger of messages: what it said and what reached it.</summary>
        private sealed class LedgerEntry
        {
            public string Id = "";
            public double SentUt;

            /// <summary>When it reached this centre; null for something this centre said itself.</summary>
            public double? ArrivedUt;

            /// <summary>The entry as its fixed fields go on the wire.</summary>
            public Dictionary<string, object?> Wire = null!;

            /// <summary>Per recipient, when the message ran at that centre and the reply reached here. Only on a message this centre said.</summary>
            public Dictionary<string, double> Delivered = new Dictionary<string, double>(StringComparer.Ordinal);

            /// <summary>Per recipient, how a message that never ran there ended: "cancelled" or "expired".</summary>
            public Dictionary<string, string> Ended = new Dictionary<string, string>(StringComparer.Ordinal);

            /// <summary>Per recipient, when a screen there read it.</summary>
            public Dictionary<string, ReadRecord> Read = new Dictionary<string, ReadRecord>(StringComparer.Ordinal);
        }

        private sealed class ReadRecord
        {
            public double Ut;
            public string StationKey = "";
            public string Seat = "";
        }

        /// <summary>The most entries one centre's ledger keeps.</summary>
        private const int LedgerMemory = 300;

        private readonly object _gate = new object();

        private readonly Dictionary<string, List<LedgerEntry>> _ledger =
            new Dictionary<string, List<LedgerEntry>>(StringComparer.Ordinal);

        private sealed class SentMessage
        {
            public string Author = "";
            public HashSet<string> To = null!;
            public double Ut;
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

        private Sitrep.Host.Comms.ICraftStateHost? _craftState;
        private IUplinkHost? _host;
        private IAddressedStreamHost? _streams;
        private ILaneHost? _lanes;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = UplinkId,
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Requires = Requirement.None,
                    Topic = LedgerTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Recordable = false,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Kind = SampleKind.Event,
                    Requires = Requirement.None,
                    Topic = TransmissionsTopic,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.Delayed,
                    Recordable = false,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Kind = SampleKind.Event,
                    Requires = Requirement.None,
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
            _streams.DeclareAddressedTopic(LedgerTopic);
            _streams.DeclareAddressedTopic(RadioTopic);
            _streams.DeclareAddressedTopic(TransmissionsTopic);

            /* A centre's ledger is state, and an addressed sample is not kept for
               whoever subscribes after it landed, so a screen that has just sat
               down is told its centre's ledger again. */
            _streams.OnAddressedSubscribed(LedgerTopic, centre =>
            {
                lock (_gate)
                {
                    PublishLedger(centre);
                }
            });

            /* A message is a command between two centres: it travels a lane, waits
               for a path, shows in the sender's uplink queue and can be cancelled
               there, and what it does on arrival is write the recipient's ledger. */
            _lanes = host as ILaneHost;
            if (_lanes != null)
            {
                _lanes.RegisterLaneHandler(DeliverLaneId, OnDelivered);
                _lanes.RegisterLaneHandler(ReadLaneId, OnRead);
                _lanes.RegisterLaneOutcome(DeliverLaneId, OnDeliverEnded);
                _lanes.RegisterSaveSection(SaveSectionName, SaveSection, RestoreSection);
            }

            /* Groups, messages and keyings are stamped with the UT they were said
               at, so a reset keeps what was said up to the loaded UT and drops
               what was said after it. */
            _craftState = host as Sitrep.Host.Comms.ICraftStateHost;
            _craftState?.OnTimelineReset(ForgetTheTimeline);

            host.AddVantageCommandHandler<CommcastGroupOpenArgs, CommandResult>(OpenCommand, (a, from) => { lock (_gate) { return HandleOpen(a, from); } });
            host.AddVantageCommandHandler<CommcastGroupAddArgs, CommandResult>(AddCommand, (a, from) => { lock (_gate) { return HandleAdd(a, from); } });
            host.AddVantageCommandHandler<CommcastMessageSendArgs, CommandResult>(SendCommand, (a, from) => { lock (_gate) { return HandleSend(a, from); } });
            host.AddVantageCommandHandler<CommcastMessageAckArgs, CommandResult>(AckCommand, (a, from) => { lock (_gate) { return HandleAck(a, from); } });
            host.AddVantageCommandHandler<CommcastRadioTransmitArgs, CommandResult>(TransmitCommand, (a, from) => { lock (_gate) { return HandleTransmit(a, from); } });
        }

        private const string SaveSectionName = "commcast";

        /// <summary>Everything kept with the game: the groups, what each centre was sent, and who may acknowledge what. Any thread.</summary>
        private string? SaveSection()
        {
            lock (_gate)
            {
                if (_groups.Count == 0 && _messages.Count == 0 && _ledger.Count == 0)
                {
                    return null;
                }
                var groups = _groups.Select(g => (object?)new Dictionary<string, object?>
                {
                    ["id"] = g.Key,
                    ["changes"] = g.Value.Select(c => (object?)new Dictionary<string, object?>
                    {
                        ["ut"] = c.Ut,
                        ["author"] = c.Author,
                        ["said"] = ToWire(c.Said),
                        ["reached"] = c.Reached.OrderBy(id => id, StringComparer.Ordinal).Cast<object?>().ToList(),
                        ["added"] = c.Added.Cast<object?>().ToList(),
                        ["members"] = c.Members.Cast<object?>().ToList(),
                        ["stamp"] = c.Reached.ToDictionary(id => id, id => (object?)c.Stamp.For(id), StringComparer.Ordinal),
                        ["letterArrival"] = c.LetterArrival.ToDictionary(a => a.Key, a => (object?)a.Value, StringComparer.Ordinal),
                    }).ToList(),
                }).ToList();
                var messages = _messageOrder.Where(_messages.ContainsKey).Select(id => (object?)new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["author"] = _messages[id].Author,
                    ["to"] = _messages[id].To.OrderBy(t => t, StringComparer.Ordinal).Cast<object?>().ToList(),
                    ["ut"] = _messages[id].Ut,
                }).ToList();
                var ledger = _ledger.ToDictionary(
                    l => l.Key,
                    l => (object?)l.Value.Select(e => (object?)new Dictionary<string, object?>
                    {
                        ["id"] = e.Id,
                        ["sentUt"] = e.SentUt,
                        ["arrivedUt"] = e.ArrivedUt,
                        ["wire"] = e.Wire,
                        ["delivered"] = e.Delivered.ToDictionary(d => d.Key, d => (object?)d.Value, StringComparer.Ordinal),
                        ["ended"] = e.Ended.ToDictionary(d => d.Key, d => (object?)d.Value, StringComparer.Ordinal),
                        ["read"] = e.Read.ToDictionary(
                            r => r.Key,
                            r => (object?)new Dictionary<string, object?> { ["ut"] = r.Value.Ut, ["stationKey"] = r.Value.StationKey, ["seat"] = r.Value.Seat },
                            StringComparer.Ordinal),
                    }).ToList(),
                    StringComparer.Ordinal);
                return Json(new Dictionary<string, object?>
                {
                    ["version"] = 1.0,
                    ["groups"] = groups,
                    ["messages"] = messages,
                    ["ledger"] = ledger,
                });
            }
        }

        /// <summary>Takes back what a loaded save kept, replacing what is held. A string this build cannot read, or none, leaves what is held. Courier thread.</summary>
        private void RestoreSection(string? kept)
        {
            if (kept == null || !(JsonReader.Parse(kept) is Dictionary<string, object?> root))
            {
                return;
            }
            lock (_gate)
            {
                _groups.Clear();
                _messages.Clear();
                _messageOrder.Clear();
                _ledger.Clear();
                foreach (var group in List(root, "groups").OfType<Dictionary<string, object?>>())
                {
                    var changes = new List<MembershipChange>();
                    foreach (var c in List(group, "changes").OfType<Dictionary<string, object?>>())
                    {
                        var stamp = Map(c, "stamp");
                        var said = Map(c, "said");
                        changes.Add(new MembershipChange
                        {
                            Ut = Num(c, "ut"),
                            Author = Str(c, "author"),
                            Said = new CommcastAuthor
                            {
                                Name = Str(said, "name"),
                                StationKey = Str(said, "stationKey"),
                                Seat = Str(said, "seat"),
                            },
                            Reached = new HashSet<string>(List(c, "reached").OfType<string>(), StringComparer.Ordinal),
                            Added = List(c, "added").OfType<string>().ToList(),
                            Members = List(c, "members").OfType<string>().ToList(),
                            Stamp = new Sitrep.Core.DelayStamp(
                                double.PositiveInfinity,
                                stamp.Where(e => e.Value is double).ToDictionary(e => e.Key, e => (double)e.Value!, StringComparer.Ordinal)),
                            LetterArrival = Map(c, "letterArrival").Where(e => e.Value is double).ToDictionary(e => e.Key, e => (double)e.Value!, StringComparer.Ordinal),
                        });
                    }
                    _groups[Str(group, "id")] = changes;
                }
                foreach (var m in List(root, "messages").OfType<Dictionary<string, object?>>())
                {
                    var id = Str(m, "id");
                    _messages[id] = new SentMessage
                    {
                        Author = Str(m, "author"),
                        To = new HashSet<string>(List(m, "to").OfType<string>(), StringComparer.Ordinal),
                        Ut = Num(m, "ut"),
                    };
                    _messageOrder.Enqueue(id);
                }
                foreach (var centre in Map(root, "ledger"))
                {
                    var entries = new List<LedgerEntry>();
                    foreach (var i in (centre.Value as List<object?> ?? new List<object?>()).OfType<Dictionary<string, object?>>())
                    {
                        if (!(i.TryGetValue("wire", out var wire) && wire is Dictionary<string, object?> body))
                        {
                            continue;
                        }
                        var entry = new LedgerEntry
                        {
                            Id = Str(i, "id"),
                            SentUt = Num(i, "sentUt"),
                            ArrivedUt = i.TryGetValue("arrivedUt", out var arrived) && arrived is double at ? at : (double?)null,
                            Wire = body,
                        };
                        foreach (var d in Map(i, "delivered"))
                        {
                            if (d.Value is double ut)
                            {
                                entry.Delivered[d.Key] = ut;
                            }
                        }
                        foreach (var d in Map(i, "ended"))
                        {
                            if (d.Value is string how)
                            {
                                entry.Ended[d.Key] = how;
                            }
                        }
                        foreach (var r in Map(i, "read"))
                        {
                            if (r.Value is Dictionary<string, object?> read)
                            {
                                entry.Read[r.Key] = new ReadRecord { Ut = Num(read, "ut"), StationKey = Str(read, "stationKey"), Seat = Str(read, "seat") };
                            }
                        }
                        entries.Add(entry);
                    }
                    _ledger[centre.Key] = entries;
                }
            }
        }

        private static List<object?> List(Dictionary<string, object?>? o, string key) =>
            o != null && o.TryGetValue(key, out var v) && v is List<object?> list ? list : new List<object?>();

        private static Dictionary<string, object?> Map(Dictionary<string, object?>? o, string key) =>
            o != null && o.TryGetValue(key, out var v) && v is Dictionary<string, object?> map ? map : new Dictionary<string, object?>();

        private static string Str(Dictionary<string, object?>? o, string key) =>
            o != null && o.TryGetValue(key, out var v) && v is string text ? text : "";

        private static double Num(Dictionary<string, object?>? o, string key) =>
            o != null && o.TryGetValue(key, out var v) && v is double d ? d : 0.0;

        private void ForgetTheTimeline()
        {
            lock (_gate)
            {
                ForgetTheTimelineLocked();
            }
        }

        private void ForgetTheTimelineLocked()
        {
            /* Another save folder is another game, whose chat is not this one's. */
            var loadedAt = _craftState?.TimelineResetChangedSave == true ? double.NegativeInfinity : Now();
            foreach (var centre in _ledger.Keys.ToList())
            {
                _ledger[centre].RemoveAll(entry => entry.SentUt > loadedAt);
                foreach (var entry in _ledger[centre])
                {
                    foreach (var late in entry.Delivered.Where(d => d.Value > loadedAt).Select(d => d.Key).ToList())
                    {
                        entry.Delivered.Remove(late);
                    }
                    foreach (var late in entry.Read.Where(r => r.Value.Ut > loadedAt).Select(r => r.Key).ToList())
                    {
                        entry.Read.Remove(late);
                    }
                }
                if (_ledger[centre].Count == 0)
                {
                    _ledger.Remove(centre);
                }
            }
            foreach (var changes in _groups.Values)
            {
                foreach (var change in changes)
                {
                    foreach (var arrived in change.LetterArrival.Where(a => a.Value > loadedAt).Select(a => a.Key).ToList())
                    {
                        change.LetterArrival.Remove(arrived);
                    }
                }
            }
            foreach (var id in _groups.Keys.ToList())
            {
                _groups[id].RemoveAll(change => change.Ut > loadedAt);
                if (_groups[id].Count == 0)
                {
                    _groups.Remove(id);
                }
            }
            foreach (var id in _messages.Where(m => m.Value.Ut > loadedAt).Select(m => m.Key).ToList())
            {
                _messages.Remove(id);
            }
            KeepOnly(_messageOrder, _messages.ContainsKey);
            foreach (var id in _transmissions.Where(t => t.Value.StartedUt > loadedAt).Select(t => t.Key).ToList())
            {
                _transmissions.Remove(id);
            }
            KeepOnly(_transmissionOrder, _transmissions.ContainsKey);
        }

        private static void KeepOnly(Queue<string> order, Func<string, bool> kept)
        {
            var survivors = order.Where(kept).ToList();
            order.Clear();
            foreach (var id in survivors)
            {
                order.Enqueue(id);
            }
        }

        private double Now() => _host!.NowUt();

        /// <summary>A speaker must be standing somewhere: the delay exemption is not a place anything can be said from.</summary>
        private static CommandResult? RefuseNowhere(string from) =>
            string.IsNullOrEmpty(from) || from == ChannelEngine.MetaVantage
                ? CommandResult.Fail(CommandErrorCode.WrongState, "this screen isn't at a command centre or on a craft")
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
            var change = Change(now, from, args.Author, members, members);
            _groups[args.GroupId] = new List<MembershipChange> { change };
            SendMembers(args.GroupId, change, members, from);
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

            var change = Change(now, from, args.Author, members, added);
            _groups[args.GroupId].Add(change);
            SendMembers(args.GroupId, change, members, from);
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

            var named = Distinct(args.To);
            foreach (var id in named)
            {
                if (!known.Contains(id))
                {
                    return CommandResult.Fail(CommandErrorCode.WrongState, "'" + id + "' is not a member of that group as far as this centre knows");
                }
            }
            var meant = named.Count == 0 ? known : named;
            var reached = Addressed(from, meant);
            var waiting = meant.Where(id => id != from && !reached.Contains(id)).OrderBy(id => id, StringComparer.Ordinal).ToList();
            var everyone = Distinct(meant.Append(from)).OrderBy(id => id, StringComparer.Ordinal).ToList();
            Remember(args.Id, from, everyone, now);
            var wire = new Dictionary<string, object?>
            {
                ["kind"] = "text",
                ["id"] = args.Id,
                ["groupId"] = args.GroupId,
                ["from"] = from,
                ["author"] = ToWire(args.Author),
                ["sentUt"] = now,
                ["to"] = everyone,
                ["body"] = args.Body ?? "",
            };
            SendEntry(from, wire, now, everyone, args.Body ?? "");
            return CommandResult<CommcastSendReceipt>.Ok(new CommcastSendReceipt
            {
                Addressed = reached,
                Unreached = new List<string>(),
                Queued = waiting,
            });
        }

        /// <summary>
        /// Records a message in its speaker's own ledger and sends it down a lane to
        /// every other member: each copy waits for a path as any command does, runs
        /// at its recipient by writing that centre's ledger, and can be cancelled
        /// from the speaker's uplink queue.
        /// </summary>
        private void SendEntry(string speaker, Dictionary<string, object?> wire, double now, List<string> everyone, string label)
        {
            var id = (string)wire["id"]!;
            AddToLedger(speaker, new LedgerEntry { Id = id, SentUt = now, ArrivedUt = null, Wire = wire });
            PublishLedger(speaker);
            if (_lanes == null)
            {
                return;
            }
            foreach (var recipient in everyone)
            {
                if (recipient == speaker)
                {
                    continue;
                }
                var args = new Dictionary<string, object?>(wire, StringComparer.Ordinal) { ["label"] = label, ["recipient"] = recipient };
                _lanes.SendLaneCommand(speaker, recipient, DeliverLaneId, args, label, MessageLifetimeSeconds);
                SaidBudget.Record(1, now);
            }
        }

        /// <summary>A membership change is said as a message is: to every other member, down its own lane.</summary>
        private void SendMembers(string groupId, MembershipChange change, List<string> members, string speaker)
        {
            var wire = ToWire(MembersItem(groupId, change, members));
            var everyone = members.OrderBy(id => id, StringComparer.Ordinal).ToList();
            wire["to"] = everyone;
            SendEntry(speaker, wire, change.Ut, everyone, "added " + string.Join(", ", change.Added));
        }

        /// <summary>A command from another centre reached this one: its words go into this centre's ledger.</summary>
        private object? OnDelivered(LaneArrival arrival)
        {
            lock (_gate)
            {
                if (!(arrival.Args is Dictionary<string, object?> args))
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "a delivery carried nothing");
                }
                var wire = new Dictionary<string, object?>(args, StringComparer.Ordinal);
                wire.Remove("label");
                wire.Remove("recipient");
                var id = wire.TryGetValue("id", out var named) ? named as string : null;
                if (id == null)
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "a delivery named no message");
                }
                if (wire.TryGetValue("kind", out var kind) && (kind as string) == "members"
                    && wire.TryGetValue("groupId", out var group) && group is string groupId
                    && _groups.TryGetValue(groupId, out var changes))
                {
                    foreach (var change in changes)
                    {
                        if (MembersItemId(groupId, change) == id)
                        {
                            change.LetterArrival[arrival.Recipient] = arrival.AtUt;
                        }
                    }
                }
                AddToLedger(arrival.Recipient, new LedgerEntry { Id = id, SentUt = arrival.SentUt, ArrivedUt = arrival.AtUt, Wire = wire });
                PublishLedger(arrival.Recipient);
                return CommandResult.Ok();
            }
        }

        /// <summary>A message this centre sent has ended: it was delivered, or it was cancelled or ran out of time.</summary>
        private void OnDeliverEnded(LaneOutcome outcome)
        {
            lock (_gate)
            {
                var id = outcome.Args is Dictionary<string, object?> args && args.TryGetValue("id", out var named) ? named as string : null;
                var entry = id == null ? null : FindEntry(outcome.Sender, id);
                if (entry == null)
                {
                    return;
                }
                if (outcome.Kind == LaneOutcomeKind.Delivered)
                {
                    entry.Delivered[outcome.Recipient] = outcome.AtUt;
                }
                else
                {
                    entry.Ended[outcome.Recipient] = outcome.Kind == LaneOutcomeKind.Cancelled ? "cancelled" : "expired";
                }
                PublishLedger(outcome.Sender);
            }
        }

        /// <summary>A recipient's screen read a message: the sender's ledger says so once the notice reaches it.</summary>
        private object? OnRead(LaneArrival arrival)
        {
            lock (_gate)
            {
                if (!(arrival.Args is Dictionary<string, object?> args) || !(args.TryGetValue("messageId", out var named) && named is string id))
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "a read notice named no message");
                }
                var entry = FindEntry(arrival.Recipient, id);
                if (entry == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound, "no such message in this ledger");
                }
                entry.Read[arrival.Sender] = new ReadRecord
                {
                    Ut = Num(args, "readUt"),
                    StationKey = Str(args, "stationKey"),
                    Seat = Str(args, "seat"),
                };
                PublishLedger(arrival.Recipient);
                return CommandResult.Ok();
            }
        }

        private LedgerEntry? FindEntry(string centre, string id) =>
            _ledger.TryGetValue(centre, out var entries) ? entries.FirstOrDefault(e => e.Id == id) : null;

        private void AddToLedger(string centre, LedgerEntry entry)
        {
            if (!_ledger.TryGetValue(centre, out var entries))
            {
                entries = new List<LedgerEntry>();
                _ledger[centre] = entries;
            }
            if (entries.Any(e => e.Id == entry.Id))
            {
                return;
            }
            entries.Add(entry);
            if (entries.Count > LedgerMemory)
            {
                entries.RemoveRange(0, entries.Count - LedgerMemory);
            }
        }

        /// <summary>Says a centre's whole ledger to the screens at it, as the latest value of its state.</summary>
        private void PublishLedger(string centre)
        {
            if (string.IsNullOrEmpty(centre) || _streams == null)
            {
                return;
            }
            var now = Now();
            _ledger.TryGetValue(centre, out var entries);
            var ledger = new CommcastLedger { Items = (entries ?? new List<LedgerEntry>()).Select(ItemOf).ToList() };
            _streams.PublishAddressedTo(
                LedgerTopic,
                ToWire(ledger),
                now,
                new Dictionary<string, double>(StringComparer.Ordinal) { [centre] = 0.0 });
        }

        private static CommcastLedgerItem ItemOf(LedgerEntry entry)
        {
            var wire = entry.Wire;
            return new CommcastLedgerItem
            {
                Kind = Str(wire, "kind"),
                Id = entry.Id,
                GroupId = Str(wire, "groupId"),
                From = Str(wire, "from"),
                Author = AuthorOf(wire),
                SentUt = entry.SentUt,
                To = StringsOf(wire, "to") ?? new List<string>(),
                Members = StringsOf(wire, "members"),
                Added = StringsOf(wire, "added"),
                Body = wire.TryGetValue("body", out var body) ? body as string : null,
                ArrivedUt = entry.ArrivedUt,
                Delivered = entry.Delivered.Count == 0 ? null : new Dictionary<string, double>(entry.Delivered, StringComparer.Ordinal),
                Ended = entry.Ended.Count == 0 ? null : new Dictionary<string, string>(entry.Ended, StringComparer.Ordinal),
                Read = entry.Read.Count == 0
                    ? null
                    : entry.Read.ToDictionary(
                        r => r.Key,
                        r => new CommcastRead { At = r.Value.Ut, StationKey = r.Value.StationKey, Seat = r.Value.Seat },
                        StringComparer.Ordinal),
            };
        }

        /// <summary>The strings a wire entry holds under <paramref name="key"/>, whether it was built here as a typed list or read back from a save as a generic one; null when it holds none.</summary>
        private static List<string>? StringsOf(Dictionary<string, object?> wire, string key) =>
            wire.TryGetValue(key, out var value) && value is System.Collections.IEnumerable items && !(value is string)
                ? items.OfType<string>().ToList()
                : null;

        private static CommcastAuthor AuthorOf(Dictionary<string, object?> wire)
        {
            var said = Map(wire, "author");
            return new CommcastAuthor { Name = Str(said, "name"), StationKey = Str(said, "stationKey"), Seat = Str(said, "seat") };
        }

        private static Dictionary<string, object?> ToWire(CommcastLedger ledger) => new Dictionary<string, object?>
        {
            ["items"] = ledger.Items.Select(item => (object?)ToWire(item)).ToList(),
        };

        private static Dictionary<string, object?> ToWire(CommcastRead read) => new Dictionary<string, object?>
        {
            ["at"] = read.At,
            ["stationKey"] = read.StationKey,
            ["seat"] = read.Seat,
        };

        private static Dictionary<string, object?> ToWire(CommcastLedgerItem item)
        {
            var wire = new Dictionary<string, object?>
            {
                ["kind"] = item.Kind,
                ["id"] = item.Id,
                ["groupId"] = item.GroupId,
                ["from"] = item.From,
                ["author"] = ToWire(item.Author),
                ["sentUt"] = item.SentUt,
                ["to"] = item.To,
            };
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
            if (item.ArrivedUt != null)
            {
                wire["arrivedUt"] = item.ArrivedUt.Value;
            }
            if (item.Delivered != null)
            {
                wire["delivered"] = item.Delivered;
            }
            if (item.Ended != null)
            {
                wire["ended"] = item.Ended;
            }
            if (item.Read != null)
            {
                wire["read"] = item.Read.ToDictionary(r => r.Key, r => (object?)ToWire(r.Value), StringComparer.Ordinal);
            }
            return wire;
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
            AcknowledgedBudget.Record(1, now);
            _lanes?.SendLaneCommand(
                from,
                message.Author,
                ReadLaneId,
                new Dictionary<string, object?>
                {
                    ["messageId"] = args.MessageId,
                    ["readUt"] = now,
                    ["stationKey"] = args.Author?.StationKey ?? "",
                    ["seat"] = args.Author?.Seat ?? "",
                },
                "",
                MessageLifetimeSeconds,
                listed: false);
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
                return CommandResult.Fail(CommandErrorCode.NotFound, "this conversation no longer exists");
            }
            known = MembersKnownAt(changes, speaker, now);
            return known.Contains(speaker)
                ? null
                : CommandResult.Fail(CommandErrorCode.WrongState, "this centre isn't part of that conversation");
        }

        /// <summary>The group's members as <paramref name="vantage"/> knows them at <paramref name="ut"/>.</summary>
        private static List<string> MembersKnownAt(List<MembershipChange> changes, string vantage, double ut)
        {
            var members = new List<string>();
            foreach (var change in changes)
            {
                if (!KnownAt(change, vantage, ut))
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

        private static bool KnownAt(MembershipChange change, string vantage, double ut) =>
            change.Author == vantage
            || (change.Reached.Contains(vantage) && change.Ut + change.Stamp.For(vantage) <= ut)
            || (change.LetterArrival.TryGetValue(vantage, out var landed) && landed <= ut);

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

        private MembershipChange Change(double now, string author, CommcastAuthor said, List<string> members, List<string> added) =>
            new MembershipChange
            {
                Ut = now,
                Author = author,
                Said = said ?? new CommcastAuthor(),
                Members = members,
                Stamp = _streams!.StampFrom(author),
                Reached = new HashSet<string>(Addressed(author, members), StringComparer.Ordinal),
                Added = added,
            };

        /// <summary>A membership change as its listeners read it. Its id is the same however often it is said, so a listener told twice holds it once.</summary>
        private static string MembersItemId(string groupId, MembershipChange change) =>
            groupId + "@" + change.Ut.ToString("R", System.Globalization.CultureInfo.InvariantCulture);

        private static CommcastLedgerItem MembersItem(string groupId, MembershipChange change, List<string> members) =>
            new CommcastLedgerItem
            {
                Kind = "members",
                Id = MembersItemId(groupId, change),
                GroupId = groupId,
                From = change.Author,
                Author = change.Said,
                SentUt = change.Ut,
                To = change.Reached.OrderBy(id => id, StringComparer.Ordinal).ToList(),
                Members = members.OrderBy(id => id, StringComparer.Ordinal).ToList(),
                Added = change.Added.OrderBy(id => id, StringComparer.Ordinal).ToList(),
            };

        /// <summary>
        /// Keeps who a message was addressed to, for acknowledging. Said again by
        /// its author, to anyone, it stays addressed to everyone it ever left for:
        /// a member who had it from the first send can still acknowledge it.
        /// </summary>
        private void Remember(string id, string author, List<string> to, double ut)
        {
            if (_messages.TryGetValue(id, out var sent) && sent.Author == author)
            {
                sent.To.UnionWith(to);
                return;
            }
            if (sent == null)
            {
                _messageOrder.Enqueue(id);
            }
            _messages[id] = new SentMessage { Author = author, To = new HashSet<string>(to, StringComparer.Ordinal), Ut = ut };
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
