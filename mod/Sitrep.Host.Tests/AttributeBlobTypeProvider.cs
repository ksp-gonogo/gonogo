using System.Reflection.Metadata;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Minimal <see cref="ICustomAttributeTypeProvider{T}"/> for decoding an
    /// attribute blob whose fixed arguments are primitives, which is every
    /// attribute the shape gates read (<c>[SitrepTopic(string, bool)]</c>).
    /// The type-shaped members need only be well-formed, never meaningful.
    /// </summary>
    /// <remarks>
    /// Shared rather than nested in one test class: two gates now decode the
    /// same blob, and a second private copy is how the two would drift into
    /// disagreeing about what a topic tag says.
    /// </remarks>
    internal sealed class AttributeBlobTypeProvider : ICustomAttributeTypeProvider<string>
    {
        public static readonly AttributeBlobTypeProvider Instance = new();

        public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode.ToString();

        public string GetSystemType() => "System.Type";

        public string GetSZArrayType(string elementType) => elementType + "[]";

        public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) =>
            reader.GetString(reader.GetTypeDefinition(handle).Name);

        public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) =>
            reader.GetString(reader.GetTypeReference(handle).Name);

        public string GetTypeFromSerializedName(string name) => name;

        public PrimitiveTypeCode GetUnderlyingEnumType(string type) => PrimitiveTypeCode.Int32;

        public bool IsSystemType(string type) => type == "System.Type";
    }
}
