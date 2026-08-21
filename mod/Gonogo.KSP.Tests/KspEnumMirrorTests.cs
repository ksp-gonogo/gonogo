using System;
using System.Collections.Generic;
using System.Linq;
using Contracts;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Every mirror in <c>Sitrep.Contract/KspEnums.cs</c> against the REAL enum
    /// out of <c>Assembly-CSharp.dll</c>, member for member and value for value.
    ///
    /// <para>This is the only thing standing between a KSP enum's ordinal on the
    /// wire and the exact defect putting it there was meant to end. A mirror is
    /// a transcription, and a transcription of somebody else's declaration
    /// drifts the moment they append to it: KSP adds a member, our mirror keeps
    /// its old member set, and the new ordinal resolves to no name at all. That
    /// reads to every consumer as "the field has not arrived", which is the
    /// silent, everything-looks-fine failure the whole exercise exists to
    /// remove.</para>
    ///
    /// <para>Reflection over the live enum, not a fixture, and deliberately so.
    /// A fixture would be a second transcription of the same fact, drifting in
    /// the same direction on the same day, and it would agree with a wrong
    /// mirror. The comparison has to be against the installed build.</para>
    ///
    /// <para>An enum is a plain value type with no scene, no MonoBehaviour and
    /// no static constructor worth speaking of, so these load headlessly
    /// against the reference DLL - the same contract
    /// <c>PendingCreditLedgerTests</c> and <c>FleetCommsReaderTests</c> already
    /// rely on. Under a checkout with no synced KSP install this whole file is
    /// dropped by the <c>KspManagedAvailable</c> gate in the csproj, with the
    /// build warning that names what stopped being checked.</para>
    /// </summary>
    public class KspEnumMirrorTests
    {
        /// <summary>
        /// Name→value pairs an enum type declares, ordered by value so the
        /// failure message reads in wire order rather than reflection order.
        /// </summary>
        private static List<KeyValuePair<string, long>> Members(Type enumType)
        {
            return Enum.GetValues(enumType)
                .Cast<object>()
                .Select(v => new KeyValuePair<string, long>(
                    Enum.GetName(enumType, v)!, Convert.ToInt64(v)))
                .OrderBy(p => p.Value)
                .ThenBy(p => p.Key, StringComparer.Ordinal)
                .ToList();
        }

        /// <summary>
        /// Renders a member set as one string per line, so a mismatch shows
        /// WHICH member moved instead of only that something did.
        /// </summary>
        private static string Render(IEnumerable<KeyValuePair<string, long>> members)
        {
            return string.Join("\n", members.Select(p => $"{p.Key} = {p.Value}"));
        }

        private static void AssertMirrors(Type kspEnum, Type mirror)
        {
            Assert.Equal(Render(Members(kspEnum)), Render(Members(mirror)));
        }

        /// <summary>
        /// Guards the guard. Every assertion below is a <see cref="Members"/>
        /// comparison, so a <see cref="Members"/> that silently returned nothing
        /// would make every mirror pass and report success - including an empty
        /// one. This pins one known member set by hand so that cannot happen.
        /// See CLAUDE.md on instruments blind to their own failure mode.
        /// </summary>
        [Fact]
        public void CanReadMembersOffALiveKspEnumAtAll()
        {
            Assert.Equal(
                "Available = 0\nAssigned = 1\nDead = 2\nMissing = 3",
                Render(Members(typeof(ProtoCrewMember.RosterStatus))));
        }

        [Fact]
        public void RosterStatusMirrorsKsp()
        {
            AssertMirrors(typeof(ProtoCrewMember.RosterStatus), typeof(KspRosterStatus));
        }

        [Fact]
        public void ParameterStateMirrorsKsp()
        {
            AssertMirrors(typeof(ParameterState), typeof(KspParameterState));
        }

        /// <summary>
        /// <c>PartCategories.none</c> is <c>-1</c>, so this mirror is the one
        /// that proves the comparison is on VALUES rather than on position: an
        /// implicitly-numbered mirror would put <c>none</c> at 0 and shift every
        /// category by one, and a position-only check would not notice.
        /// </summary>
        [Fact]
        public void PartCategoriesMirrorsKsp()
        {
            AssertMirrors(typeof(PartCategories), typeof(KspPartCategory));
        }

        /// <summary>
        /// A <c>[Flags]</c> enum, so the values are the bits the wire carries as
        /// a mask, not a dense ordinal run.
        /// </summary>
        [Fact]
        public void ActionGroupMirrorsKsp()
        {
            AssertMirrors(typeof(KSPActionGroup), typeof(KspActionGroup));
        }

        [Fact]
        public void EditorFacilityMirrorsKsp()
        {
            AssertMirrors(typeof(EditorFacility), typeof(KspEditorFacility));
        }

        [Fact]
        public void SpaceCenterFacilityMirrorsKsp()
        {
            AssertMirrors(typeof(SpaceCenterFacility), typeof(KspSpaceCenterFacility));
        }

        [Fact]
        public void ResourceFlowModeMirrorsKsp()
        {
            AssertMirrors(typeof(ResourceFlowMode), typeof(KspResourceFlowMode));
        }

        /// <summary>
        /// The names on the wire are KSP's own <c>.ToString()</c>, and the
        /// client's closed union is derived from the mirror's member names, so a
        /// mirror that renamed a member to something tidier would make the union
        /// reject the exact string the mod sends. Checked against
        /// <c>.ToString()</c> specifically rather than <c>Enum.GetName</c>,
        /// because <c>.ToString()</c> is what the capture calls.
        /// </summary>
        [Fact]
        public void MirrorNamesAreWhatKspToStringActuallyEmits()
        {
            Assert.Equal("none", PartCategories.none.ToString());
            Assert.Equal("Robotics", PartCategories.Robotics.ToString());
            Assert.Equal("NO_FLOW", ResourceFlowMode.NO_FLOW.ToString());
            Assert.Equal("Custom01", KSPActionGroup.Custom01.ToString());
            Assert.Equal("VAB", EditorFacility.VAB.ToString());
            Assert.Equal(
                "VehicleAssemblyBuilding",
                SpaceCenterFacility.VehicleAssemblyBuilding.ToString());
            Assert.Equal("Assigned", ProtoCrewMember.RosterStatus.Assigned.ToString());
            Assert.Equal("Incomplete", ParameterState.Incomplete.ToString());

            foreach (var (kspEnum, mirror) in new[]
            {
                (typeof(ProtoCrewMember.RosterStatus), typeof(KspRosterStatus)),
                (typeof(ParameterState), typeof(KspParameterState)),
                (typeof(PartCategories), typeof(KspPartCategory)),
                (typeof(KSPActionGroup), typeof(KspActionGroup)),
                (typeof(EditorFacility), typeof(KspEditorFacility)),
                (typeof(SpaceCenterFacility), typeof(KspSpaceCenterFacility)),
                (typeof(ResourceFlowMode), typeof(KspResourceFlowMode)),
            })
            {
                var emitted = Enum.GetValues(kspEnum)
                    .Cast<object>()
                    .Select(v => v.ToString())
                    .OrderBy(n => n, StringComparer.Ordinal);
                var mirrored = Enum.GetNames(mirror)
                    .OrderBy(n => n, StringComparer.Ordinal);
                Assert.Equal(emitted, mirrored);
            }
        }
    }
}
