using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Tags a wire-payload type with the <c>Topic</c> id it is the payload for,
    /// so the TS-SDK codegen (see <c>mod/codegen.sh</c> and the generated
    /// <c>mod/sitrep-sdk/src/topics.ts</c>) can build the
    /// <c>TopicId -&gt; TopicPayload&lt;T&gt;</c> map by reflection instead of a
    /// hand-maintained lookup. Without this tag a Topic whose payload was only
    /// ever shaped ad-hoc in a <c>Sitrep.Host</c> <c>*ViewProvider</c> resolves
    /// to <c>unknown</c> in the SDK; carrying it on a named
    /// <c>Sitrep.Contract</c> type is what lets a widget code against a real
    /// payload type.
    ///
    /// <para>This is a TYPING/codegen marker only — it does NOT change the
    /// wire. The wire bytes are produced by <c>Sitrep.Core.Serialization.
    /// JsonWriter</c> walking the provider's live value tree, entirely
    /// independent of these contract POCOs; the tagged type just mirrors that
    /// existing serialized shape so codegen has something concrete to name.</para>
    ///
    /// <para>Lives IN <c>Sitrep.Contract</c> (like
    /// <see cref="SitrepContractAttribute"/>, and unlike the compile-time-only
    /// <c>[TsInterface]</c>) so anything reflecting over it — codegen or a
    /// future runtime map — never has to resolve an external assembly. It is
    /// therefore compiled into BOTH target frameworks (not guarded by
    /// <c>#if NETSTANDARD2_0</c>).</para>
    ///
    /// <para><see cref="IsArray"/> marks the payloads that are a BARE JSON
    /// array of the tagged element type rather than a single object — the
    /// <c>science.*</c> channels emit <c>ExperimentEntry[]</c> /
    /// <c>LabEntry[]</c> / <c>DeployedEntry[]</c> (or <c>null</c>), never a
    /// wrapper object — so the tag is applied to the ELEMENT type with
    /// <c>IsArray = true</c> and codegen maps the Topic's payload to
    /// <c>&lt;Element&gt;[]</c>.</para>
    /// </summary>
    [AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepTopicAttribute : Attribute
    {
        public string TopicId { get; }

        public bool IsArray { get; }

        public SitrepTopicAttribute(string topicId, bool isArray = false)
        {
            TopicId = topicId;
            IsArray = isArray;
        }
    }
}
