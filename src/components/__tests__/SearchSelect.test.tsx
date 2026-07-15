import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import SearchSelect from "@/components/SearchSelect";

const options = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

describe("SearchSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current value label", () => {
    render(
      <SearchSelect value="BTCUSDT" options={options} allLabel="All" onChange={() => {}} />,
    );
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
  });

  it("shows the all-label when value is the all value", () => {
    render(
      <SearchSelect value="all" options={options} allLabel="All markets" onChange={() => {}} />,
    );
    expect(screen.getByText("All markets")).toBeInTheDocument();
  });

  it("opens and lists options on click", () => {
    render(
      <SearchSelect value="all" options={options} allLabel="All" onChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("SOLUSDT")).toBeInTheDocument();
  });

  it("calls onChange with the picked option and closes", () => {
    const onChange = vi.fn();
    render(
      <SearchSelect value="all" options={options} allLabel="All" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("ETHUSDT"));
    expect(onChange).toHaveBeenCalledWith("ETHUSDT");
  });

  it("filters options by typed query", () => {
    render(
      <SearchSelect value="all" options={options} allLabel="All" placeholder="Search" onChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "sol" } });
    expect(screen.getByText("SOLUSDT")).toBeInTheDocument();
    expect(screen.queryByText("BTCUSDT")).not.toBeInTheDocument();
  });

  it("omits the all option when hideAll is set", () => {
    render(
      <SearchSelect value="all" options={options} allLabel="All" onChange={() => {}} hideAll />,
    );
    fireEvent.click(screen.getByRole("button"));
    const dropdown = document.querySelector(".z-40") as HTMLElement;
    expect(dropdown).toBeTruthy();
    expect(within(dropdown).queryByText("All")).not.toBeInTheDocument();
    expect(within(dropdown).getByText("BTCUSDT")).toBeInTheDocument();
  });
});
