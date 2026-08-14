using System.Collections.Generic;
using Gonogo.KerbalismUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// Unit tests for <see cref="KerbalismFileCommandProvider"/>: every verb's
    /// happy path (resolves the right kind, calls the matching
    /// <see cref="IKerbalismFileActuator"/> method with the right subject id)
    /// and every fail-soft case (unknown subject, subject present but the
    /// wrong kind for the verb, Kerbalism not modelling science), all of which
    /// must short-circuit BEFORE the actuator is ever called. Entirely
    /// KSP-free: the "captured drive" is a plain <see cref="ScienceRaw"/>
    /// fixture, the same shape <see cref="ScienceExtensionWireTests"/> already
    /// builds for the read side.
    /// </summary>
    public class KerbalismFileCommandProviderTests
    {
        private const string FileSubject = "SomeExperiment@Kerbin";
        private const string SampleSubject = "OtherExperiment@Mun";

        private static ScienceStoredRaw StoredFile(string subjectId = FileSubject) => new()
        {
            PartId = "100", PartName = "Drive", SubjectId = subjectId, Kind = "file",
            SizeMB = 1.0, SciencePerMB = 2.0, ScienceMaxValue = 10, ScienceRemainingTotal = 5,
        };

        private static ScienceStoredRaw StoredSample(string subjectId = SampleSubject) => new()
        {
            PartId = "100", PartName = "Drive", SubjectId = subjectId, Kind = "sample",
            SizeMB = 1.0, SciencePerMB = 2.0, ScienceMaxValue = 10, ScienceRemainingTotal = 5,
        };

        private static ScienceRaw Modeled(params ScienceStoredRaw[] stored) => new()
        {
            Modeled = true,
            Stored = new List<ScienceStoredRaw>(stored),
        };

        private static readonly ScienceRaw Snapshot = Modeled(StoredFile(), StoredSample());

        // ---- kerbalism.file.send ----

        [Fact]
        public void HandleSend_HappyPath_CallsActuatorWithSubjectAndFlag()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleSend(
                actuator, Snapshot, new KerbalismSubjectFlagArgs { SubjectId = FileSubject, Flag = true });

            Assert.True(result.Success);
            Assert.Equal(FileSubject, actuator.LastSendSubjectId);
            Assert.True(actuator.LastSendFlag);
        }

        [Fact]
        public void HandleSend_UnknownSubject_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleSend(
                actuator, Snapshot, new KerbalismSubjectFlagArgs { SubjectId = "NoSuchSubject", Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSendSubjectId);
        }

        [Fact]
        public void HandleSend_SubjectIsASample_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleSend(
                actuator, Snapshot, new KerbalismSubjectFlagArgs { SubjectId = SampleSubject, Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSendSubjectId);
        }

        [Fact]
        public void HandleSend_KerbalismNotModeled_FailsModeUnavailable()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleSend(
                actuator, new ScienceRaw { Modeled = false }, new KerbalismSubjectFlagArgs { SubjectId = FileSubject, Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Null(actuator.LastSendSubjectId);
        }

        [Fact]
        public void HandleSend_NoSnapshotYet_FailsModeUnavailable()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleSend(
                actuator, stored: null, new KerbalismSubjectFlagArgs { SubjectId = FileSubject, Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ---- kerbalism.file.delete ----

        [Fact]
        public void HandleDelete_HappyPath_CallsActuatorWithSubject()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDelete(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = FileSubject });

            Assert.True(result.Success);
            Assert.Equal(FileSubject, actuator.LastDeleteSubjectId);
        }

        [Fact]
        public void HandleDelete_UnknownSubject_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDelete(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = "NoSuchSubject" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastDeleteSubjectId);
        }

        [Fact]
        public void HandleDelete_SubjectIsASample_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDelete(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = SampleSubject });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastDeleteSubjectId);
        }

        [Fact]
        public void HandleDelete_KerbalismNotModeled_FailsModeUnavailable()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDelete(
                actuator, new ScienceRaw { Modeled = false }, new KerbalismSubjectActionArgs { SubjectId = FileSubject });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ---- kerbalism.sample.analyze ----

        [Fact]
        public void HandleAnalyze_HappyPath_CallsActuatorWithSubjectAndFlag()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleAnalyze(
                actuator, Snapshot, new KerbalismSubjectFlagArgs { SubjectId = SampleSubject, Flag = false });

            Assert.True(result.Success);
            Assert.Equal(SampleSubject, actuator.LastAnalyzeSubjectId);
            Assert.False(actuator.LastAnalyzeFlag);
        }

        [Fact]
        public void HandleAnalyze_UnknownSubject_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleAnalyze(
                actuator, Snapshot, new KerbalismSubjectFlagArgs { SubjectId = "NoSuchSubject", Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastAnalyzeSubjectId);
        }

        [Fact]
        public void HandleAnalyze_SubjectIsAFile_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleAnalyze(
                actuator, Snapshot, new KerbalismSubjectFlagArgs { SubjectId = FileSubject, Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastAnalyzeSubjectId);
        }

        [Fact]
        public void HandleAnalyze_KerbalismNotModeled_FailsModeUnavailable()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleAnalyze(
                actuator, new ScienceRaw { Modeled = false }, new KerbalismSubjectFlagArgs { SubjectId = SampleSubject, Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ---- kerbalism.sample.dump ----

        [Fact]
        public void HandleDump_HappyPath_CallsActuatorWithSubject()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDump(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = SampleSubject });

            Assert.True(result.Success);
            Assert.Equal(SampleSubject, actuator.LastDumpSubjectId);
        }

        [Fact]
        public void HandleDump_UnknownSubject_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDump(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = "NoSuchSubject" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastDumpSubjectId);
        }

        [Fact]
        public void HandleDump_SubjectIsAFile_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDump(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = FileSubject });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastDumpSubjectId);
        }

        [Fact]
        public void HandleDump_KerbalismNotModeled_FailsModeUnavailable()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleDump(
                actuator, new ScienceRaw { Modeled = false }, new KerbalismSubjectActionArgs { SubjectId = SampleSubject });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ---- kerbalism.sample.moveToLab ----

        [Fact]
        public void HandleMoveToLab_HappyPath_CallsActuatorWithSubject()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleMoveToLab(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = SampleSubject });

            Assert.True(result.Success);
            Assert.Equal(SampleSubject, actuator.LastMoveToLabSubjectId);
        }

        [Fact]
        public void HandleMoveToLab_UnknownSubject_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleMoveToLab(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = "NoSuchSubject" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastMoveToLabSubjectId);
        }

        [Fact]
        public void HandleMoveToLab_SubjectIsAFile_FailsNotFoundWithoutCallingActuator()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleMoveToLab(
                actuator, Snapshot, new KerbalismSubjectActionArgs { SubjectId = FileSubject });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastMoveToLabSubjectId);
        }

        [Fact]
        public void HandleMoveToLab_KerbalismNotModeled_FailsModeUnavailable()
        {
            var actuator = new FakeKerbalismFileActuator();
            var result = KerbalismFileCommandProvider.HandleMoveToLab(
                actuator, new ScienceRaw { Modeled = false }, new KerbalismSubjectActionArgs { SubjectId = SampleSubject });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ---- an already-failing actuator result must still pass through untouched ----

        [Fact]
        public void HandleSend_ActuatorFailure_PassesThroughUnchanged()
        {
            var actuator = new FakeKerbalismFileActuator
            {
                SendResult = CommandResult.Fail(CommandErrorCode.NoVessel),
            };
            var result = KerbalismFileCommandProvider.HandleSend(
                actuator, Snapshot, new KerbalismSubjectFlagArgs { SubjectId = FileSubject, Flag = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NoVessel, result.ErrorCode);
        }
    }
}
