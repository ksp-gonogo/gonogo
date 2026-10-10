using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core;

namespace Sitrep.Host
{
    /// <summary>
    /// Getting a command's answer to the client that asked for it, when the
    /// connection it asked on has gone or the process that took the request has
    /// been restarted since. A client finds its answer by the request id it
    /// chose, which every answer frame already carries.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>The most answers kept for clients that were not connected when they came.</summary>
        private const int ParkedAnswerCap = 64;

        /// <summary>
        /// Answers whose connection had gone when they came, oldest first, each
        /// with the command centre it came home to. Sent to every connection at
        /// that centre as it arrives, and again to every connection that sits
        /// down there later, so a client that reconnects finds its own by request
        /// id and every other client ignores an id it never sent.
        /// </summary>
        private readonly List<(string Vantage, byte[] Frame)> _parkedAnswers = new List<(string, byte[])>();

        /// <summary>
        /// Sends an answer to the session that asked, or parks it at
        /// <paramref name="session"/>'s centre when that connection has closed.
        /// </summary>
        private void Answer(ClientSession session, byte[] frame)
        {
            if (_sessions.ContainsKey(session.Connection.Id))
            {
                session.Outbox.PublishReliable(frame);
                return;
            }
            ParkAnswer(VantageOf(session), frame);
        }

        private void ParkAnswer(string vantage, byte[] frame)
        {
            lock (_parkedAnswers)
            {
                _parkedAnswers.Add((vantage, frame));
                if (_parkedAnswers.Count > ParkedAnswerCap)
                {
                    _parkedAnswers.RemoveAt(0);
                }
            }
            foreach (var session in _sessions.Values)
            {
                if (string.Equals(VantageOf(session), vantage, StringComparison.Ordinal))
                {
                    session.Outbox.PublishReliable(frame);
                }
            }
        }

        /// <summary>How many client connections are open.</summary>
        internal int SessionCountForTests => _sessions.Count;

        /// <summary>Sends <paramref name="session"/> every parked answer that came home to the centre it sits at.</summary>
        private void ReplayParkedAnswers(ClientSession session)
        {
            var vantage = VantageOf(session);
            List<byte[]> frames;
            lock (_parkedAnswers)
            {
                frames = _parkedAnswers
                    .Where(parked => string.Equals(parked.Vantage, vantage, StringComparison.Ordinal))
                    .Select(parked => parked.Frame)
                    .ToList();
            }
            foreach (var frame in frames)
            {
                session.Outbox.PublishReliable(frame);
            }
        }

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
        /// else parked for the client by the request id it chose. A command a
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
            ParkAnswer(vantage, ResponseFrame(clientRequestId, command, vantage, response.Meta.ValidAt, response.Result));
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
                if (command.RequestId.Length > 1
                    && command.RequestId[0] == RequestIdPrefix
                    && long.TryParse(command.RequestId.Substring(1), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var seq))
                {
                    long seen;
                    while (seq > (seen = Interlocked.Read(ref _requestSeq))
                        && Interlocked.CompareExchange(ref _requestSeq, seq, seen) != seen)
                    {
                    }
                }
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
