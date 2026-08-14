using System;
using GonogoKerbalismUplink;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// KSP-free command-handling logic for the File Manager commands
    /// (<c>kerbalism.file.*</c>/<c>kerbalism.sample.*</c>): the command-side
    /// twin of <see cref="KerbalismScienceMap"/>, and the Kerbalism-domain
    /// analogue of <c>Sitrep.Host.ScienceCommandProvider</c>. Each
    /// <c>Handle*</c> method resolves the subject against the SAME plain
    /// <see cref="ScienceRaw"/> snapshot <see cref="KerbalismScienceBackend"/>
    /// stashes off its main-thread capture (see that type's doc comment on
    /// why that hand-off is already cross-thread-safe plain data), checks it
    /// is the kind the verb requires, and only then calls the matching
    /// <see cref="IKerbalismFileActuator"/> method. No KSP/Kerbalism type
    /// appears anywhere in this file: every check that needs the LIVE drive
    /// (has the subject moved since the snapshot, is there capacity/a lab to
    /// receive it) is the actuator's job against the live drive.
    ///
    /// <para><b>Delayed (uplink to the craft):</b> every verb here actuates
    /// Kerbalism state ON the vessel, so all five ride the same light-time
    /// delay every other vessel actuation does, declared <c>delayed: true</c>
    /// in <c>KerbalismUplink</c>'s command table.</para>
    /// </summary>
    public static class KerbalismFileCommandProvider
    {
        // ---- kerbalism.file.* / kerbalism.sample.* -- delayed:true (actuation rides light-time) ----
        public const string SendCommand = "kerbalism.file.send";
        public const string DeleteCommand = "kerbalism.file.delete";
        public const string AnalyzeCommand = "kerbalism.sample.analyze";
        public const string DumpCommand = "kerbalism.sample.dump";
        public const string MoveToLabCommand = "kerbalism.sample.moveToLab";

        private const string FileKind = "file";
        private const string SampleKind = "sample";

        /// <summary>Flag (or unflag) a stored file for transmission (<c>Drive.Send</c>).</summary>
        public static CommandResult HandleSend(IKerbalismFileActuator actuator, ScienceRaw? stored, KerbalismSubjectFlagArgs args)
        {
            var check = ValidateSubject(stored, args.SubjectId, FileKind);
            return check.Success ? actuator.SetSendFlagged(args.SubjectId, args.Flag) : check;
        }

        /// <summary>Delete a stored file outright (<c>Drive.Delete_file</c>). Irreversible.</summary>
        public static CommandResult HandleDelete(IKerbalismFileActuator actuator, ScienceRaw? stored, KerbalismSubjectActionArgs args)
        {
            var check = ValidateSubject(stored, args.SubjectId, FileKind);
            return check.Success ? actuator.DeleteFile(args.SubjectId) : check;
        }

        /// <summary>Flag (or unflag) a stored sample for lab analysis (<c>Drive.Analyze</c>).</summary>
        public static CommandResult HandleAnalyze(IKerbalismFileActuator actuator, ScienceRaw? stored, KerbalismSubjectFlagArgs args)
        {
            var check = ValidateSubject(stored, args.SubjectId, SampleKind);
            return check.Success ? actuator.SetAnalyzeFlagged(args.SubjectId, args.Flag) : check;
        }

        /// <summary>Dump a stored sample outright (<c>Drive.Delete_sample</c>). Irreversible.</summary>
        public static CommandResult HandleDump(IKerbalismFileActuator actuator, ScienceRaw? stored, KerbalismSubjectActionArgs args)
        {
            var check = ValidateSubject(stored, args.SubjectId, SampleKind);
            return check.Success ? actuator.DumpSample(args.SubjectId) : check;
        }

        /// <summary>Relocate a stored sample onto another drive on the same vessel. No cross-vessel targeting exists.</summary>
        public static CommandResult HandleMoveToLab(IKerbalismFileActuator actuator, ScienceRaw? stored, KerbalismSubjectActionArgs args)
        {
            var check = ValidateSubject(stored, args.SubjectId, SampleKind);
            return check.Success ? actuator.MoveToLab(args.SubjectId) : check;
        }

        /// <summary>
        /// The one check every verb needs before touching the actuator:
        /// Kerbalism must be modelling science at all, the subject id must be
        /// well-formed, and it must resolve in the snapshot AS THE KIND this
        /// verb requires. A subject that resolves as the WRONG kind (e.g.
        /// <c>analyze</c> against a file's subject id) is reported the same
        /// as an absent subject, <see cref="CommandErrorCode.NotFound"/>: from
        /// the caller's side "there is no ANALYZABLE result with this id" and
        /// "there is no result with this id" are the same fact, and the wire
        /// already carries <c>kind</c> on every <c>science.experiments</c> row
        /// so a well-behaved widget only ever offers a verb the row's kind
        /// supports in the first place.
        /// </summary>
        private static CommandResult ValidateSubject(ScienceRaw? stored, string? subjectId, string requiredKind)
        {
            if (stored == null || !stored.Modeled)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            if (string.IsNullOrEmpty(subjectId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            foreach (var entry in stored.Stored)
            {
                if (string.Equals(entry.SubjectId, subjectId, StringComparison.Ordinal)
                    && string.Equals(entry.Kind, requiredKind, StringComparison.Ordinal))
                {
                    return CommandResult.Ok();
                }
            }

            return CommandResult.Fail(CommandErrorCode.NotFound);
        }
    }
}
