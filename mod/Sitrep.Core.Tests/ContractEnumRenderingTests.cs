using System;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests;

/// <summary>
/// Guards the shipped contract assembly against carrying a codegen-only
/// dependency into consumers' runtimes.
///
/// <para>Reinforced.Typings is referenced with <c>PrivateAssets="all"</c>, so
/// <c>Reinforced.Typings.dll</c> is deliberately never copied beside anything
/// that references Sitrep.Contract. If the shipped assembly's metadata still
/// carried <c>[TsEnum]</c>/<c>[TsInterface]</c>, the CLR would have to resolve
/// that missing assembly the moment anything asked a contract type for its
/// custom attributes — and <c>Enum.ToString()</c> asks, because enum formatting
/// checks for <c>[Flags]</c>. The result was a <c>FileNotFoundException</c> from
/// the most innocuous line a test can write, including from inside xunit's own
/// assertion-failure message rendering, so the failure reported itself as its
/// own cause.</para>
///
/// <para>These tests fail loudly if that regresses, so nobody has to rediscover
/// the <c>(int)</c>-cast and hand-rolled-switch workarounds that grew up around
/// it.</para>
/// </summary>
public class ContractEnumRenderingTests
{
    [Fact]
    public void EnumToStringReturnsTheMemberName()
    {
        Assert.Equal("Career", GameMode.Career.ToString());
        Assert.Equal("Orbiting", Situation.Orbiting.ToString());
        Assert.Equal("SignalDelay", CommsDelaySource.SignalDelay.ToString());
        Assert.Equal("LastBeforeBlackout", Staleness.LastBeforeBlackout.ToString());
    }

    [Fact]
    public void InterpolatingAContractEnumRendersTheMemberName()
    {
        // The shape an assertion message takes when a test formats an actual
        // value — the exact path that threw instead of reporting.
        Assert.Equal("mode=Science", $"mode={GameMode.Science}");
    }

    /// <summary>
    /// The general form: every enum the contract exports must render, not just
    /// the four spot-checked above. A new <c>[TsEnum]</c> on a new enum is
    /// caught here without anyone remembering to add a case.
    /// </summary>
    [Fact]
    public void EveryPublicContractEnumRendersEveryMember()
    {
        var enums = typeof(GameMode).Assembly
            .GetTypes()
            .Where(t => t.IsEnum && t.IsPublic)
            .ToArray();

        Assert.NotEmpty(enums);

        foreach (var type in enums)
        {
            foreach (var value in Enum.GetValues(type))
            {
                var rendered = value.ToString();
                Assert.False(
                    string.IsNullOrEmpty(rendered),
                    $"{type.FullName} failed to render a member");
            }
        }
    }

    /// <summary>
    /// The other half of the same breakage, and the reason
    /// <c>Sitrep.Host</c> hand-rolls its enum parsers over
    /// <see cref="FieldInfo"/> instead of calling <see cref="Enum.Parse(Type, string, bool)"/>:
    /// the reflective parse path materialises every custom attribute on the
    /// enum type, so it threw for exactly the same reason
    /// <c>ToString()</c> did — in the net10.0 test host AND in the live KSP
    /// deploy, where a string-form enum command argument would have dead-softed
    /// the command in-game.
    /// </summary>
    [Fact]
    public void ReflectiveEnumParsingWorksOnAContractEnum()
    {
        Assert.Equal(Situation.Orbiting, Enum.Parse<Situation>("Orbiting"));
        Assert.True(Enum.TryParse<GameMode>("Career", ignoreCase: true, out var mode));
        Assert.Equal(GameMode.Career, mode);
        Assert.True(Enum.IsDefined(typeof(SasMode), SasMode.Prograde));
    }

    /// <summary>
    /// The root cause, asserted directly: no type in the shipped contract may
    /// carry an attribute from an assembly that is not deployed beside it.
    /// <c>GetCustomAttributes</c> throws rather than returning a partial list,
    /// which is what makes an unresolvable attribute poison ordinary reflection.
    /// </summary>
    [Fact]
    public void NoContractTypeCarriesAnUnresolvableAttribute()
    {
        foreach (var type in typeof(GameMode).Assembly.GetTypes())
        {
            var attributes = type.GetCustomAttributesData();
            foreach (var attribute in attributes)
            {
                Assert.NotNull(attribute.AttributeType.Assembly.Location);
            }

            // Materialising the attribute instances is what Enum.ToString and
            // most reflection-driven serializers end up doing.
            _ = type.GetCustomAttributes(inherit: false);
        }
    }

    [Fact]
    public void ContractAssemblyDoesNotReferenceReinforcedTypings()
    {
        var referenced = typeof(GameMode).Assembly
            .GetReferencedAssemblies()
            .Select(a => a.Name)
            .ToArray();

        Assert.DoesNotContain("Reinforced.Typings", referenced);
    }
}
