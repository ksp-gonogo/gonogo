using Gonogo.KerbalismUplink;
using Sitrep.Contract;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// Test double for <see cref="IKerbalismFileActuator"/>: records exactly
    /// what each call was made with and returns a per-method,
    /// test-configurable result (defaulting to success) instead of ever
    /// touching KSP. Mirrors <c>Sitrep.Host.Tests.FakeScienceActuator</c>'s
    /// "record + configurable" convention.
    /// </summary>
    internal sealed class FakeKerbalismFileActuator : IKerbalismFileActuator
    {
        public string? LastSendSubjectId;
        public bool? LastSendFlag;
        public string? LastDeleteSubjectId;
        public string? LastAnalyzeSubjectId;
        public bool? LastAnalyzeFlag;
        public string? LastDumpSubjectId;
        public string? LastMoveToLabSubjectId;

        public CommandResult SendResult = CommandResult.Ok();
        public CommandResult DeleteResult = CommandResult.Ok();
        public CommandResult AnalyzeResult = CommandResult.Ok();
        public CommandResult DumpResult = CommandResult.Ok();
        public CommandResult MoveToLabResult = CommandResult.Ok();

        public CommandResult SetSendFlagged(string subjectId, bool flag)
        {
            LastSendSubjectId = subjectId;
            LastSendFlag = flag;
            return SendResult;
        }

        public CommandResult DeleteFile(string subjectId)
        {
            LastDeleteSubjectId = subjectId;
            return DeleteResult;
        }

        public CommandResult SetAnalyzeFlagged(string subjectId, bool flag)
        {
            LastAnalyzeSubjectId = subjectId;
            LastAnalyzeFlag = flag;
            return AnalyzeResult;
        }

        public CommandResult DumpSample(string subjectId)
        {
            LastDumpSubjectId = subjectId;
            return DumpResult;
        }

        public CommandResult MoveToLab(string subjectId)
        {
            LastMoveToLabSubjectId = subjectId;
            return MoveToLabResult;
        }
    }
}
