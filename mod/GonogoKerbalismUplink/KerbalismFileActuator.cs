using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// The real <see cref="IKerbalismFileActuator"/>: reflects over Kerbalism's
    /// live <c>Drive</c> to actuate the File Manager commands, through
    /// <see cref="KerbalismReflection"/>'s drive-actuation surface (every
    /// Drive/ScienceDB member name is confirmed there, not re-derived here).
    /// Runs on the Unity main thread, the same guarantee
    /// <see cref="KspScienceActuator"/> in <c>Gonogo.KSP</c> relies on:
    /// <c>ChannelEngine</c> is constructed with <c>executeCommandsOnMainThread: true</c>,
    /// so every command handler is marshaled here before it runs.
    ///
    /// <para>Every method resolves against the LIVE drive walk, never the
    /// <see cref="KerbalismFileCommandProvider"/> pre-filter's snapshot: that
    /// snapshot only rules out an obviously-stale request cheaply before this
    /// class is ever reached, it can still have moved on by the time a
    /// command actually runs.</para>
    /// </summary>
    public sealed class KerbalismFileActuator : IKerbalismFileActuator
    {
        private readonly KerbalismReflection _k;
        private readonly Kernel? _kernel;

        /// <param name="kernel">
        /// Core's capability registry, for the <c>activeVessel</c> resolution
        /// described on <see cref="ScopedVessel"/>. Optional, and null resolves
        /// no vessel, so every verb refuses with <c>NoVessel</c> rather than
        /// acting on a craft this Uplink could not confirm is the subject.
        /// </param>
        public KerbalismFileActuator(KerbalismReflection k, Kernel? kernel = null)
        {
            _k = k;
            _kernel = kernel;
        }

        /// <summary>
        /// The craft whose drives these verbs act on, from core's
        /// <c>activeVessel</c> capability rather than from KSP.
        ///
        /// <para>The substitution bites twice here. The science listing an
        /// operator picks a subject id off is the CRAFT's, so during an EVA a
        /// subject resolved against KSP's answer, the kerbal, finds no drive
        /// holding it and every verb refuses <c>NotFound</c> for every file on
        /// screen. And transmitting or dumping science is a normal thing to do
        /// while a kerbal is outside gathering more of it.</para>
        ///
        /// <para>Queried per call rather than held, as
        /// <see cref="IActiveVessel"/> requires: the answer changes on a vessel
        /// switch, a dock, an undock, and on both ends of an EVA.</para>
        /// </summary>
        private Vessel? ScopedVessel() => _kernel.ReportedVessel() as Vessel;

        public CommandResult SetSendFlagged(string subjectId, bool flag)
        {
            if (!TryResolveFile(subjectId, out var drive, out var subject, out var error))
            {
                return CommandResult.Fail(error);
            }

            var internalId = _k.SubjectInternalId(subject);
            if (internalId == null || !_k.DriveSend(drive, internalId, flag))
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            return CommandResult.Ok();
        }

        public CommandResult DeleteFile(string subjectId)
        {
            if (!TryResolveFile(subjectId, out var drive, out var subject, out var error))
            {
                return CommandResult.Fail(error);
            }

            return _k.DriveDeleteFile(drive, subject)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        public CommandResult SetAnalyzeFlagged(string subjectId, bool flag)
        {
            if (!TryResolveSample(subjectId, out var drive, out var subject, out var error))
            {
                return CommandResult.Fail(error);
            }

            return _k.DriveAnalyze(drive, subject, flag)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        public CommandResult DumpSample(string subjectId)
        {
            if (!TryResolveSample(subjectId, out var drive, out var subject, out var error))
            {
                return CommandResult.Fail(error);
            }

            return _k.DriveDeleteSample(drive, subject)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        /// <summary>
        /// Relocate a sample onto a drive that sits on a lab-equipped part
        /// (a part carrying both <c>HardDrive</c> and <c>Laboratory</c>),
        /// excluding the sample's current drive: <c>Drive.Record_sample</c> on
        /// the destination, then <c>Drive.Delete_sample</c> on the source, the
        /// same pair <c>Drive.Move</c> composes internally for a whole-drive
        /// transfer (Science/Drive.cs). Kerbalism's own analysis walk
        /// (<c>Laboratory.NextAnalyzableSample</c>) does not care which drive a
        /// sample sits on, so this is a genuine organisational relocation, not
        /// a prerequisite for <c>analyze</c> to work: the two commands are
        /// deliberately independent.
        ///
        /// <para>Fails <see cref="CommandErrorCode.ModeUnavailable"/> when no
        /// lab-adjacent drive (other than the source) has room for the FULL
        /// sample; a partial move would leave the sample split across two
        /// drives, a worse state than refusing.</para>
        /// </summary>
        public CommandResult MoveToLab(string subjectId)
        {
            var vessel = ScopedVessel();
            if (vessel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var subject = _k.ResolveSubjectData(subjectId);
            if (subject == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var drives = _k.DrivesWithLabAdjacency(vessel);
            object? sourceDrive = null;
            foreach (var candidate in drives)
            {
                if (_k.SampleBlob(candidate.Drive, subject) == null) continue;
                sourceDrive = candidate.Drive;
                break;
            }
            if (sourceDrive == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var sample = _k.SampleBlob(sourceDrive, subject);
            if (sample == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var size = _k.SampleSize(sample);
            var mass = _k.SampleMass(sample);
            var useStockCrediting = _k.SampleUsesStockCrediting(sample);
            if (size <= 0)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var candidates = new List<MoveDestinationCandidate>(drives.Count);
            foreach (var candidate in drives)
            {
                var isSource = ReferenceEquals(candidate.Drive, sourceDrive);
                var available = isSource ? null : _k.DriveSampleCapacityAvailable(candidate.Drive, subject);
                candidates.Add(new MoveDestinationCandidate(candidate.LabAdjacent, isSource, available));
            }

            var chosen = KerbalismMoveDestinationSelector.Select(candidates, size);
            if (chosen == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            var destination = drives[chosen.Value].Drive;

            if (!_k.DriveRecordSample(destination, subject, size, mass, useStockCrediting))
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            // The destination copy is already committed, so a failed source delete
            // would leave the sample on BOTH drives and silently double the science.
            // Roll the destination copy back so the vessel keeps exactly one, and
            // report the failure rather than claiming the move succeeded.
            if (!_k.DriveDeleteSample(sourceDrive, subject, size))
            {
                _k.DriveDeleteSample(destination, subject, size);
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            return CommandResult.Ok();
        }

        /// <summary>Resolve a wire subject id to the live drive that currently holds it as a FILE, or a typed failure.</summary>
        private bool TryResolveFile(string subjectId, out object drive, out object subject, out CommandErrorCode error)
        {
            drive = null!;
            subject = null!;

            var vessel = ScopedVessel();
            if (vessel == null)
            {
                error = CommandErrorCode.NoVessel;
                return false;
            }

            var resolved = _k.ResolveSubjectData(subjectId);
            if (resolved == null)
            {
                error = CommandErrorCode.NotFound;
                return false;
            }

            var found = _k.DriveHoldingFile(_k.Drives(vessel), resolved);
            if (found == null)
            {
                error = CommandErrorCode.NotFound;
                return false;
            }

            drive = found;
            subject = resolved;
            error = CommandErrorCode.None;
            return true;
        }

        /// <summary>Resolve a wire subject id to the live drive that currently holds it as a SAMPLE, or a typed failure.</summary>
        private bool TryResolveSample(string subjectId, out object drive, out object subject, out CommandErrorCode error)
        {
            drive = null!;
            subject = null!;

            var vessel = ScopedVessel();
            if (vessel == null)
            {
                error = CommandErrorCode.NoVessel;
                return false;
            }

            var resolved = _k.ResolveSubjectData(subjectId);
            if (resolved == null)
            {
                error = CommandErrorCode.NotFound;
                return false;
            }

            var found = _k.DriveHoldingSample(_k.Drives(vessel), resolved);
            if (found == null)
            {
                error = CommandErrorCode.NotFound;
                return false;
            }

            drive = found;
            subject = resolved;
            error = CommandErrorCode.None;
            return true;
        }
    }
}
