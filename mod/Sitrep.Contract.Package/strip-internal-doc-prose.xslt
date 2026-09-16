<?xml version="1.0" encoding="utf-8"?>
<!--
  Drops every <internal> subtree from a compiler-generated XML doc file on the
  way into the NuGet package.

  A Sitrep.Contract doc comment has two audiences and only one of them is a
  client: what the value IS belongs on the published surface, WHY it is that way
  belongs beside the type (see CLAUDE.md, "Contract doc comments"). `RtDocText`
  already drops these subtrees on the way to TSDoc and asyncapi.yaml, so the
  published TypeScript half never carried them; the XML doc file shipped beside
  the assembly is the same published surface for the C# half, and would
  otherwise put 29 maintainer paragraphs into an Uplink author's IntelliSense.

  Identity transform minus one element, deliberately: anything else the compiler
  emits passes through untouched, so a new doc tag needs no change here.

  `scripts/nuget-contract-package-gate.mjs` fails the build if an <internal>
  survives into the packed .xml, which is what makes this file's failure visible
  rather than silent.
-->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes" encoding="utf-8" />

  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()" />
    </xsl:copy>
  </xsl:template>

  <xsl:template match="internal" />
</xsl:stylesheet>
