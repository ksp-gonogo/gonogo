using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The runtime witness that health is now MANDATORY (2026-07-21,
    /// <c>local_docs/holiday_week/HIGH-PRIORITY-mandatory-healthchecks.md</c>). The
    /// real enforcement is COMPILE-TIME — <c>Health()</c> is a required member of
    /// <see cref="ISitrepUplink"/> with NO default, so an uplink that omits it does
    /// not compile (proven by the migration: 46 test doubles hard-errored with
    /// CS0535 until each declared it). A compile failure can't be a runtime test, so
    /// these assert the contract SHAPE instead, catching a regression that would make
    /// health optional again (a re-added default, a moved method, a resurrected
    /// companion interface).
    /// </summary>
    public class MandatoryHealthContractTests
    {
        [Fact]
        public void ISitrepUplink_declares_Health_as_a_required_member()
        {
            var method = typeof(ISitrepUplink).GetMethod(
                nameof(ISitrepUplink.Health),
                BindingFlags.Public | BindingFlags.Instance);

            Assert.NotNull(method);
            Assert.Equal(typeof(UplinkHealth), method!.ReturnType);
            Assert.Empty(method.GetParameters());
            // No default interface implementation: a mandate that ships a default
            // lets an author silently omit health (operator Q1 rejected exactly this).
            Assert.True(method.IsAbstract, "Health() must have NO default interface body — it must force an explicit implementation.");
        }

        [Fact]
        public void The_retired_IUplinkHealthReporter_companion_no_longer_exists()
        {
            var retired = typeof(ISitrepUplink).Assembly
                .GetTypes()
                .SingleOrDefault(t => t.Name == "IUplinkHealthReporter");

            Assert.Null(retired);
        }

        [Fact]
        public void UplinkHealth_Healthy_is_the_trivial_floor()
        {
            Assert.Equal(UplinkHealthState.Healthy, UplinkHealth.Healthy.State);
            Assert.Null(UplinkHealth.Healthy.Detail);
        }
    }
}
