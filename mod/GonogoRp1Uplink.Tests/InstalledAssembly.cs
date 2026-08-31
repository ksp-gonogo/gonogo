using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// A shipped assembly read as METADATA rather than loaded, so the shape of
    /// RP-1's object graph can be checked on a machine that has the mod installed
    /// without having KSP, Unity or any of RP-1's own dependencies resolvable.
    /// </summary>
    /// <remarks>
    /// Loading RP0.dll for real is not an option and never will be: it is a
    /// ScenarioModule over Assembly-CSharp and half a dozen Unity assemblies, and
    /// asking a loaded <c>FieldInfo</c> for its <c>FieldType</c> throws the moment
    /// the answer lives in an assembly that is not there. Metadata has no such
    /// dependency: every type in a signature is either a definition in this file
    /// or a reference NAMED in this file, and a name is all a shape check needs.
    ///
    /// <para><see cref="System.Reflection.Metadata"/> ships in the shared
    /// framework, so this needs no package reference and cannot fail to restore
    /// on a machine that is offline.</para>
    /// </remarks>
    public sealed class InstalledAssembly : IDisposable
    {
        private readonly FileStream _stream;
        private readonly PEReader _pe;
        private readonly MetadataReader _md;
        private readonly SignatureNames _names;
        private readonly Dictionary<string, TypeDefinitionHandle> _types =
            new Dictionary<string, TypeDefinitionHandle>(StringComparer.Ordinal);

        /// <summary>Where the file was read from, so a report names the binary it checked.</summary>
        public string Path { get; }

        /// <summary>The assembly's own name and version, which is NOT the RP-1 release version.</summary>
        public string Identity { get; }

        /// <summary>
        /// The file's SHA-256, first sixteen characters. RP-1 stamps its release
        /// version nowhere the metadata carries, so the digest is the only thing
        /// that says exactly WHICH build a green run was green against.
        /// </summary>
        public string Digest { get; }

        public InstalledAssembly(string path)
        {
            Path = path;
            _stream = File.OpenRead(path);
            _pe = new PEReader(_stream);
            _md = _pe.GetMetadataReader();
            _names = new SignatureNames(_md);

            var def = _md.GetAssemblyDefinition();
            Identity = _md.GetString(def.Name) + ", " + def.Version;

            using (var sha = SHA256.Create())
            using (var digestStream = File.OpenRead(path))
            {
                Digest = Convert.ToHexString(sha.ComputeHash(digestStream)).Substring(0, 16).ToLowerInvariant();
            }

            foreach (var handle in _md.TypeDefinitions)
            {
                _types[FullName(handle)] = handle;
            }
        }

        public bool HasType(string fullName) => _types.ContainsKey(fullName);

        /// <summary>
        /// A named field or property, resolved the way
        /// <c>Rp1Types.Resolve</c> resolves one: a readable property first, then a
        /// field, walking the base chain so a member declared on a base class
        /// answers from the concrete subclass. The walk stops where the base
        /// leaves this assembly, which is reported rather than treated as absent.
        /// </summary>
        public MemberFacts? FindMember(string typeFullName, string memberName)
        {
            if (!_types.TryGetValue(typeFullName, out var handle))
            {
                return null;
            }

            for (var current = handle; ;)
            {
                var type = _md.GetTypeDefinition(current);
                var declaring = FullName(current);

                foreach (var propertyHandle in type.GetProperties())
                {
                    var property = _md.GetPropertyDefinition(propertyHandle);
                    if (!_md.GetString(property.Name).Equals(memberName, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    var accessors = property.GetAccessors();
                    if (accessors.Getter.IsNil)
                    {
                        // Not readable, so Rp1Types.Resolve would fall through to
                        // a field of the same name. There cannot be one, so this
                        // is an absent READ, reported as the property it found.
                        continue;
                    }
                    var getter = _md.GetMethodDefinition(accessors.Getter);
                    var signature = property.DecodeSignature(_names, null);
                    return new MemberFacts(
                        MemberShape.Property,
                        memberName,
                        declaring,
                        signature.ReturnType,
                        getter.Attributes.HasFlag(MethodAttributes.Static),
                        (getter.Attributes & MethodAttributes.MemberAccessMask) == MethodAttributes.Public,
                        !accessors.Setter.IsNil);
                }

                foreach (var fieldHandle in type.GetFields())
                {
                    var field = _md.GetFieldDefinition(fieldHandle);
                    if (!_md.GetString(field.Name).Equals(memberName, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    return new MemberFacts(
                        MemberShape.Field,
                        memberName,
                        declaring,
                        field.DecodeSignature(_names, null),
                        field.Attributes.HasFlag(FieldAttributes.Static),
                        (field.Attributes & FieldAttributes.FieldAccessMask) == FieldAttributes.Public,
                        !field.Attributes.HasFlag(FieldAttributes.Literal));
                }

                var baseHandle = type.BaseType;
                if (!IsWalkableBase(baseHandle))
                {
                    return null;
                }
                current = (TypeDefinitionHandle)baseHandle;
            }
        }

        /// <summary>
        /// Whether a type's base handle is one the walk can step onto.
        /// </summary>
        /// <remarks>
        /// <para>The <c>IsNil</c> half is load-bearing and was missing. An INTERFACE
        /// has no base type at all, and a nil <c>TypeDefinitionHandle</c> still
        /// reports its <c>Kind</c> as <c>TypeDefinition</c> while pointing at row
        /// zero, which does not exist. So the Kind check alone let the walk step onto
        /// row zero and <c>GetMethodRange</c> threw <c>BadImageFormatException:
        /// Read out of bounds</c>.</para>
        /// <para>It never fired before because every type this manifest pinned was a
        /// CLASS, whose base is <c>System.Object</c> and therefore a
        /// <c>TypeReference</c> that the Kind check already rejected. The first
        /// interface pinned (<c>ISpaceCenterProject.GetItemName</c>, which is where
        /// every warp target's name comes from) crashed the whole check rather than
        /// reporting on it: a member genuinely declared on an interface was a case
        /// this instrument could not express.</para>
        /// </remarks>
        private static bool IsWalkableBase(EntityHandle baseHandle) =>
            !baseHandle.IsNil && baseHandle.Kind == HandleKind.TypeDefinition;

        /// <summary>
        /// A method by name and arity, matched the way
        /// <c>Rp1BuildCommands.Match</c> matches one, walking the base chain for
        /// the same reason <see cref="FindMember"/> does.
        /// </summary>
        public IReadOnlyList<MethodFacts> FindMethods(string typeFullName, string methodName)
        {
            var found = new List<MethodFacts>();
            if (!_types.TryGetValue(typeFullName, out var handle))
            {
                return found;
            }

            for (var current = handle; ;)
            {
                var type = _md.GetTypeDefinition(current);
                foreach (var methodHandle in type.GetMethods())
                {
                    var method = _md.GetMethodDefinition(methodHandle);
                    if (!_md.GetString(method.Name).Equals(methodName, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    var signature = method.DecodeSignature(_names, null);
                    found.Add(new MethodFacts(
                        methodName,
                        FullName(current),
                        signature.ParameterTypes,
                        signature.ReturnType,
                        method.Attributes.HasFlag(MethodAttributes.Static),
                        (method.Attributes & MethodAttributes.MemberAccessMask) == MethodAttributes.Public));
                }

                var baseHandle = type.BaseType;
                if (!IsWalkableBase(baseHandle))
                {
                    return found;
                }
                current = (TypeDefinitionHandle)baseHandle;
            }
        }

        /// <summary>
        /// The names of a type's OWN fields carrying the named attribute, in
        /// declaration order.
        /// </summary>
        /// <remarks>
        /// Reads the attribute rather than a list somebody wrote down, which is
        /// the whole of its value: the research command authors a ConfigNode for
        /// <c>ConfigNode.LoadObjectFromConfig</c> to parse, and that method is
        /// driven by <c>[Persistent]</c>. A key the command forgets is not an
        /// error at load time, it silently leaves the field at its default, so
        /// the only check that can see it is one that asks the SHIPPED assembly
        /// which fields carry the attribute.
        ///
        /// <para>Own fields only, not the base chain: <c>ResearchProject</c>
        /// derives from nothing of RP-1's, and a base walk would fold in
        /// persistent fields of a base type the caller is not authoring
        /// for.</para>
        /// </remarks>
        public IReadOnlyList<string> FieldsWithAttribute(string typeFullName, string attributeFullName)
        {
            var names = new List<string>();
            if (!_types.TryGetValue(typeFullName, out var handle))
            {
                return names;
            }
            foreach (var fieldHandle in _md.GetTypeDefinition(handle).GetFields())
            {
                var field = _md.GetFieldDefinition(fieldHandle);
                foreach (var attributeHandle in field.GetCustomAttributes())
                {
                    if (AttributeTypeName(_md.GetCustomAttribute(attributeHandle)) == attributeFullName)
                    {
                        names.Add(_md.GetString(field.Name));
                        break;
                    }
                }
            }
            return names;
        }

        /// <summary>
        /// The full name of an attribute's own type, from whichever handle kind
        /// its constructor arrived as.
        /// </summary>
        private string? AttributeTypeName(CustomAttribute attribute)
        {
            switch (attribute.Constructor.Kind)
            {
                case HandleKind.MemberReference:
                {
                    var reference = _md.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
                    switch (reference.Parent.Kind)
                    {
                        case HandleKind.TypeReference:
                            return TypeReferenceName((TypeReferenceHandle)reference.Parent);
                        case HandleKind.TypeDefinition:
                            return FullName((TypeDefinitionHandle)reference.Parent);
                        default:
                            return null;
                    }
                }
                case HandleKind.MethodDefinition:
                    return FullName(_md.GetMethodDefinition(
                        (MethodDefinitionHandle)attribute.Constructor).GetDeclaringType());
                default:
                    return null;
            }
        }

        /// <summary>
        /// Whether a type name resolves in this assembly to an enum. Absent means
        /// the type is somebody else's (KSP's <c>SpaceCenterFacility</c> is the
        /// case that matters), which is not a failure and is reported as such.
        /// </summary>
        public bool? IsEnum(string typeFullName)
        {
            if (!_types.TryGetValue(typeFullName, out var handle))
            {
                return null;
            }
            var baseHandle = _md.GetTypeDefinition(handle).BaseType;
            return baseHandle.Kind == HandleKind.TypeReference
                && TypeReferenceName((TypeReferenceHandle)baseHandle) == "System.Enum";
        }

        private string TypeReferenceName(TypeReferenceHandle handle)
        {
            var reference = _md.GetTypeReference(handle);
            var ns = _md.GetString(reference.Namespace);
            var name = _md.GetString(reference.Name);
            return ns.Length == 0 ? name : ns + "." + name;
        }

        private string FullName(TypeDefinitionHandle handle)
        {
            var type = _md.GetTypeDefinition(handle);
            var name = _md.GetString(type.Name);
            if (type.IsNested)
            {
                return FullName(type.GetDeclaringType()) + "+" + name;
            }
            var ns = _md.GetString(type.Namespace);
            return ns.Length == 0 ? name : ns + "." + name;
        }

        public void Dispose()
        {
            _pe.Dispose();
            _stream.Dispose();
        }

        public enum MemberShape
        {
            Field,
            Property,
        }

        public sealed record MemberFacts(
            MemberShape Shape,
            string Name,
            string DeclaringType,
            string TypeName,
            bool IsStatic,
            bool IsPublic,
            bool IsWritable);

        public sealed record MethodFacts(
            string Name,
            string DeclaringType,
            ImmutableArray<string> ParameterTypes,
            string ReturnType,
            bool IsStatic,
            bool IsPublic);

        /// <summary>
        /// Renders a signature to the type's full name. Names only: a shape check
        /// compares what RP-1 declared against what the walk assumes, and both
        /// sides of that comparison are names.
        /// </summary>
        private sealed class SignatureNames : ISignatureTypeProvider<string, object?>
        {
            private readonly MetadataReader _md;

            public SignatureNames(MetadataReader md) => _md = md;

            public string GetArrayType(string elementType, ArrayShape shape) => elementType + "[]";
            public string GetByReferenceType(string elementType) => elementType + "&";
            public string GetFunctionPointerType(MethodSignature<string> signature) => "method*";
            public string GetGenericInstantiation(string genericType, ImmutableArray<string> arguments) =>
                genericType + "<" + string.Join(",", arguments) + ">";
            public string GetGenericMethodParameter(object? genericContext, int index) => "!!" + index;
            public string GetGenericTypeParameter(object? genericContext, int index) => "!" + index;
            public string GetModifiedType(string modifier, string unmodifiedType, bool isRequired) => unmodifiedType;
            public string GetPinnedType(string elementType) => elementType;
            public string GetPointerType(string elementType) => elementType + "*";
            public string GetSZArrayType(string elementType) => elementType + "[]";

            public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode switch
            {
                PrimitiveTypeCode.Boolean => "System.Boolean",
                PrimitiveTypeCode.Byte => "System.Byte",
                PrimitiveTypeCode.Char => "System.Char",
                PrimitiveTypeCode.Double => "System.Double",
                PrimitiveTypeCode.Int16 => "System.Int16",
                PrimitiveTypeCode.Int32 => "System.Int32",
                PrimitiveTypeCode.Int64 => "System.Int64",
                PrimitiveTypeCode.IntPtr => "System.IntPtr",
                PrimitiveTypeCode.Object => "System.Object",
                PrimitiveTypeCode.SByte => "System.SByte",
                PrimitiveTypeCode.Single => "System.Single",
                PrimitiveTypeCode.String => "System.String",
                PrimitiveTypeCode.TypedReference => "System.TypedReference",
                PrimitiveTypeCode.UInt16 => "System.UInt16",
                PrimitiveTypeCode.UInt32 => "System.UInt32",
                PrimitiveTypeCode.UInt64 => "System.UInt64",
                PrimitiveTypeCode.UIntPtr => "System.UIntPtr",
                PrimitiveTypeCode.Void => "System.Void",
                _ => typeCode.ToString(),
            };

            public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind)
            {
                var type = reader.GetTypeDefinition(handle);
                var name = reader.GetString(type.Name);
                if (type.IsNested)
                {
                    return GetTypeFromDefinition(reader, type.GetDeclaringType(), rawTypeKind) + "+" + name;
                }
                var ns = reader.GetString(type.Namespace);
                return ns.Length == 0 ? name : ns + "." + name;
            }

            public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind)
            {
                var reference = reader.GetTypeReference(handle);
                var ns = reader.GetString(reference.Namespace);
                var name = reader.GetString(reference.Name);
                if (reference.ResolutionScope.Kind == HandleKind.TypeReference)
                {
                    return GetTypeFromReference(reader, (TypeReferenceHandle)reference.ResolutionScope, rawTypeKind)
                        + "+" + name;
                }
                return ns.Length == 0 ? name : ns + "." + name;
            }

            public string GetTypeFromSpecification(
                MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind) =>
                reader.GetTypeSpecification(handle).DecodeSignature(this, genericContext);
        }
    }
}
