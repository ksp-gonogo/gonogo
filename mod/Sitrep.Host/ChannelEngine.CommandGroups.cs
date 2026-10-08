using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Core.StoreAndForward;

namespace Sitrep.Host
{
    /// <summary>
    /// Command groups: several delayed commands to one craft, sent as one message
    /// on one lane number. The group arrives whole or not at all, is refused
    /// whole, and runs in order inside a single main-thread hop.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>The command id a group's network message carries; it is never a command a client sends.</summary>
        internal const string GroupCommandId = "system.uplink.group";

        /// <summary>What a group's craft-side run answered: one result per member, in order.</summary>
        private sealed class GroupExecution
        {
            public GroupExecution(object?[] results) => Results = results;

            public object?[] Results { get; }
        }

        /// <summary>
        /// Takes a <c>command-group</c> frame off a session's socket. The frame's
        /// own faults are refused here, on the socket's thread; everything that
        /// needs the engine's state waits for <see cref="ProcessDispatchGroup"/>.
        /// </summary>
        private void HandleCommandGroup(ClientSession session, CommandGroupRequest group)
        {
            var jobs = new List<DispatchCommandJob>();
            for (var i = 0; i < group.Members.Count; i++)
            {
                var job = BuildRequestJob(session, group.Members[i]);
                if (job == null)
                {
                    // The member was already told its command centre is not active.
                    RefuseGroup(
                        group.Members.Select(m => RefuseSink(session, m.RequestId)).ToList(),
                        i,
                        "a command in the group names a command centre that is not active");
                    return;
                }
                jobs.Add(job);
            }
            if (jobs.Count == 0)
            {
                return;
            }
            var vantages = jobs.Select(job => job.Vantage).Distinct(StringComparer.Ordinal).ToList();
            if (vantages.Count != 1)
            {
                RefuseGroup(
                    group.Members.Select(m => RefuseSink(session, m.RequestId)).ToList(),
                    null,
                    "the commands in a group must all be sent from one command centre");
                return;
            }
            EnqueueJob(new DispatchGroupJob(group.GroupId, jobs, vantages[0]));
        }

        private Action<FaultCode, string> RefuseSink(ClientSession session, string requestId) =>
            (code, reason) => session.Outbox.PublishReliable(System.Text.Encoding.UTF8.GetBytes(
                Sitrep.Contract.Serialization.EnvelopeCodec.WriteErrorMsg(new ErrorMsg { RequestId = requestId, Code = code, Message = reason })));

        /// <summary>
        /// Refuses every member of a group with <see cref="FaultCode.GroupRefused"/>,
        /// except <paramref name="decider"/>, which has already been told its own
        /// reason.
        /// </summary>
        private static void RefuseGroup(IReadOnlyList<Action<FaultCode, string>> sinks, int? decider, string reason)
        {
            for (var i = 0; i < sinks.Count; i++)
            {
                if (i != decider)
                {
                    sinks[i](FaultCode.GroupRefused, "Not sent: " + reason + ", and a group goes whole or not at all.");
                }
            }
        }

        private void RefuseGroup(DispatchGroupJob group, DispatchCommandJob decider, string reason)
        {
            var sinks = group.Members.Select(job => (Action<FaultCode, string>)(job.OnRefused ?? ((_, __) => { }))).ToList();
            RefuseGroup(sinks, group.Members.ToList().IndexOf(decider), reason);
            group.Done?.Set();
        }

        /// <summary>
        /// Checks every member as a command sent alone would be, and sends the
        /// group as one message when all pass. One refusal refuses the group and
        /// numbers nothing.
        /// </summary>
        private void ProcessDispatchGroup(DispatchGroupJob group)
        {
            var jobs = group.Members;
            string? node = null;
            foreach (var job in jobs)
            {
                if (!IsCommandAvailable(job.Command)
                    || (!_commandHandlers.ContainsKey(job.Command) && !_vantageCommandHandlers.ContainsKey(job.Command)))
                {
                    job.OnRefused?.Invoke(FaultCode.CommandUnavailable, RefusalReason(job.Command));
                    RefuseGroup(group, job, "\"" + job.Command + "\" is not available");
                    return;
                }
                var unbindable = UnbindableArgsReason(job.Command, job.Args);
                if (unbindable != null)
                {
                    if (job.OnMalformed != null)
                    {
                        job.OnMalformed(unbindable);
                    }
                    else
                    {
                        job.OnRefused?.Invoke(FaultCode.InvalidEnvelope, unbindable);
                    }
                    RefuseGroup(group, job, "\"" + job.Command + "\" could not be read");
                    return;
                }
                var gate = EvaluateGates(job.Command, new GateArguments(job.Args));
                if (gate.Outcome == GateOutcome.Fail)
                {
                    job.OnResult(GateRefusalResult(gate));
                    RefuseGroup(group, job, "\"" + job.Command + "\" was refused");
                    return;
                }
                if (gate.Outcome != GateOutcome.Pass)
                {
                    job.OnRefused?.Invoke(FaultCode.CommandUnavailable, GateRefusalReason(job.Command, gate));
                    RefuseGroup(group, job, "\"" + job.Command + "\" could not be checked");
                    return;
                }
                if (!ResolveCommandDelay(job.Command))
                {
                    job.OnRefused?.Invoke(FaultCode.InvalidEnvelope, "\"" + job.Command + "\" cannot be sent in a group: a group carries delayed commands, and this one is instant.");
                    RefuseGroup(group, job, "\"" + job.Command + "\" cannot be held");
                    return;
                }
                var memberNode = ResolveSubjectNode(job);
                if (node != null && !string.Equals(node, memberNode, StringComparison.Ordinal))
                {
                    job.OnRefused?.Invoke(FaultCode.InvalidEnvelope, "\"" + job.Command + "\" is addressed to a different craft from the rest of its group, and a group goes to one craft.");
                    RefuseGroup(group, job, "the commands are addressed to different craft");
                    return;
                }
                node = memberNode;
            }

            var carrier = CarrierOf(group);
            if (!TryDispatchHeld(carrier, node!))
            {
                jobs[0].OnRefused?.Invoke(FaultCode.InvalidEnvelope, "A group can only be sent from a command centre to a craft.");
                RefuseGroup(group, jobs[0], "it can only be sent from a command centre to a craft");
                return;
            }
            group.Done?.Set();
        }

        /// <summary>
        /// The one dispatch a group travels as: its members as the message's args,
        /// and every answer fanned back out to the members' own requests.
        /// </summary>
        private static DispatchCommandJob CarrierOf(DispatchGroupJob group)
        {
            var jobs = group.Members;
            var members = jobs
                .Select(job => (object?)new Dictionary<string, object?>
                {
                    ["requestId"] = job.ClientRequestId,
                    ["command"] = job.Command,
                    ["args"] = job.Args,
                })
                .ToList();
            var label = string.Join(" + ", jobs.Select(job => string.IsNullOrEmpty(job.Label) ? job.Command : job.Label));
            return new DispatchCommandJob(
                GroupCommandId,
                members,
                group.Vantage,
                result => FanOutResult(jobs, result),
                null,
                label,
                jobs[0].Topic,
                (code, reason) =>
                {
                    foreach (var job in jobs)
                    {
                        job.OnRefused?.Invoke(code, reason);
                    }
                },
                oneWay =>
                {
                    foreach (var job in jobs)
                    {
                        job.OnAccepted?.Invoke(oneWay);
                    }
                },
                null,
                jobs[0].ClientRequestId,
                jobs[0].SessionId)
            {
                GroupMembers = jobs,
                OnAcceptedHeld = (oneWay, replyUt, expiresAtUt, warning) =>
                {
                    foreach (var job in jobs)
                    {
                        if (job.OnAcceptedHeld != null)
                        {
                            job.OnAcceptedHeld(oneWay, replyUt, expiresAtUt, warning);
                        }
                        else
                        {
                            job.OnAccepted?.Invoke(oneWay);
                        }
                    }
                },
                OnWarned = warning =>
                {
                    foreach (var job in jobs)
                    {
                        job.OnWarned?.Invoke(warning);
                    }
                },
            };
        }

        /// <summary>
        /// Answers each member with its own result. A group that failed as a whole,
        /// before any member ran, answers every member with that one failure.
        /// </summary>
        private static void FanOutResult(IReadOnlyList<DispatchCommandJob> jobs, object? result)
        {
            for (var i = 0; i < jobs.Count; i++)
            {
                Deliver(jobs[i], result is GroupExecution execution ? execution.Results[i] : result);
            }
        }

        /// <summary>Settles a group whose dispatch threw: every member is refused aloud, as a command sent alone would be.</summary>
        private void FailGroup(DispatchGroupJob group, Exception ex)
        {
            foreach (var job in group.Members)
            {
                FailDispatch(job, ex);
            }
            group.Done?.Set();
        }

        /// <summary>
        /// Runs a group that reached its craft. Every member's gates are checked
        /// before any member runs, and the members then run in order inside one
        /// hop to the game's main thread, so they land in one physics tick.
        /// </summary>
        private object? ExecuteGroupDelivered(CommandMessage message)
        {
            var members = ReadGroupMembers(message.Args);
            if (members.Count == 0)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "the group carried no commands");
            }
            try
            {
                return _executeCommandsOnMainThread
                    ? RunOnMainThread(_ => RunGroupHere(members, message.Lane.Vantage), null)
                    : RunGroupHere(members, message.Lane.Vantage);
            }
            catch (CommandFaultException fault)
            {
                return new HandlerFault(fault.Code, fault.Message);
            }
            catch (Exception ex)
            {
                LogHost("group of " + members.Count + " commands threw: " + SafeExceptionMessage(ex));
                return new HandlerFault(FaultCode.CommandUnavailable, "the group could not be run: " + SafeExceptionMessage(ex));
            }
        }

        private static List<(string Command, object? Args)> ReadGroupMembers(object? args)
        {
            var members = new List<(string Command, object? Args)>();
            if (!(args is IEnumerable<object?> list))
            {
                return members;
            }
            foreach (var entry in list)
            {
                if (entry is IDictionary<string, object?> member
                    && member.TryGetValue("command", out var command)
                    && command is string name)
                {
                    members.Add((name, member.TryGetValue("args", out var memberArgs) ? memberArgs : null));
                }
            }
            return members;
        }

        /// <summary>Runs on the thread that may touch the game: checks all, then runs in order, stopping at the first failure.</summary>
        private GroupExecution RunGroupHere(IReadOnlyList<(string Command, object? Args)> members, string vantage)
        {
            var results = new object?[members.Count];
            for (var i = 0; i < members.Count; i++)
            {
                var (command, args) = members[i];
                if (!IsCommandAvailable(command))
                {
                    results[i] = new HandlerFault(FaultCode.CommandUnavailable, RefusalReason(command));
                    return Refused(results, members, i, "\"" + command + "\" is not available");
                }
                var gate = EvaluateGatesHere(command, new GateArguments(args));
                if (gate.Outcome == GateOutcome.Fail)
                {
                    results[i] = GateRefusalResult(gate);
                    return Refused(results, members, i, "\"" + command + "\" was refused");
                }
                if (gate.Outcome != GateOutcome.Pass)
                {
                    results[i] = new HandlerFault(FaultCode.CommandUnavailable, GateRefusalReason(command, gate));
                    return Refused(results, members, i, "\"" + command + "\" could not be checked");
                }
            }

            for (var i = 0; i < members.Count; i++)
            {
                var (command, args) = members[i];
                var result = InvokeCommandHandler(command, args, vantage, onThisThread: true);
                results[i] = result;
                if (!Failed(result))
                {
                    continue;
                }
                var ran = i == 0 ? "none of the earlier commands" : "the " + i + " before it";
                for (var j = i + 1; j < members.Count; j++)
                {
                    results[j] = new HandlerFault(
                        FaultCode.GroupStopped,
                        "\"" + command + "\" failed, so this did not run; " + (i == 0 ? "nothing in the group ran" : ran + " did run and stay done") + ".");
                }
                break;
            }
            return new GroupExecution(results);
        }

        private static GroupExecution Refused(object?[] results, IReadOnlyList<(string Command, object? Args)> members, int decider, string reason)
        {
            for (var i = 0; i < members.Count; i++)
            {
                if (i != decider)
                {
                    results[i] = new HandlerFault(FaultCode.GroupRefused, "Not run: " + reason + " at the craft, and a group goes whole or not at all.");
                }
            }
            return new GroupExecution(results);
        }

        private static bool Failed(object? result) =>
            result is HandlerFault || (result is CommandResult command && !command.Success);

        /// <summary>
        /// One member of an in-process group dispatch: the command and the
        /// callbacks that carry its answers.
        /// </summary>
        internal sealed class GroupMemberDispatch
        {
            public string Command { get; set; } = "";

            public object? Args { get; set; }

            public string ClientRequestId { get; set; } = "";

            public string Label { get; set; } = "";

            public Action<object?> OnResult { get; set; } = _ => { };

            public Action<FaultCode, string>? OnRefused { get; set; }

            public Action<double?>? OnAccepted { get; set; }

            public Action<double?, double?, double?, string?>? OnAcceptedHeld { get; set; }
        }

        /// <summary>
        /// Test-only: sends <paramref name="members"/> as one group and blocks until
        /// the Courier thread has processed the dispatch, as
        /// <see cref="DispatchCommandAndWait"/> does for one command.
        /// </summary>
        internal void DispatchGroupAndWait(string vantage, IReadOnlyList<GroupMemberDispatch> members, TimeSpan timeout, string? sessionId = null)
        {
            var barrier = new ManualResetEventSlim(false);
            var jobs = members
                .Select(m => new DispatchCommandJob(m.Command, m.Args, vantage, m.OnResult, null, m.Label, "", m.OnRefused, m.OnAccepted, null, m.ClientRequestId, sessionId)
                {
                    OnAcceptedHeld = m.OnAcceptedHeld,
                })
                .ToList();
            EnqueueJob(new DispatchGroupJob("test-group", jobs, vantage, barrier));
            if (!barrier.Wait(timeout))
            {
                throw new TimeoutException("DispatchGroupAndWait was not processed within " + timeout.TotalMilliseconds + " ms");
            }
        }
    }
}
