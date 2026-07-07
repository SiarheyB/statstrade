"use strict";

import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import RiskBanner from "./riskBanner";

// Mock the needed modules
vi.mock("@/lib/i18n/provider", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key.split(".")[1],
  })),
  locale: "ru",
});

vi.mock("@/lib/format", () => ({
  fmtUsd: (value: number) => value.toString(),
});

describe("RiskBanner", () => {
  const renderBanner = () => {
    userEvent.setup();
    // Create a component that wraps RiskBanner with a context provider
    const Wrapper: React.FC = () => {
      const [, setUserId] = useState("test-user");
      return (
        <div style={{ display: "hidden" }}>\n" +            }