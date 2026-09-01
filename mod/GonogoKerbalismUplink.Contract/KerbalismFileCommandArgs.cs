using Sitrep.Contract;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace GonogoKerbalismUplink;

// ─────────────────────────────────────────────────────────────────────────────
// Args for the File Manager command surface (kerbalism.file.*/kerbalism.sample.*):
// flag/delete a stored file, flag/dump a sample, move a sample to a lab. See
// local_docs/design/2026-08-14-kerbalism-science-widget-integration-research.md
// §3/§4 for the full ground-truthing.
//
// ── Why SubjectId only, never a part/drive id ────────────────────────────────
// Kerbalism's own Drive verbs (Send, Delete_file, Analyze, Delete_sample, all in
// src/Kerbalism/Science/Drive.cs) take ONLY a SubjectData/subject id, never a
// part or drive handle: a file/sample is addressed by what it IS, not by where
// it happens to sit. The wire's existing subjectId (StockSubjectId, resolved
// server-side through ScienceDB.GetSubjectDataFromStockId) is therefore
// sufficient on its own for send/delete/analyze/dump, and no PartId belongs in
// these args, unlike ExperimentActionArgs (which addresses a live PartModule,
// not a data record).
//
// ── Why moveToLab carries no target lab id ───────────────────────────────────
// Kerbalism has no per-lab targeting concept: Laboratory.Analyze walks every
// drive on the WHOLE vessel for the next analyze-flagged sample
// (Modules/Laboratory.cs, NextAnalyzableSample), so a sample is never actually
// "assigned" to one lab. What moveToLab actuates is a physical relocation
// (Drive.Record_sample on the destination + Drive.Delete_sample on the source,
// composed the way Drive.Move already does for a whole-drive transfer), useful
// for redistributing samples off a nearly-full drive. The read side
// (KerbalismScienceMap.Lab) currently emits only partName for a lab entry, a
// display string, not partName's sibling ScienceLabRaw.PartId (which the
// reflection layer already reads but the map deliberately never wires to the
// channel). With no addressable lab id on the wire, a client cannot pick a
// target, so v1 keeps this subject-only: the live handler resolves
// its own destination drive (first lab-capable drive with capacity). Promoting
// ScienceLabRaw.PartId onto science.lab is the follow-up if multi-lab targeting
// is ever wanted; that is a read-side change, not this one.
//
// ── Why the toggles carry an explicit desired state ──────────────────────────
// Send/Analyze read as reversible checkboxes in Kerbalism's own File Manager
// (Drive.Send/Drive.Analyze both take the target bool directly, not a flip). A
// bare "toggle" command would race two clicks in flight against each other
// (the second undoes the first's outcome rather than confirming it); an
// explicit Flag makes every dispatch idempotent regardless of delivery order
// or a stale retry.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Args shared by the two reversible flag commands, <c>kerbalism.file.send</c>
/// and <c>kerbalism.sample.analyze</c>: the stored result addressed by its
/// stock subject id (see this file's header comment), plus the desired end
/// state. <see cref="Flag"/> is the state to SET, not "toggle from whatever it
/// is now", so a duplicate or reordered dispatch is a no-op rather than an
/// undo.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("kerbalism.file.send")]
[SitrepCommand("kerbalism.sample.analyze")]
public class KerbalismSubjectFlagArgs
{
    [SitrepUnit(Units.Id)]
    public string SubjectId { get; set; } = "";

    [SitrepUnit(Units.Flag)]
    public bool Flag { get; set; }
}

/// <summary>
/// Args shared by the three one-shot subject actions, <c>kerbalism.file.delete</c>,
/// <c>kerbalism.sample.dump</c> and <c>kerbalism.sample.moveToLab</c>: the
/// stored result addressed by its stock subject id, nothing else. Delete/dump
/// are irreversible; a repeat dispatch against an already-gone subject resolves
/// as <see cref="CommandErrorCode.NotFound"/> rather than a second deletion,
/// which is what makes retrying a dropped acknowledgement safe.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("kerbalism.file.delete")]
[SitrepCommand("kerbalism.sample.dump")]
[SitrepCommand("kerbalism.sample.moveToLab")]
public class KerbalismSubjectActionArgs
{
    [SitrepUnit(Units.Id)]
    public string SubjectId { get; set; } = "";
}
