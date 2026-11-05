import {
  type ComponentDefinition,
  type TinyEssential,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { WidgetAtTileSize } from "./WidgetAtTileSize";

const ESSENTIALS: readonly TinyEssential[] = [
  { label: "Alt", value: value("m", 1200) },
  { label: "V/S", value: value("m/s", -12) },
];

const tiny = { title: "TEST", useEssentials: () => ESSENTIALS };

function widget(extra: Partial<ComponentDefinition> = {}): ComponentDefinition {
  return {
    id: "tile-test",
    name: "Tile test",
    description: "",
    tags: [],
    component: () => <p>the body</p>,
    ...extra,
  };
}

describe("WidgetAtTileSize", () => {
  const sized = widget({ tiny, minSize: { w: 4, h: 5 } });

  it("draws the tiny form below the widget's minSize", () => {
    render(<WidgetAtTileSize def={sized} id="t" w={3} h={5} />);
    expect(screen.getByText("TEST")).toBeInTheDocument();
    expect(screen.queryByText("the body")).toBeNull();
  });

  it("draws the full widget at its minSize and above", () => {
    const { unmount } = render(
      <WidgetAtTileSize def={sized} id="t" w={4} h={5} />,
    );
    expect(screen.getByText("the body")).toBeInTheDocument();
    unmount();

    render(<WidgetAtTileSize def={sized} id="t" w={8} h={9} />);
    expect(screen.getByText("the body")).toBeInTheDocument();
    expect(screen.queryByText("TEST")).toBeNull();
  });

  it("draws the full widget at every size when it declares no tiny mode", () => {
    render(<WidgetAtTileSize def={widget()} id="t" w={1} h={1} />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("draws the full widget before the grid has measured", () => {
    render(<WidgetAtTileSize def={sized} id="t" />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });

  it("follows a resize across the threshold in both directions", () => {
    const { rerender } = render(
      <WidgetAtTileSize def={sized} id="t" w={8} h={9} />,
    );
    rerender(<WidgetAtTileSize def={sized} id="t" w={2} h={2} />);
    expect(screen.getByText("TEST")).toBeInTheDocument();
    rerender(<WidgetAtTileSize def={sized} id="t" w={8} h={9} />);
    expect(screen.getByText("the body")).toBeInTheDocument();
  });
});
