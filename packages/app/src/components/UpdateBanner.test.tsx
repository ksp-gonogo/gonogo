import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLatestRelease } from "../settings/releaseCheck";
import { VERSION } from "../version";
import { UpdateBanner } from "./UpdateBanner";

function answer(tag: string | null, url = "https://example.test/notes") {
  const fetchMock = vi.fn(async () =>
    tag === null
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify({ tag_name: tag, html_url: url }), {
          status: 200,
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mount() {
  const view = render(<UpdateBanner />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  __resetLatestRelease();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpdateBanner", () => {
  it("names a newer release and links to its notes", async () => {
    answer("v99.0.0");
    await mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Gonogo 99.0.0 is available",
    );
    expect(screen.getByRole("link", { name: "Release notes" })).toHaveAttribute(
      "href",
      "https://example.test/notes",
    );
  });

  it("shows nothing for the same release", async () => {
    answer(`v${VERSION}`);
    const { container } = await mount();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing for an older release", async () => {
    answer("v0.0.0-older");
    const { container } = await mount();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the release cannot be known", async () => {
    answer(null);
    const { container } = await mount();
    expect(container).toBeEmptyDOMElement();
  });

  it("hides on dismiss, remembers it, and shows a newer release again", async () => {
    answer("v99.0.0");
    const first = await mount();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    const second = await mount();
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();

    __resetLatestRelease();
    answer("v99.0.1");
    await mount();
    expect(screen.getByRole("status")).toHaveTextContent("99.0.1");
  });

  it("asks GitHub once however many banners mount", async () => {
    const fetchMock = answer("v99.0.0");
    render(
      <>
        <UpdateBanner />
        <UpdateBanner />
      </>,
    );
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
