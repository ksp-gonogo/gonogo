using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Tags a payload type with the Topic id it is the payload for, so the
    /// TypeScript SDK can map each <c>TopicId</c> to its typed payload. A Topic
    /// with no tagged type reads as <c>unknown</c> in the SDK.
    ///
    /// <para>This marks typing only and does not change the wire.
    /// <see cref="IsArray"/> marks a payload that is a bare JSON array of the
    /// tagged element type rather than a single object: the <c>science.*</c>
    /// channels emit <c>ExperimentEntry[]</c>, <c>LabEntry[]</c> or
    /// <c>DeployedEntry[]</c> (or <c>null</c>), so the tag sits on the element
    /// type with <c>IsArray = true</c>.</para>
    /// <internal>
    /// Codegen (mod/codegen.sh) reflects over this to build the
    /// TopicId -&gt; TopicPayload&lt;T&gt; map in mod/sitrep-sdk/src/topics.ts.
    /// The wire bytes come from JsonWriter walking the provider's live value
    /// tree; the tagged type mirrors that shape so codegen has something to
    /// name. Lives in Sitrep.Contract (unlike the codegen-only [TsInterface])
    /// and is not guarded by #if SITREP_CODEGEN, so anything reflecting over it
    /// never has to resolve an external assembly.
    /// </internal>
    /// </summary>
    /// <category>Channels and emission</category>
    [AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepTopicAttribute : Attribute
    {
        /// <summary>The Topic id the tagged type is the payload for, e.g. <c>"career.mode"</c>.</summary>
        public string TopicId { get; }

        /// <summary>
        /// <c>true</c> when the Topic's payload is a bare JSON array of the tagged
        /// type rather than one object of it. Defaults to <c>false</c>.
        /// </summary>
        public bool IsArray { get; }

        /// <summary>Tags the class as the payload of <paramref name="topicId"/>.</summary>
        /// <param name="topicId">The Topic id.</param>
        /// <param name="isArray">Whether the payload is a bare array of the tagged type.</param>
        public SitrepTopicAttribute(string topicId, bool isArray = false)
        {
            TopicId = topicId;
            IsArray = isArray;
        }
    }
}
