import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

// Smoke test for the test toolchain itself: jsdom, the React plugin, the
// jest-dom matchers and the "@/" path alias all have to work before any of the
// game-logic tests in phase 4 can be trusted.
describe("toolchain", () => {
  it("renders a component through the @/ alias with jest-dom matchers", () => {
    render(<Button>Up</Button>);

    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();
  });
});
