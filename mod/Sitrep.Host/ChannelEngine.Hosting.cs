using System;
using Sitrep.Contract;
using Sitrep.Host.Hosting;
using Sitrep.Host.Settings;

namespace Sitrep.Host
{
    /// <summary>
    /// The host record: which screen hosts, the join code and the approved
    /// remote stations. Courier-thread state throughout.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>The <c>host.record</c> channel topic; see <see cref="HostRecordModel"/>.</summary>
        public const string HostRecordTopic = "host.record";

        internal const string HostClaimCommand = "host.claim";
        internal const string HostHeartbeatCommand = "host.heartbeat";
        internal const string HostReleaseCommand = "host.release";
        internal const string HostRegenerateCodeCommand = "host.code.regenerate";
        internal const string HostApproveStationCommand = "host.station.approve";
        internal const string HostRevokeStationCommand = "host.station.revoke";
        internal const string HostCheckStationCommand = "host.station.check";

        private HostRecord? _hostRecord;
        private HostRecordTimings? _hostTimings;

        /// <summary>Test-only: the intervals the record works to. Call before <see cref="Start"/>.</summary>
        internal void SetHostRecordTimingsForTests(HostRecordTimings timings) => _hostTimings = timings;

        /// <summary>Test-only: the record the engine keeps, built if nothing has asked for it yet.</summary>
        internal HostRecord HostRecordForTests => HostRecord;

        /// <summary>
        /// The record, built on first use so it reads the settings store the
        /// game supplied before discovery. With no store it keeps its state in
        /// memory for the session.
        /// </summary>
        private HostRecord HostRecord =>
            _hostRecord ??= new HostRecord(
                new SettingsHostRecordStore(_settings ?? new SettingsStore(new InMemorySettingsStore())),
                _nowRealSec,
                () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                timings: _hostTimings);

        private void DeclareHostRecord()
        {
            _channelDeclarations[HostRecordTopic] = new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Requires = Requirement.None,
                Topic = HostRecordTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.TrueNow,
            };
            _channelSources[HostRecordTopic] = _ => HostRecordWire.BuildHostRecordModel(HostRecord);
            _engineStateTopics.Add(HostRecordTopic);

            Declare(HostClaimCommand, typeof(HostTokenArgs));
            Declare(HostHeartbeatCommand, typeof(HostTokenArgs));
            Declare(HostReleaseCommand, typeof(HostTokenArgs));
            Declare(HostRegenerateCodeCommand, typeof(HostTokenArgs));
            Declare(HostApproveStationCommand, typeof(HostApproveStationArgs));
            Declare(HostRevokeStationCommand, typeof(HostRevokeStationArgs));
            Declare(HostCheckStationCommand, typeof(HostCheckStationArgs));

            void Declare(string command, Type argsType)
            {
                _commandDeclarations[command] = new CommandDeclaration { Command = command };
                _commandArgTypes[command] = argsType;
            }
        }

        private static Type? HostCommandArgsType(string command) => command switch
        {
            HostClaimCommand or HostHeartbeatCommand or HostReleaseCommand or HostRegenerateCodeCommand => typeof(HostTokenArgs),
            HostApproveStationCommand => typeof(HostApproveStationArgs),
            HostRevokeStationCommand => typeof(HostRevokeStationArgs),
            HostCheckStationCommand => typeof(HostCheckStationArgs),
            _ => null,
        };

        /// <summary>
        /// Answers a host command on the Courier thread, ahead of the handler
        /// stores: the record has to know which connection spoke, and a handler
        /// is not told.
        /// </summary>
        private bool TryHandleHostCommand(DispatchCommandJob job)
        {
            if (HostCommandArgsType(job.Command) == null)
            {
                return false;
            }

            var args = BindCommandArgs(job.Args, HostCommandArgsType(job.Command)!);
            var connection = job.SessionId ?? string.Empty;
            job.OnResult(AnswerHostCommand(job.Command, args, connection));
            job.Done?.Set();
            return true;
        }

        private object AnswerHostCommand(string command, object? args, string connection)
        {
            var record = HostRecord;
            switch (command)
            {
                case HostClaimCommand when args is HostTokenArgs claim && claim.Token.Length > 0:
                    return CommandResult<HostRoleReply>.Ok(RoleReply(record, record.Claim(claim.Token, connection)));
                case HostHeartbeatCommand when args is HostTokenArgs beat && beat.Token.Length > 0:
                    return CommandResult<HostRoleReply>.Ok(RoleReply(record, record.Heartbeat(beat.Token, connection)));
                case HostReleaseCommand when args is HostTokenArgs release && release.Token.Length > 0:
                    return record.Release(release.Token) ? CommandResult.Ok() : NotTheHolder();
                case HostRegenerateCodeCommand when args is HostTokenArgs regenerate && regenerate.Token.Length > 0:
                    return record.RegenerateCode(regenerate.Token) ? CommandResult.Ok() : NotTheHolder();
                case HostApproveStationCommand when args is HostApproveStationArgs approve && approve.Token.Length > 0:
                    if (approve.Credential.Length == 0)
                    {
                        return CommandResult.Fail(CommandErrorCode.NotFound, "a station is approved by the credential it presents, and none was given");
                    }

                    return record.ApproveStation(approve.Token, approve.Credential, approve.Name) ? CommandResult.Ok() : NotTheHolder();
                case HostRevokeStationCommand when args is HostRevokeStationArgs revoke && revoke.Token.Length > 0:
                    return record.RevokeStation(revoke.Token, revoke.StationId) ? CommandResult.Ok() : NotTheHolder();
                case HostCheckStationCommand when args is HostCheckStationArgs check && check.Token.Length > 0:
                    if (!record.HoldsRole(check.Token))
                    {
                        return NotTheHolder();
                    }

                    var station = check.Credential.Length == 0 ? null : record.FindStation(check.Credential);
                    return CommandResult<HostStationCheckReply>.Ok(new HostStationCheckReply
                    {
                        Approved = station != null,
                        StationId = station == null ? "" : HostRecord.PublicId(station.Credential),
                        Name = station?.Name ?? "",
                    });
                default:
                    return CommandResult.Fail(CommandErrorCode.NotFound, "\"" + command + "\" needs the token the screen keeps for itself");
            }
        }

        private static HostRoleReply RoleReply(HostRecord record, HostRoleOutcome outcome) => new HostRoleReply
        {
            Holds = outcome.Holds,
            HolderId = outcome.HolderId ?? "",
            HeartbeatSeconds = record.Timings.HeartbeatSeconds,
            GraceSeconds = record.Timings.GraceSeconds,
        };

        private static CommandResult NotTheHolder() =>
            CommandResult.Fail(CommandErrorCode.WrongState, "only the screen that holds the host role can do that");
    }
}
