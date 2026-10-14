using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core;
using Sitrep.Core.StoreAndForward;

namespace Sitrep.Host
{
    /// <summary>
    /// Getting a command's answer to the client that asked for it, when the
    /// connection it asked on has gone or the process that took the request has
    /// been restarted since. A client finds its answer by the request id it
    /// chose, which every answer frame already carries, and by naming that id
    /// in a <c>claim</c> on a later connection.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>
        /// The most outcomes kept for commands whose connection had gone when
        /// they came. A centre's operators hold a few dozen commands between
        /// them, so this is a multiple of that which also bounds memory when an
        /// outcome carries a large result; the oldest go first.
        /// </summary>
        private const int StoredOutcomeCap = 256;

        /// <summary>How long after its command's expiry a route that heard nothing is kept: the time for the report that says it expired to come home.</summary>
        private const double RouteGraceSeconds = 2 * DeliveryNetwork.CommandLifetimeSeconds;

        /// <summary>
        /// Where one command's answer goes: the connection that sent the
        /// request, or the connection that last claimed it, and the outcome
        /// itself while no connection is there to take it.
        /// </summary>
        private sealed class ReplyRoute
        {
            /// <summary>The connection that takes the answer, null once the connection has closed and a claim has not replaced it.</summary>
            public ClientSession? Session;

            /// <summary>The command centre the request was sent from, which a claim must sit at.</summary>
            public string Vantage = "";

            /// <summary>When the command expires, in UT, or null until the dispatch has said.</summary>
            public double? ExpiresAtUt;

            /// <summary>True for a claim made before the game has loaded, which waits for the load to say whether it carries the command.</summary>
            public bool Waiting;

            /// <summary>The answer frame, once it has come with no connection to take it.</summary>
            public byte[]? Outcome;

            /// <summary>When a kept outcome stops being kept, in UT.</summary>
            public double DeadlineUt;

            /// <summary>The order outcomes were kept in, so the oldest can go first.</summary>
            public long StoredOrder;
        }

        /// <summary>A command a loaded game still carries, found by the request id its client chose.</summary>
        private readonly struct RestoredCommand
        {
            public readonly string Vantage;
            public readonly double? ExpiresAtUt;

            public RestoredCommand(string vantage, double? expiresAtUt)
            {
                Vantage = vantage;
                ExpiresAtUt = expiresAtUt;
            }
        }

        /// <summary>Every command's reply route by client request id, guarded by its own lock: requests register on socket threads and answers come on the Courier's.</summary>
        private readonly Dictionary<string, ReplyRoute> _replyRoutes = new Dictionary<string, ReplyRoute>(StringComparer.Ordinal);

        /// <summary>The commands the last game load put back, by client request id, for a claim that arrives after it. Guarded by <see cref="_replyRoutes"/>.</summary>
        private readonly Dictionary<string, RestoredCommand> _restoredCommands = new Dictionary<string, RestoredCommand>(StringComparer.Ordinal);

        private long _storedOrder;

        /// <summary>
        /// Whether a claim for an id the engine holds nothing for can be told so
        /// now. False in a process that has neither loaded a game nor taken a
        /// request, where the commands a restart interrupted have not been put
        /// back yet and the claim has to wait for the load to say.
        /// </summary>
        private bool _claimsAnswerable;

        private int _claimsHandled;

        /// <summary>How many outcomes are kept at most; read by tests.</summary>
        internal static int StoredOutcomeCapForTests => StoredOutcomeCap;

        /// <summary>How many requests have a reply route; read by tests.</summary>
        internal int ReplyRouteCountForTests
        {
            get
            {
                lock (_replyRoutes)
                {
                    return _replyRoutes.Count;
                }
            }
        }

        /// <summary>How many claims have been handled; read by tests.</summary>
        internal int ClaimsHandledForTests => Volatile.Read(ref _claimsHandled);

        /// <summary>
        /// Points <paramref name="clientRequestId"/>'s answers at
        /// <paramref name="session"/>, the connection the request arrived on.
        /// </summary>
        private void RegisterRoute(ClientSession session, string clientRequestId)
        {
            Volatile.Write(ref _claimsAnswerable, true);
            if (string.IsNullOrEmpty(clientRequestId))
            {
                return;
            }
            lock (_replyRoutes)
            {
                SweepRoutes(_tickUt);
                _replyRoutes[clientRequestId] = new ReplyRoute
                {
                    Session = session,
                    Vantage = VantageOf(session),
                    ExpiresAtUt = _tickUt + DeliveryNetwork.CommandLifetimeSeconds,
                };
            }
        }

        /// <summary>Records when a command expires, so its route and its kept outcome know how long to live.</summary>
        private void NoteRouteExpiry(string clientRequestId, double expiresAtUt)
        {
            if (string.IsNullOrEmpty(clientRequestId))
            {
                return;
            }
            lock (_replyRoutes)
            {
                if (_replyRoutes.TryGetValue(clientRequestId, out var route))
                {
                    route.ExpiresAtUt = Math.Max(route.ExpiresAtUt ?? double.NegativeInfinity, expiresAtUt);
                }
            }
        }

        /// <summary>
        /// Sends an answer to the connection its route names. A non-terminal
        /// frame (an acceptance) for a connection that has gone is dropped, since
        /// a claim carries what the client persisted of it; a terminal one (a
        /// response or an error) is kept until it is claimed, expires, or is
        /// pushed out by newer ones. <paramref name="direct"/> is the
        /// connection of a caller with no route of its own.
        /// </summary>
        private void Reply(string clientRequestId, ClientSession? direct, string vantage, byte[] frame, bool terminal)
        {
            ClientSession? target;
            lock (_replyRoutes)
            {
                target = RouteReply(clientRequestId, direct, vantage, frame, terminal);
                if (terminal && !string.IsNullOrEmpty(clientRequestId))
                {
                    _restoredCommands.Remove(clientRequestId);
                }
            }
            target?.Outbox.PublishReliable(frame);
        }

        /// <summary>The connection to send a frame to now, or null when it was kept or dropped. Called with <see cref="_replyRoutes"/> held.</summary>
        private ClientSession? RouteReply(string clientRequestId, ClientSession? direct, string vantage, byte[] frame, bool terminal)
        {
            ReplyRoute? route = null;
            var routed = !string.IsNullOrEmpty(clientRequestId) && _replyRoutes.TryGetValue(clientRequestId, out route);
            var session = routed ? route!.Session : direct;
            if (session != null && _sessions.ContainsKey(session.Connection.Id))
            {
                if (routed && terminal)
                {
                    _replyRoutes.Remove(clientRequestId);
                }
                return session;
            }
            if (terminal && !string.IsNullOrEmpty(clientRequestId))
            {
                KeepOutcome(clientRequestId, route, vantage, frame);
            }
            return null;
        }

        /// <summary>Keeps <paramref name="frame"/> as the outcome for a command nobody is connected to take it for, on its route or a new one.</summary>
        private void KeepOutcome(string clientRequestId, ReplyRoute? route, string vantage, byte[] frame)
        {
            var now = _tickUt;
            SweepRoutes(now);
            if (route == null)
            {
                route = new ReplyRoute { Vantage = vantage };
                _replyRoutes[clientRequestId] = route;
            }
            route.Session = null;
            route.Waiting = false;
            route.Outcome = frame;
            route.StoredOrder = ++_storedOrder;
            var expiry = route.ExpiresAtUt ?? now + DeliveryNetwork.CommandLifetimeSeconds;
            route.DeadlineUt = now < expiry ? expiry : now + DeliveryNetwork.CommandLifetimeSeconds;

            var kept = 0;
            string? oldest = null;
            long oldestOrder = long.MaxValue;
            foreach (var entry in _replyRoutes)
            {
                if (entry.Value.Outcome == null)
                {
                    continue;
                }
                kept++;
                if (entry.Value.StoredOrder < oldestOrder)
                {
                    oldestOrder = entry.Value.StoredOrder;
                    oldest = entry.Key;
                }
            }
            if (kept > StoredOutcomeCap && oldest != null)
            {
                _replyRoutes.Remove(oldest);
            }
        }

        /// <summary>Drops the kept outcomes whose commands have expired and the routes that heard nothing long after theirs did.</summary>
        private void SweepRoutes(double ut)
        {
            List<string>? gone = null;
            foreach (var entry in _replyRoutes)
            {
                var route = entry.Value;
                var expired = route.Outcome != null
                    ? ut > route.DeadlineUt
                    : route.ExpiresAtUt != null && ut > route.ExpiresAtUt.Value + RouteGraceSeconds;
                if (expired)
                {
                    (gone ??= new List<string>()).Add(entry.Key);
                }
            }
            if (gone != null)
            {
                foreach (var id in gone)
                {
                    _replyRoutes.Remove(id);
                }
            }
        }

        /// <summary>Forgets the claims <paramref name="session"/> made before the game loaded, which nothing now waits for.</summary>
        private void ForgetWaitingClaims(ClientSession session)
        {
            lock (_replyRoutes)
            {
                List<string>? gone = null;
                foreach (var entry in _replyRoutes)
                {
                    if (entry.Value.Waiting && ReferenceEquals(entry.Value.Session, session))
                    {
                        (gone ??= new List<string>()).Add(entry.Key);
                    }
                }
                if (gone != null)
                {
                    foreach (var id in gone)
                    {
                        _replyRoutes.Remove(id);
                    }
                }
            }
        }

        /// <summary>
        /// Answers a <c>claim</c>: each named command's kept outcome is sent and
        /// forgotten, each one still on its way is pointed at
        /// <paramref name="session"/>, and each one the game holds nothing for is
        /// refused with <c>replyNotReceived</c>. A command is claimed only from
        /// the command centre that sent it, and one sent from elsewhere is
        /// answered as unknown.
        /// </summary>
        private void ProcessClaim(ClientSession session, IReadOnlyList<string> requestIds)
        {
            Interlocked.Increment(ref _claimsHandled);
            if (!_sessions.ContainsKey(session.Connection.Id))
            {
                return;
            }
            var vantage = VantageOf(session);
            var frames = new List<byte[]>();
            var claimed = new List<string>();
            lock (_replyRoutes)
            {
                SweepRoutes(_tickUt);
                foreach (var id in requestIds.Distinct(StringComparer.Ordinal))
                {
                    ClaimOne(id, session, vantage, frames, claimed);
                }
            }
            foreach (var frame in frames)
            {
                session.Outbox.PublishReliable(frame);
            }
            foreach (var id in claimed)
            {
                foreach (var entry in _pending.Where(p => string.Equals(p.ClientRequestId, id, StringComparison.Ordinal)))
                {
                    _pendingDispatcher[entry.Id] = session.Connection.Id;
                }
            }
        }

        /// <summary>Takes one claimed id: sends its kept outcome, points its route at <paramref name="session"/>, or refuses it. Called with <see cref="_replyRoutes"/> held.</summary>
        private void ClaimOne(string id, ClientSession session, string vantage, List<byte[]> frames, List<string> claimed)
        {
            if (_replyRoutes.TryGetValue(id, out var route))
            {
                if (!string.Equals(route.Vantage, vantage, StringComparison.Ordinal))
                {
                    frames.Add(NotHeldFrame(id));
                    return;
                }
                if (route.Outcome != null)
                {
                    frames.Add(route.Outcome);
                    _replyRoutes.Remove(id);
                    return;
                }
                route.Session = session;
                claimed.Add(id);
                return;
            }
            if (_restoredCommands.TryGetValue(id, out var restored) && string.Equals(restored.Vantage, vantage, StringComparison.Ordinal))
            {
                _replyRoutes[id] = new ReplyRoute { Session = session, Vantage = vantage, ExpiresAtUt = restored.ExpiresAtUt };
                _restoredCommands.Remove(id);
                claimed.Add(id);
                return;
            }
            if (Volatile.Read(ref _claimsAnswerable))
            {
                frames.Add(NotHeldFrame(id));
                return;
            }
            _replyRoutes[id] = new ReplyRoute { Session = session, Vantage = vantage, Waiting = true };
        }

        /// <summary>
        /// Settles the claims made before this load: a command the loaded game
        /// carries takes its claimer as its route, and every other one is told
        /// the game holds nothing for it. Called once a load has put its
        /// commands back, which also lets later claims be answered at once.
        /// </summary>
        private void SettleWaitingClaims(IEnumerable<KeyValuePair<string, RestoredCommand>> restored)
        {
            var refused = new List<(ClientSession Session, byte[] Frame)>();
            lock (_replyRoutes)
            {
                _restoredCommands.Clear();
                foreach (var entry in restored)
                {
                    _restoredCommands[entry.Key] = entry.Value;
                }
                List<string>? waiting = null;
                foreach (var entry in _replyRoutes)
                {
                    if (entry.Value.Waiting)
                    {
                        (waiting ??= new List<string>()).Add(entry.Key);
                    }
                }
                if (waiting != null)
                {
                    foreach (var id in waiting)
                    {
                        var route = _replyRoutes[id];
                        if (_restoredCommands.TryGetValue(id, out var command)
                            && string.Equals(command.Vantage, route.Vantage, StringComparison.Ordinal))
                        {
                            route.Waiting = false;
                            route.ExpiresAtUt = command.ExpiresAtUt;
                            _restoredCommands.Remove(id);
                        }
                        else
                        {
                            _replyRoutes.Remove(id);
                            if (route.Session != null)
                            {
                                refused.Add((route.Session, NotHeldFrame(id)));
                            }
                        }
                    }
                }
            }
            Volatile.Write(ref _claimsAnswerable, true);
            foreach (var (session, frame) in refused)
            {
                if (_sessions.ContainsKey(session.Connection.Id))
                {
                    session.Outbox.PublishReliable(frame);
                }
            }
        }

        private static byte[] NotHeldFrame(string requestId) =>
            ErrorFrame(requestId, FaultCode.ReplyNotReceived, "the game holds no answer for that request");

        /// <summary>How many client connections are open.</summary>
        internal int SessionCountForTests => _sessions.Count;

        /// <summary>
        /// The <c>command-response</c> frame for <paramref name="result"/>, or the
        /// <c>error</c> frame it stands for.
        /// </summary>
        private byte[] ResponseFrame(string requestId, string command, string vantage, double validAt, object? result)
        {
            if (result is HandlerFault fault)
            {
                return ErrorFrame(requestId, fault.Code, fault.Reason);
            }
            /*
             * `result` is whatever the uplink's command handler returned, owned
             * by the uplink the same as a channel payload. Serializing it sits
             * outside InvokeCommandHandler's guard, so unguarded an
             * unserializable result throws unattributed and the client gets no
             * answer at all, not even an error. Guarded the same way as every
             * other uplink-value touch point: that command is refused from now
             * on and the client is sent an explicit error instead.
             */
            try
            {
                var response = new CommandResponse<object?>
                {
                    RequestId = requestId,
                    Result = result,
                    Meta = new Meta
                    {
                        Source = NodeId,
                        Vantage = vantage,
                        ValidAt = validAt,
                        DeliveredAt = _clock.Now(),
                        Seq = Interlocked.Increment(ref _ackSeq),
                        Quality = Quality.OnRails,
                        Active = true,
                        Staleness = Staleness.Fresh,
                        // Built on the Courier thread at the instant the command
                        // resolved, so the Courier's epoch is the timeline it
                        // resolved on. A hand-rolled Meta would carry the wire
                        // default of 0 even after a rewind.
                        TimelineEpoch = _courier.CurrentEpoch,
                    },
                };
                return Encoding.UTF8.GetBytes(EnvelopeCodec.WriteCommandResponse(response));
            }
            catch (Exception ex)
            {
                return ErrorFrame(requestId, FaultCode.ResultSerializationError, FailSoftCommand(command, "its result could not be serialized", ex));
            }
        }

        private static byte[] ErrorFrame(string requestId, FaultCode code, string message) =>
            Encoding.UTF8.GetBytes(EnvelopeCodec.WriteErrorMsg(new ErrorMsg
            {
                RequestId = requestId,
                Code = code,
                Message = message,
            }));

        /// <summary>
        /// The answer to a command on the live path, home at the centre that
        /// sent it: to the request that sent it while this process holds it, or
        /// else kept for the client by the request id it chose. A command a
        /// load put back after a restart has no request here, only that id.
        /// </summary>
        private void AnswerLivePath(string requestId, string clientRequestId, string command, CommandResponse<object?> response)
        {
            if (_courierJobs.TryGetValue(requestId, out var job))
            {
                _courierJobs.Remove(requestId);
                Deliver(job, response.Result);
                return;
            }
            if (string.IsNullOrEmpty(clientRequestId))
            {
                return;
            }
            var vantage = response.Meta.Vantage ?? "";
            Reply(clientRequestId, null, vantage, ResponseFrame(clientRequestId, command, vantage, response.Meta.ValidAt, response.Result), terminal: true);
        }

        /// <summary>
        /// Moves this process's request id count past <paramref name="requestId"/> when it
        /// is one this process could mint, so a command sent after a load never takes
        /// the id of one the save carried.
        /// </summary>
        private void MoveRequestCountPast(string requestId)
        {
            if (requestId.Length > 1
                && requestId[0] == RequestIdPrefix
                && long.TryParse(requestId.Substring(1), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var seq))
            {
                long seen;
                while (seq > (seen = Interlocked.Read(ref _requestSeq))
                    && Interlocked.CompareExchange(ref _requestSeq, seq, seen) != seen)
                {
                }
            }
        }

        /// <summary>
        /// Puts the live path's commands a save held back on the Courier, which
        /// has just been reset to the new timeline. The request ids they carry
        /// were minted by whichever process sent them, so this one's count moves
        /// past them before it mints another.
        /// </summary>
        private void RestoreLivePath(CommandQueueState saved)
        {
            foreach (var command in saved.Commands)
            {
                MoveRequestCountPast(command.RequestId);
            }
            foreach (var command in saved.Commands)
            {
                var oneWay = command.ConfirmUt - command.ExecuteUt;
                if (oneWay > 0 && !_pending.Exists(p => string.Equals(p.Id, command.RequestId, StringComparison.Ordinal)))
                {
                    _pending.Add(new PendingUplink
                    {
                        Id = command.RequestId,
                        ClientRequestId = command.Correlation,
                        Command = command.Command,
                        Label = command.Label,
                        Topic = command.Topic,
                        Vantage = command.Vantage,
                        DispatchedAt = command.ExecuteUt - oneWay,
                        OneWaySeconds = oneWay,
                    });
                }
            }
            _courier.RestoreCommands(saved, command => response =>
                AnswerLivePath(command.RequestId, command.Correlation, command.Command, response));
        }
    }
}
