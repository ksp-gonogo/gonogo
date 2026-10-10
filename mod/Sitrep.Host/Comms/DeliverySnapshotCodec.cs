using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core;
using Sitrep.Core.StoreAndForward;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Writes the store-and-forward network's state to one string for a save, and
    /// reads it back. JSON inside, base64 outside, because a save's values cannot
    /// carry the braces and quotes JSON is made of.
    /// </summary>
    public static class DeliverySnapshotCodec
    {
        private const int FormatVersion = 1;

        public static string Encode(DeliverySnapshot snapshot)
        {
            var root = new Dictionary<string, object?>
            {
                ["version"] = (double)FormatVersion,
                ["nextId"] = (double)snapshot.NextId,
                ["held"] = snapshot.Held.Select(h => (object?)new Dictionary<string, object?>
                {
                    ["node"] = h.Node,
                    ["message"] = Message(h.Message),
                    ["arrivedUt"] = Number(h.ArrivedUt),
                    ["eligibleUt"] = Number(h.EligibleUt),
                    ["reportedHeld"] = h.ReportedHeld,
                    ["cameFrom"] = h.CameFrom,
                    ["away"] = h.Away,
                    ["custodyUntilUt"] = h.CustodyUntilUt,
                    ["landed"] = h.Landed,
                    ["excluded"] = h.Excluded?.Select(n => (object?)n).ToList(),
                }).ToList(),
                ["flights"] = snapshot.Flights.Select(f => (object?)new Dictionary<string, object?>
                {
                    ["message"] = Message(f.Message),
                    ["from"] = f.From,
                    ["to"] = f.To,
                    ["departUt"] = Number(f.DepartUt),
                    ["arriveUt"] = Number(f.ArriveUt),
                    ["endToEnd"] = f.EndToEnd,
                    ["reportedHeld"] = f.ReportedHeld,
                    ["toDish"] = f.ToDish,
                    ["retargeted"] = f.Retargeted,
                }).ToList(),
                ["retargets"] = Retargets(snapshot.Retargets),
                ["storedCancels"] = snapshot.StoredCancels.Select(c => (object?)new Dictionary<string, object?>
                {
                    ["node"] = c.Node,
                    ["cancel"] = Message(c.Cancel),
                }).ToList(),
                ["senders"] = snapshot.Senders.Select(s => (object?)new Dictionary<string, object?>
                {
                    ["lane"] = Lane(s.Lane),
                    ["nextSeq"] = (double)s.NextSeq,
                    ["unresolved"] = s.Unresolved.Select(u => (object?)new List<object?> { (double)u.Key, Number(u.Value) }).ToList(),
                }).ToList(),
                ["collectors"] = snapshot.Collectors.Select(c => (object?)new Dictionary<string, object?>
                {
                    ["lane"] = Lane(c.Lane),
                    ["next"] = (double)c.Next,
                    ["cancelled"] = c.Cancelled.Select(n => (object?)(double)n).ToList(),
                    ["expired"] = c.Expired.Select(n => (object?)(double)n).ToList(),
                    ["ran"] = c.Ran.Select(r => (object?)new List<object?> { (double)r.Key, Number(r.Value) }).ToList(),
                    ["waiting"] = c.Waiting.Select(w => (object?)Message(w)).ToList(),
                    ["scheduled"] = c.Scheduled.Select(d => (object?)new Dictionary<string, object?> { ["command"] = Message(d.Command), ["atUt"] = Number(d.AtUt) }).ToList(),
                    ["lastRunUt"] = Number(c.LastRunUt),
                    ["lastSentUt"] = Number(c.LastSentUt),
                }).ToList(),
                ["sentCommands"] = snapshot.SentCommands.Select(c => (object?)Message(c)).ToList(),
                ["live"] = snapshot.LivePath.Commands.Select(c => (object?)new Dictionary<string, object?>
                {
                    ["requestId"] = c.RequestId,
                    ["node"] = c.Node,
                    ["command"] = c.Command,
                    ["args"] = c.Args,
                    ["vantage"] = c.Vantage,
                    ["executeUt"] = Number(c.ExecuteUt),
                    ["confirmUt"] = Number(c.ConfirmUt),
                    ["correlation"] = c.Correlation,
                    ["label"] = c.Label,
                    ["topic"] = c.Topic,
                    ["ran"] = c.Ran,
                    ["result"] = c.Ran ? Result(c.Result) : null,
                }).ToList(),
            };
            var sb = new StringBuilder();
            JsonWriter.AppendValue(sb, root);
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString()));
        }

        /// <summary>The snapshot a save carried, or null when it carried none or one this build cannot read.</summary>
        public static DeliverySnapshot? Decode(string? encoded)
        {
            if (string.IsNullOrEmpty(encoded))
            {
                return null;
            }
            Dictionary<string, object?> root;
            try
            {
                root = (Dictionary<string, object?>)JsonReader.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(encoded)))!;
            }
            catch (Exception)
            {
                return null;
            }
            if (Get(root, "version") is not double version || (int)version != FormatVersion)
            {
                return null;
            }
            return new DeliverySnapshot
            {
                NextId = (long)(Get(root, "nextId") as double? ?? 0.0),
                Held = Items(root, "held").Select(h => new HeldRecord
                {
                    Node = (string)h["node"]!,
                    Message = MessageFrom((Dictionary<string, object?>)h["message"]!),
                    ArrivedUt = NumberFrom(h["arrivedUt"]),
                    EligibleUt = NumberFrom(h["eligibleUt"]),
                    ReportedHeld = h["reportedHeld"] is true,
                    CameFrom = h["cameFrom"] as string,
                    Away = Get(h, "away") as string,
                    CustodyUntilUt = Get(h, "custodyUntilUt") as double?,
                    Landed = Get(h, "landed") is true,
                    Excluded = (Get(h, "excluded") as List<object?>)?.OfType<string>().ToList(),
                }).ToList(),
                Flights = Items(root, "flights").Select(f => new FlightRecord
                {
                    Message = MessageFrom((Dictionary<string, object?>)f["message"]!),
                    From = (string)f["from"]!,
                    To = (string)f["to"]!,
                    DepartUt = NumberFrom(f["departUt"]),
                    ArriveUt = NumberFrom(f["arriveUt"]),
                    EndToEnd = f["endToEnd"] is true,
                    ReportedHeld = Get(f, "reportedHeld") is true,
                    ToDish = Get(f, "toDish") as string,
                    Retargeted = Get(f, "retargeted") is true,
                }).ToList(),
                Retargets = RetargetsFrom(Get(root, "retargets") as Dictionary<string, object?>),
                StoredCancels = Items(root, "storedCancels").Select(c => new StoredCancelRecord
                {
                    Node = (string)c["node"]!,
                    Cancel = (CancelMessage)MessageFrom((Dictionary<string, object?>)c["cancel"]!),
                }).ToList(),
                Senders = Items(root, "senders").Select(s => new SenderRecord
                {
                    Lane = LaneFrom((Dictionary<string, object?>)s["lane"]!),
                    NextSeq = (long)NumberFrom(s["nextSeq"]),
                    Unresolved = Pairs(s["unresolved"]),
                }).ToList(),
                Collectors = Items(root, "collectors").Select(c => new CollectorRecord
                {
                    Lane = LaneFrom((Dictionary<string, object?>)c["lane"]!),
                    Next = (long)NumberFrom(c["next"]),
                    Cancelled = Longs(c["cancelled"]),
                    Expired = Longs(c["expired"]),
                    Ran = Pairs(c["ran"]),
                    Waiting = ((List<object?>)c["waiting"]!).Select(w => (CommandMessage)MessageFrom((Dictionary<string, object?>)w!)).ToList(),
                    Scheduled = ((List<object?>)c["scheduled"]!).Select(d =>
                    {
                        var due = (Dictionary<string, object?>)d!;
                        return new ScheduledRecord { Command = (CommandMessage)MessageFrom((Dictionary<string, object?>)due["command"]!), AtUt = NumberFrom(due["atUt"]) };
                    }).ToList(),
                    LastRunUt = NumberFrom(c["lastRunUt"]),
                    LastSentUt = NumberFrom(c["lastSentUt"]),
                }).ToList(),
                SentCommands = ((List<object?>)root["sentCommands"]!).Select(m => (CommandMessage)MessageFrom((Dictionary<string, object?>)m!)).ToList(),
                LivePath = new CommandQueueState
                {
                    Commands = Items(root, "live").Select(c => new PendingCommandState
                    {
                        RequestId = (string)c["requestId"]!,
                        Node = (string)c["node"]!,
                        Command = (string)c["command"]!,
                        Args = Get(c, "args"),
                        Vantage = (string)c["vantage"]!,
                        ExecuteUt = NumberFrom(c["executeUt"]),
                        ConfirmUt = NumberFrom(c["confirmUt"]),
                        Correlation = Get(c, "correlation") as string ?? "",
                        Label = Get(c, "label") as string ?? "",
                        Topic = Get(c, "topic") as string ?? "",
                        Ran = Get(c, "ran") is true,
                        Result = ResultFrom(Get(c, "result")),
                    }).ToList(),
                },
            };
        }

        private static Dictionary<string, object?> Lane(LaneKey lane) => new Dictionary<string, object?>
        {
            ["epoch"] = (double)lane.Epoch,
            ["vantage"] = lane.Vantage,
            ["craft"] = lane.Craft,
        };

        private static LaneKey LaneFrom(Dictionary<string, object?> lane) =>
            new LaneKey((long)NumberFrom(lane["epoch"]), (string)lane["vantage"]!, (string)lane["craft"]!);

        private static Dictionary<string, object?> Message(DeliveryMessage message)
        {
            switch (message)
            {
                case CommandMessage c:
                    return new Dictionary<string, object?>
                    {
                        ["type"] = "command",
                        ["id"] = c.Id,
                        ["lane"] = Lane(c.Lane),
                        ["laneSeq"] = (double)c.LaneSeq,
                        ["gapExpiresUt"] = c.GapExpiresUt,
                        ["sentUt"] = Number(c.SentUt),
                        ["deleteAtUt"] = Number(c.DeleteAtUt),
                        ["command"] = c.Command,
                        ["args"] = c.Args,
                        ["execNode"] = c.ExecNode,
                        ["channel"] = c.Channel,
                        ["attempt"] = (double)c.Attempt,
                        ["clientRequestId"] = c.ClientRequestId,
                        ["supersedes"] = c.Supersedes.Select(n => (object?)(double)n).ToList(),
                        ["route"] = Route(c.Route),
                    };
                case CancelMessage x:
                    return new Dictionary<string, object?>
                    {
                        ["type"] = "cancel",
                        ["id"] = x.Id,
                        ["lane"] = Lane(x.Lane),
                        ["fromSeq"] = (double)x.FromSeq,
                        ["throughSeq"] = (double)x.ThroughSeq,
                        ["sentUt"] = Number(x.SentUt),
                        ["deleteAtUt"] = Number(x.DeleteAtUt),
                        ["targetNode"] = x.TargetNode,
                        ["route"] = Route(x.Route),
                    };
                case ReportMessage r:
                    return new Dictionary<string, object?>
                    {
                        ["type"] = "report",
                        ["id"] = r.Id,
                        ["to"] = r.To,
                        ["kind"] = (double)(int)r.Kind,
                        ["about"] = r.About,
                        ["lane"] = Lane(r.Lane),
                        ["laneSeq"] = (double)r.LaneSeq,
                        ["at"] = r.At,
                        ["atUt"] = Number(r.AtUt),
                        ["untilUt"] = r.UntilUt,
                        ["detail"] = r.Detail,
                        ["missing"] = r.Missing?.Select(n => (object?)(double)n).ToList(),
                        ["route"] = Route(r.Route),
                        ["result"] = r.Kind == JourneyKind.Reply ? Result(r.Result) : null,
                        ["clientRequestId"] = r.ClientRequestId,
                        ["command"] = r.Command,
                    };
                default:
                    throw new NotSupportedException("Unknown delivery message " + message.GetType().Name);
            }
        }

        private static DeliveryMessage MessageFrom(Dictionary<string, object?> m)
        {
            switch ((string)m["type"]!)
            {
                case "command":
                    return new CommandMessage
                    {
                        Id = (string)m["id"]!,
                        Lane = LaneFrom((Dictionary<string, object?>)m["lane"]!),
                        LaneSeq = (long)NumberFrom(m["laneSeq"]),
                        GapExpiresUt = m["gapExpiresUt"] as double?,
                        SentUt = NumberFrom(m["sentUt"]),
                        DeleteAtUt = NumberFrom(m["deleteAtUt"]),
                        Command = (string)m["command"]!,
                        Args = m["args"],
                        ExecNode = (string)m["execNode"]!,
                        Channel = m["channel"] as string,
                        Attempt = (int)NumberFrom(m["attempt"]),
                        ClientRequestId = Get(m, "clientRequestId") as string ?? "",
                        Supersedes = Longs(m["supersedes"]),
                        Route = RouteFrom(Get(m, "route")),
                    };
                case "cancel":
                    return new CancelMessage
                    {
                        Id = (string)m["id"]!,
                        Lane = LaneFrom((Dictionary<string, object?>)m["lane"]!),
                        FromSeq = (long)NumberFrom(m["fromSeq"]),
                        ThroughSeq = (long)NumberFrom(m["throughSeq"]),
                        SentUt = NumberFrom(m["sentUt"]),
                        DeleteAtUt = NumberFrom(m["deleteAtUt"]),
                        TargetNode = m["targetNode"] as string,
                        Route = RouteFrom(Get(m, "route")),
                    };
                default:
                    return new ReportMessage
                    {
                        Id = (string)m["id"]!,
                        To = (string)m["to"]!,
                        Kind = (JourneyKind)(int)NumberFrom(m["kind"]),
                        About = (string)m["about"]!,
                        Lane = LaneFrom((Dictionary<string, object?>)m["lane"]!),
                        LaneSeq = (long)NumberFrom(m["laneSeq"]),
                        At = (string)m["at"]!,
                        AtUt = NumberFrom(m["atUt"]),
                        UntilUt = m["untilUt"] as double?,
                        Detail = m["detail"] as string,
                        Missing = m["missing"] is List<object?> missing ? missing.Select(n => (long)NumberFrom(n)).ToList() : null,
                        Route = RouteFrom(Get(m, "route")),
                        Result = ResultFrom(Get(m, "result")),
                        ClientRequestId = Get(m, "clientRequestId") as string ?? "",
                        Command = Get(m, "command") as string ?? "",
                    };
            }
        }

        /// <summary>The hops a message carries. Its plan is not saved: a plan is made of what a centre had heard, and that is not saved either.</summary>
        private static Dictionary<string, object?> Retargets(RetargetSnapshot snapshot) => new Dictionary<string, object?>
        {
            ["events"] = snapshot.Events.Select(e => (object?)new Dictionary<string, object?>
            {
                ["id"] = e.Id,
                ["node"] = e.Node,
                ["dish"] = e.Dish,
                ["peer"] = e.Peer,
                ["phase"] = (double)(int)e.Phase,
                ["announcedUt"] = Number(e.AnnouncedUt),
                ["turnUt"] = Number(e.TurnUt),
                ["backUt"] = Number(e.BackUt),
                ["turnedUt"] = Number(e.TurnedUt),
                ["endedUt"] = Number(e.EndedUt),
                ["record"] = e.Record,
                ["waiting"] = e.Waiting.Select(w => (object?)w).ToList(),
            }).ToList(),
            ["rests"] = snapshot.Rests.Select(r => (object?)new List<object?> { r.Dish, Number(r.UntilUt) }).ToList(),
        };

        private static RetargetSnapshot RetargetsFrom(Dictionary<string, object?>? map)
        {
            var snapshot = new RetargetSnapshot();
            if (map == null)
            {
                return snapshot;
            }
            snapshot.Events = Items(map, "events").Select(e => new RetargetEventRecord
            {
                Id = (string)e["id"]!,
                Node = (string)e["node"]!,
                Dish = (string)e["dish"]!,
                Peer = (string)e["peer"]!,
                Phase = (RetargetPhase)(int)NumberFrom(e["phase"]),
                AnnouncedUt = NumberFrom(e["announcedUt"]),
                TurnUt = NumberFrom(e["turnUt"]),
                BackUt = NumberFrom(e["backUt"]),
                TurnedUt = NumberFrom(Get(e, "turnedUt")),
                EndedUt = NumberFrom(Get(e, "endedUt")),
                Record = Get(e, "record") as string,
                Waiting = (Get(e, "waiting") as List<object?>)?.OfType<string>().ToList() ?? new List<string>(),
            }).ToList();
            snapshot.Rests = (Get(map, "rests") as List<object?> ?? new List<object?>())
                .OfType<List<object?>>()
                .Select(r => new RetargetRestRecord { Dish = (string)r[0]!, UntilUt = NumberFrom(r[1]) })
                .ToList();
            return snapshot;
        }

        private static List<object?> Route(List<PlannedHop> route) =>
            route.Select(hop => (object?)new List<object?> { hop.To, Number(hop.DepartUt), Number(hop.ArriveUt), hop.FromDish, hop.ToDish, hop.RetargetDish, Number(hop.TurnUt) }).ToList();

        private static List<PlannedHop> RouteFrom(object? value) =>
            value is List<object?> list
                ? list.OfType<List<object?>>().Select(hop => new PlannedHop(
                    (string)hop[0]!,
                    NumberFrom(hop[1]),
                    NumberFrom(hop[2]),
                    hop.Count > 3 ? hop[3] as string : null,
                    hop.Count > 4 ? hop[4] as string : null,
                    hop.Count > 5 ? hop[5] as string : null,
                    hop.Count > 6 ? NumberFrom(hop[6]) : double.NaN)).ToList()
                : new List<PlannedHop>();

        /// <summary>
        /// What a command's handler returned, as a save carries it: the JSON it
        /// goes to a client as, or the refusal it stands for. A result that
        /// cannot be written as JSON is saved as the refusal a client is sent in
        /// its place, so one command's answer cannot cost the whole save.
        /// </summary>
        private static Dictionary<string, object?> Result(object? result)
        {
            if (result is ChannelEngine.HandlerFault fault)
            {
                return new Dictionary<string, object?> { ["fault"] = fault.Code.Id, ["reason"] = fault.Reason };
            }
            try
            {
                var sb = new StringBuilder();
                JsonWriter.AppendValue(sb, result);
                return new Dictionary<string, object?> { ["value"] = JsonReader.Parse(sb.ToString()) };
            }
            catch (Exception ex)
            {
                return new Dictionary<string, object?>
                {
                    ["fault"] = FaultCode.ResultSerializationError.Id,
                    ["reason"] = "its result could not be saved with the game: " + ex.Message,
                };
            }
        }

        private static object? ResultFrom(object? saved)
        {
            if (!(saved is Dictionary<string, object?> map))
            {
                return null;
            }
            return Get(map, "fault") is string code
                ? new ChannelEngine.HandlerFault(FaultCode.FromWire(code), Get(map, "reason") as string ?? "")
                : Get(map, "value");
        }

        /// <summary>A number the JSON can carry: a non-finite value becomes null and reads back as not-a-number.</summary>
        private static object? Number(double value) =>
            double.IsNaN(value) || double.IsInfinity(value) ? (object?)(double.IsPositiveInfinity(value) ? "inf" : double.IsNegativeInfinity(value) ? "-inf" : null) : value;

        private static double NumberFrom(object? value) => value switch
        {
            double d => d,
            "inf" => double.PositiveInfinity,
            "-inf" => double.NegativeInfinity,
            _ => double.NaN,
        };

        private static object? Get(Dictionary<string, object?> map, string key) => map.TryGetValue(key, out var value) ? value : null;

        private static IEnumerable<Dictionary<string, object?>> Items(Dictionary<string, object?> map, string key) =>
            Get(map, key) is List<object?> list ? list.OfType<Dictionary<string, object?>>() : Enumerable.Empty<Dictionary<string, object?>>();

        private static List<long> Longs(object? value) =>
            value is List<object?> list ? list.Select(n => (long)NumberFrom(n)).ToList() : new List<long>();

        private static List<KeyValuePair<long, double>> Pairs(object? value) =>
            value is List<object?> list
                ? list.OfType<List<object?>>().Select(p => new KeyValuePair<long, double>((long)NumberFrom(p[0]), NumberFrom(p[1]))).ToList()
                : new List<KeyValuePair<long, double>>();
    }
}
