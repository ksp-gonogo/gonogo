using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Plants each kind of C# seam break against synthetic seams and proves the
    /// computation sees it, and that a purely additive change is not one. The
    /// real contract is never mutated: each case is a before and an after type.
    /// </summary>
    public class ContractSeamSurfaceTests
    {
        public interface IBefore
        {
            void Keep();
            int Removed();
            string Retyped();
            void Gets();
        }

        public interface IAfterRemoved
        {
            void Keep();
            string Retyped();
            void Gets();
        }

        public interface IAfterRetyped
        {
            void Keep();
            int Removed();
            int Retyped();
            void Gets();
        }

        public interface IAfterAddedAbstract
        {
            void Keep();
            int Removed();
            string Retyped();
            void Gets();
            void Brand();
        }

        public interface IAfterAddedDefault
        {
            void Keep();
            int Removed();
            string Retyped();
            void Gets();
            void Brand() { }
        }

        public interface IAfterParameterChanged
        {
            void Keep(int extra);
            int Removed();
            string Retyped();
            void Gets();
        }

        public abstract class ClassBefore
        {
            public abstract void MustOverride();
            public virtual void MayOverride() { }
            public void Plain() { }
            protected virtual void Hook() { }
        }

        public abstract class ClassAfterNewAbstract : ClassBefore
        {
        }

        public abstract class ClassBeforeRepeated
        {
            public abstract void MustOverride();
            public virtual void MayOverride() { }
            public void Plain() { }
            protected virtual void Hook() { }
        }

        public abstract class ClassAfterAddedAbstractMember
        {
            public abstract void MustOverride();
            public virtual void MayOverride() { }
            public void Plain() { }
            protected virtual void Hook() { }
            public abstract void Fresh();
        }

        public abstract class ClassAfterAdditive
        {
            public abstract void MustOverride();
            public virtual void MayOverride() { }
            public void Plain() { }
            protected virtual void Hook() { }
            public virtual void FreshVirtual() { }
            public void FreshPlain() { }
        }

        public abstract class ClassAfterSealed
        {
            public abstract void MustOverride();
            public void MayOverride() { }
            public void Plain() { }
            protected virtual void Hook() { }
        }

        public abstract class ClassAfterNowAbstract
        {
            public abstract void MustOverride();
            public abstract void MayOverride();
            public void Plain() { }
            protected virtual void Hook() { }
        }

        public abstract class ClassAfterHookRemoved
        {
            public abstract void MustOverride();
            public virtual void MayOverride() { }
            public void Plain() { }
        }

        public abstract class ClassAfterAbstractRelaxed
        {
            public virtual void MustOverride() { }
            public virtual void MayOverride() { }
            public void Plain() { }
            protected virtual void Hook() { }
        }

        private static List<string> Breaks(System.Type before, System.Type after, bool plugin = true) =>
            ContractSeamSurface.Breaks(
                new Dictionary<string, string[]> { ["Seam"] = ContractSeamSurface.Describe(before, plugin) },
                new Dictionary<string, string[]> { ["Seam"] = ContractSeamSurface.Describe(after, plugin) })
                .ToList();

        [Fact]
        public void An_unchanged_seam_has_no_breaks()
        {
            Assert.Empty(Breaks(typeof(IBefore), typeof(IBefore)));
            Assert.Empty(Breaks(typeof(ClassBefore), typeof(ClassBefore)));
        }

        [Fact]
        public void A_removed_interface_member_is_a_break()
        {
            var breaks = Breaks(typeof(IBefore), typeof(IAfterRemoved));

            Assert.Single(breaks);
            Assert.StartsWith("seam-member-removed:Seam.Removed():", breaks[0]);
        }

        [Fact]
        public void A_changed_return_type_is_a_break()
        {
            var breaks = Breaks(typeof(IBefore), typeof(IAfterRetyped));

            Assert.Contains(breaks, b => b.StartsWith("seam-member-removed:Seam.Retyped():System.String"));
        }

        [Fact]
        public void A_changed_parameter_list_is_a_break()
        {
            var breaks = Breaks(typeof(IBefore), typeof(IAfterParameterChanged));

            Assert.Contains(breaks, b => b.StartsWith("seam-member-removed:Seam.Keep():"));
            Assert.Contains(breaks, b => b.StartsWith("seam-member-added-abstract:Seam.Keep(System.Int32):"));
        }

        [Fact]
        public void A_new_abstract_interface_member_is_a_break_for_a_plugin_implemented_seam()
        {
            var breaks = Breaks(typeof(IBefore), typeof(IAfterAddedAbstract));

            Assert.Single(breaks);
            Assert.StartsWith("seam-member-added-abstract:Seam.Brand():", breaks[0]);
        }

        [Fact]
        public void A_new_abstract_member_on_a_host_implemented_seam_is_not_a_break()
        {
            Assert.Empty(Breaks(typeof(IBefore), typeof(IAfterAddedAbstract), plugin: false));
        }

        [Fact]
        public void A_removed_member_on_a_host_implemented_seam_is_still_a_break()
        {
            Assert.NotEmpty(Breaks(typeof(IBefore), typeof(IAfterRemoved), plugin: false));
        }

        [Fact]
        public void A_new_interface_member_with_a_default_body_is_not_a_break()
        {
            Assert.Empty(Breaks(typeof(IBefore), typeof(IAfterAddedDefault)));
        }

        [Fact]
        public void A_new_abstract_member_on_an_abstract_class_is_a_break()
        {
            var breaks = Breaks(typeof(ClassBeforeRepeated), typeof(ClassAfterAddedAbstractMember));

            Assert.Single(breaks);
            Assert.StartsWith("seam-member-added-abstract:Seam.Fresh():", breaks[0]);
        }

        [Fact]
        public void A_purely_additive_virtual_or_plain_member_is_not_a_break()
        {
            Assert.Empty(Breaks(typeof(ClassBeforeRepeated), typeof(ClassAfterAdditive)));
        }

        [Fact]
        public void A_virtual_member_that_stops_being_overridable_is_a_break()
        {
            var breaks = Breaks(typeof(ClassBeforeRepeated), typeof(ClassAfterSealed));

            Assert.Single(breaks);
            Assert.StartsWith("seam-member-no-longer-overridable:Seam.MayOverride():", breaks[0]);
        }

        [Fact]
        public void A_virtual_member_that_becomes_abstract_is_a_break()
        {
            var breaks = Breaks(typeof(ClassBeforeRepeated), typeof(ClassAfterNowAbstract));

            Assert.Single(breaks);
            Assert.StartsWith("seam-member-now-abstract:Seam.MayOverride():", breaks[0]);
        }

        [Fact]
        public void A_removed_protected_hook_is_a_break()
        {
            var breaks = Breaks(typeof(ClassBeforeRepeated), typeof(ClassAfterHookRemoved));

            Assert.Single(breaks);
            Assert.StartsWith("seam-member-removed:Seam.Hook():", breaks[0]);
        }

        [Fact]
        public void An_abstract_member_that_gains_a_default_is_not_a_break()
        {
            Assert.Empty(Breaks(typeof(ClassBeforeRepeated), typeof(ClassAfterAbstractRelaxed)));
        }

        [Fact]
        public void A_removed_seam_type_is_a_break()
        {
            var floor = new Dictionary<string, string[]> { ["Seam"] = ContractSeamSurface.Describe(typeof(IBefore), true) };

            Assert.Equal(new[] { "seam-type-removed:Seam" }, ContractSeamSurface.Breaks(floor, new Dictionary<string, string[]>()));
        }

        [Fact]
        public void Relaxing_a_seam_from_plugin_to_host_implemented_is_a_break_so_it_cannot_mask_one()
        {
            var floor = new Dictionary<string, string[]> { ["Seam"] = ContractSeamSurface.Describe(typeof(IBefore), true) };
            var relaxed = new Dictionary<string, string[]> { ["Seam"] = ContractSeamSurface.Describe(typeof(IBefore), false) };

            Assert.Equal(new[] { "seam-member-removed:Seam.role:plugin" }, ContractSeamSurface.Breaks(floor, relaxed));
        }

        [Fact]
        public void The_real_contract_surface_is_seen_and_its_plugin_seams_are_found()
        {
            var seams = ContractSeamSurface.Compute(typeof(SitrepContractAttribute).Assembly);

            Assert.Contains("Sitrep.Contract.ICommsBackend", seams.Keys);
            Assert.Contains("Sitrep.Contract.CommsBackendBase", seams.Keys);
            Assert.Contains("role:plugin|plain", seams["Sitrep.Contract.ICommsBackend"]);
            Assert.Contains("role:host|plain", seams["Sitrep.Contract.IUplinkHost"]);
            Assert.DoesNotContain(seams.Keys, k => k.StartsWith("Sitrep.Host"));
        }
    }
}
