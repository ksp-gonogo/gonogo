import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { registryIdentity, resolveUplinkIdentity } from "./identity";
import { UplinkIdentityBlock } from "./UplinkIdentityBlock";

const DECLARED = {
  name: "Widget Y",
  author: "A Stranger",
  repo: "https://example.invalid/stranger/widget-y",
};

describe("UplinkIdentityBlock", () => {
  it("shows the author and repo the mod vouched for", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", DECLARED, {})}
      />,
    );

    expect(screen.getByText("by A Stranger")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.invalid/stranger/widget-y"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vouched by the installed mod"),
    ).toBeInTheDocument();
  });

  /*
   * The deliverable: the same three values, declared by the bundle instead of
   * the mod, must be shown and must not read the same. Withholding them is the
   * behaviour this replaced; presenting them as checked is the thing that must
   * never happen instead.
   */
  it("shows the same values a bundle declared about itself, worded as its own claim", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", {}, DECLARED)}
      />,
    );

    expect(screen.getByText("by A Stranger")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.invalid/stranger/widget-y"),
    ).toBeInTheDocument();
    expect(screen.getByText("Calls itself “Widget Y”")).toBeInTheDocument();
    expect(
      screen.getByText("Self-declared by the bundle, unverified"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Vouched by the installed mod"),
    ).not.toBeInTheDocument();
  });

  it("does not repeat a vouched name, which the caller's own heading carries", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", DECLARED, {})}
      />,
    );
    expect(screen.queryByText(/Calls itself/)).not.toBeInTheDocument();
  });

  it("splits the reading when the mod named some fields and the bundle the rest", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity(
          "widget-y",
          { name: DECLARED.name, author: DECLARED.author },
          { repo: DECLARED.repo },
        )}
      />,
    );

    expect(
      screen.getByText(
        "Name and author vouched by the installed mod; " +
          "repo self-declared by the bundle, unverified",
      ),
    ).toBeInTheDocument();
  });

  it("says Hub-listed for an identity read out of the registry index", () => {
    render(
      <UplinkIdentityBlock
        identity={registryIdentity({ id: "widget-y", ...DECLARED })}
      />,
    );
    expect(
      screen.getByText("Listed in the app's built Uplink index"),
    ).toBeInTheDocument();
  });

  it("renders nothing at all when no source declared anything", () => {
    const { container } = render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", {}, {})}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders no author line for an Uplink that named a repo and no author", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity(
          "widget-y",
          { repo: DECLARED.repo },
          {},
        )}
      />,
    );
    expect(screen.queryByText(/^by /)).not.toBeInTheDocument();
  });

  /*
   * A repo an author wrote is an address to type into a browser, not a link to
   * click out of a consent surface, so the value is text.
   */
  it("does not make a self-declared repo clickable", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", {}, DECLARED)}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("announces the provenance when it arrives asynchronously", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", DECLARED, {})}
        live
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vouched by the installed mod",
    );
  });

  it("stays silent for a screen reader where nothing changed", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", DECLARED, {})}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  /*
   * The early signal. The operator is being asked whether to trust a bundle
   * they have not pulled yet, and the mod and the bundle naming it differently
   * is exactly what they need in front of them to answer. It informs rather
   * than refuses: `integrity` is what refuses, and these fields gate nothing.
   */
  it("shows the bundle's competing claim beside the one the mod vouched", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", DECLARED, {
          name: "Impostor",
          author: "Someone Else",
          repo: "https://example.invalid/impostor/widget-y",
        })}
      />,
    );

    expect(screen.getByText("by A Stranger")).toBeInTheDocument();
    expect(
      screen.getByText("Bundle's own name: “Impostor”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bundle's own author: “Someone Else”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bundle's own repo: “https://example.invalid/impostor/widget-y”",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the mod's value as the value it shows", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity(
          "widget-y",
          { author: "A Stranger" },
          { author: "Impostor" },
        )}
      />,
    );

    expect(screen.getByText("by A Stranger")).toBeInTheDocument();
    expect(screen.queryByText("by Impostor")).not.toBeInTheDocument();
    expect(
      screen.getByText("Vouched by the installed mod"),
    ).toBeInTheDocument();
  });

  it("says nothing about a bundle that agrees with the mod", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", DECLARED, DECLARED)}
      />,
    );

    expect(screen.queryByText(/Bundle's own/)).not.toBeInTheDocument();
  });

  it("shows a disputed name even where the block would otherwise render nothing", () => {
    render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity(
          "widget-y",
          { name: "Widget Y" },
          { name: "Impostor" },
        )}
      />,
    );

    expect(
      screen.getByText("Bundle's own name: “Impostor”"),
    ).toBeInTheDocument();
  });

  it("has no a11y violations", async () => {
    const { container } = render(
      <UplinkIdentityBlock
        identity={resolveUplinkIdentity("widget-y", {}, DECLARED)}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
