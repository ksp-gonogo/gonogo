using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The coverage gate for <see cref="SitrepControlChannelAttribute"/>: every
    /// bidirectional control channel declares BOTH halves and both resolve. The
    /// read half is the property the attribute sits on (its owning type must be a
    /// <see cref="SitrepTopicAttribute"/> payload); the write half is the
    /// attribute's required command + typed args + value field. A one-way axis
    /// cannot be spelled: the attribute has no read-only or parameterless form.
    /// </summary>
    public class ControlChannelCoverageTests
    {
        /// <summary>
        /// `(TypeName, PropName, DeclaringTypeHasTopic)` for every property
        /// carrying a <see cref="SitrepControlChannelAttribute"/>, read straight
        /// out of the assembly's METADATA rather than via reflection's attribute
        /// APIs.
        ///
        /// <para><b>Why not plain reflection, for the PROPERTY.</b> Filtering a
        /// member's custom attributes by type has to RESOLVE every attribute on
        /// that member to compare it against the filter, so blindly walking
        /// <c>type.GetProperties()</c> across the whole assembly and calling
        /// <c>GetCustomAttribute&lt;SitrepControlChannelAttribute&gt;()</c> on each
        /// one throws <c>FileNotFoundException: Reinforced.Typings</c> the moment
        /// it reaches an unrelated property that carries a <c>[TsProperty]</c>
        /// (compile-time-only, deliberately absent at test runtime; see
        /// <c>UnitCoverageTests.AnnotatedFromMetadata</c>, which hits the same
        /// hazard for <see cref="SitrepUnitAttribute"/> and fixes it the same
        /// way).</para>
        ///
        /// <para><b>Why not <c>Type.IsDefined</c>, for the declaring TYPE
        /// either.</b> It looks like the safe escape hatch (see
        /// <c>UnitCoverageTests.ContractTypes</c>, which uses it successfully for
        /// <see cref="SitrepContractAttribute"/>), but that success is
        /// attribute-ORDER luck, not a real guarantee: the CLR still walks each
        /// attribute on the member in metadata order and resolves its type to
        /// compare, so it only avoids the throw when the target attribute
        /// happens to be found before the unresolvable one. On
        /// <c>VesselControl</c> the declaration order is <c>[SitrepContract]</c>,
        /// <c>[TsInterface]</c>, <c>[SitrepTopic(...)]</c>: <c>IsDefined</c> for
        /// <see cref="SitrepContractAttribute"/> matches on the first attribute
        /// and never reaches <c>[TsInterface]</c>, but <c>IsDefined</c> for
        /// <see cref="SitrepTopicAttribute"/> has to walk past it and throws.</para>
        ///
        /// <para>A <c>MetadataReader</c> compares attribute constructor names as
        /// strings and resolves nothing, so it cannot be made to fail this way
        /// regardless of order. This method does both the property-level and the
        /// declaring-type-level check that way, in the same pass.</para>
        /// </summary>
        private static IReadOnlyList<(string TypeName, string PropName, bool DeclaringTypeHasTopic)> ControlChannelPropertiesFromMetadata()
        {
            using var stream = File.OpenRead(typeof(VesselControl).Assembly.Location);
            using var pe = new PEReader(stream);
            var md = pe.GetMetadataReader();

            string? AttributeTypeName(EntityHandle ctor)
            {
                switch (ctor.Kind)
                {
                    case HandleKind.MethodDefinition:
                        var declaring = md.GetMethodDefinition((MethodDefinitionHandle)ctor).GetDeclaringType();
                        return md.GetString(md.GetTypeDefinition(declaring).Name);
                    case HandleKind.MemberReference:
                        var parent = md.GetMemberReference((MemberReferenceHandle)ctor).Parent;
                        return parent.Kind == HandleKind.TypeReference
                            ? md.GetString(md.GetTypeReference((TypeReferenceHandle)parent).Name)
                            : null;
                    default:
                        return null;
                }
            }

            bool Carries(CustomAttributeHandleCollection handles, string attributeSimpleName)
            {
                foreach (var handle in handles)
                {
                    if (AttributeTypeName(md.GetCustomAttribute(handle).Constructor) == attributeSimpleName)
                    {
                        return true;
                    }
                }

                return false;
            }

            var results = new List<(string, string, bool)>();
            foreach (var typeHandle in md.TypeDefinitions)
            {
                var type = md.GetTypeDefinition(typeHandle);
                var typeName = md.GetString(type.Name);
                var hasTopic = Carries(type.GetCustomAttributes(), nameof(SitrepTopicAttribute));

                foreach (var propHandle in type.GetProperties())
                {
                    var prop = md.GetPropertyDefinition(propHandle);
                    if (Carries(prop.GetCustomAttributes(), nameof(SitrepControlChannelAttribute)))
                    {
                        results.Add((typeName, md.GetString(prop.Name), hasTopic));
                    }
                }
            }

            return results;
        }

        /// <summary>
        /// Resolves each metadata-discovered (type, property) pair back to real
        /// reflection objects and decodes the attribute's constructor arguments.
        /// The <c>GetCustomAttribute</c> call here is safe: it runs only against
        /// properties already confirmed, via <see cref="ControlChannelPropertiesFromMetadata"/>,
        /// to carry <see cref="SitrepControlChannelAttribute"/> and nothing else
        /// unresolvable, not against every property in the assembly.
        /// </summary>
        private static IEnumerable<(Type Type, PropertyInfo Prop, SitrepControlChannelAttribute Attr, bool DeclaringTypeHasTopic)> DeclaredChannels()
        {
            // Namespace != null && !IsNested excludes compiler-generated closure
            // classes (e.g. the shared "<>c" display class every lambda-bearing
            // type gets), which collide on simple Name across unrelated types and
            // are never a [SitrepControlChannel] host anyway.
            var typesByName = typeof(VesselControl).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition
                    && t.Namespace != null && !t.IsNested)
                .ToDictionary(t => t.Name, t => t, StringComparer.Ordinal);

            foreach (var (typeName, propName, hasTopic) in ControlChannelPropertiesFromMetadata())
            {
                var type = typesByName[typeName];
                var prop = type.GetProperty(propName, BindingFlags.Public | BindingFlags.Instance)!;
                var attr = prop.GetCustomAttribute<SitrepControlChannelAttribute>()!;
                yield return (type, prop, attr, hasTopic);
            }
        }

        [Fact]
        public void ThrottleChannelIsDeclaredWithBothHalves()
        {
            var attr = typeof(VesselControl)
                .GetProperty(nameof(VesselControl.Throttle))!
                .GetCustomAttribute<SitrepControlChannelAttribute>();

            Assert.NotNull(attr);
            Assert.Equal("vessel.control.throttle", attr!.ChannelId);
            Assert.Equal("vessel.control.setThrottle", attr.WriteCommand);
            Assert.Equal(typeof(SetThrottleArgs), attr.Args);
            Assert.Equal(nameof(SetThrottleArgs.Value), attr.ValueField);
        }

        [Fact]
        public void EveryReadHalfLivesOnATopicPayload()
        {
            foreach (var (type, prop, _, hasTopic) in DeclaredChannels())
            {
                Assert.True(
                    hasTopic,
                    $"[SitrepControlChannel] on {type.Name}.{prop.Name}: the read half must live on a [SitrepTopic] payload, but {type.Name} has none.");
            }
        }

        /// <summary>
        /// A channel's value field must be a SCALAR: one number, one switch, or
        /// one enum member that the SDK handle can wrap into wire args on its
        /// own.
        ///
        /// <para>This demanded a NUMBER while the only declared channels were
        /// the throttle and the six fly-by-wire axes, which was a fact about
        /// what had been declared rather than about what a control channel is.
        /// Half the controls an operator actually watches during a blackout are
        /// switches (SAS, RCS, gear, brakes, lights, abort) and one is a mode,
        /// and refusing those left the largest class of delayed command with no
        /// declared read-anchor at all.</para>
        ///
        /// <para>A string or a record still fails, and should: the handle wraps
        /// ONE value into ONE args field, so anything needing structure is a
        /// command a caller builds args for itself, not a channel.</para>
        /// </summary>
        [Fact]
        public void EveryWriteHalfHasAScalarValueField()
        {
            foreach (var (type, prop, attr, _) in DeclaredChannels())
            {
                var valueProp = attr.Args.GetProperty(attr.ValueField);
                Assert.True(
                    valueProp != null,
                    $"[SitrepControlChannel] on {type.Name}.{prop.Name}: args {attr.Args.Name} has no property {attr.ValueField}.");

                var t = Nullable.GetUnderlyingType(valueProp!.PropertyType) ?? valueProp.PropertyType;
                Assert.True(
                    t == typeof(double) || t == typeof(float) || t == typeof(int)
                        || t == typeof(long) || t == typeof(bool) || t.IsEnum,
                    $"[SitrepControlChannel] value field {attr.Args.Name}.{attr.ValueField} must be a scalar (number, bool or enum), was {valueProp.PropertyType.Name}.");
            }
        }

        [Fact]
        public void ChannelIdsAndFieldsAreNonEmptyAndUnique()
        {
            var ids = new List<string>();
            foreach (var (_, _, attr, _) in DeclaredChannels())
            {
                Assert.False(string.IsNullOrWhiteSpace(attr.ChannelId));
                Assert.False(string.IsNullOrWhiteSpace(attr.WriteCommand));
                Assert.False(string.IsNullOrWhiteSpace(attr.ValueField));
                ids.Add(attr.ChannelId);
            }

            Assert.Equal(ids.Distinct().Count(), ids.Count);
        }
    }
}
