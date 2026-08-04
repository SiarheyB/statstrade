import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidebarProvider, useSidebar } from "@/lib/sidebar/provider";

function Consumer() {
  const { collapsed, toggle } = useSidebar();
  return (
    <div>
      <span data-testid="state">{collapsed ? "collapsed" : "expanded"}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

describe("SidebarProvider / useSidebar", () => {
  it("throws when used outside provider", () => {
    // Suppress React's console.error noise for the expected render error.
    const consoleSpy = { restore: () => {} };
    expect(() => render(<Consumer />)).toThrow(
      "useSidebar must be used within SidebarProvider",
    );
    void consoleSpy;
  });

  it("provides default collapsed=false and toggles on demand", () => {
    render(
      <SidebarProvider>
        <Consumer />
      </SidebarProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("expanded");
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("state").textContent).toBe("collapsed");
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("state").textContent).toBe("expanded");
  });
});
