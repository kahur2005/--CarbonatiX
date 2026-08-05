import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import NodeGraph, { PENDING_NODE_STATUSES, type NodeStatuses } from "./NodeGraph";

describe("NodeGraph", () => {
  it("renders all four stages pending, labeled in Bahasa Indonesia, before any event arrives", () => {
    render(<NodeGraph statuses={PENDING_NODE_STATUSES} />);

    expect(screen.getByTestId("node-retrieve")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("node-assemble")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("node-synthesise")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("node-verify")).toHaveAttribute("data-status", "pending");

    expect(screen.getByText("Ambil regulasi")).toBeInTheDocument();
    expect(screen.getByText("Rangkai angka")).toBeInTheDocument();
    expect(screen.getByText("Sintesis")).toBeInTheDocument();
    expect(screen.getByText("Verifikasi")).toBeInTheDocument();
  });

  it("shows a spinner only on the node currently running", () => {
    const statuses: NodeStatuses = {
      retrieve: "done",
      assemble: "running",
      synthesise: "pending",
      verify: "pending",
    };
    render(<NodeGraph statuses={statuses} />);

    expect(screen.getByTestId("node-assemble-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("node-retrieve-spinner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("node-synthesise-spinner")).not.toBeInTheDocument();
  });

  it("marks a failed stage distinctly from a done one, each with its own accessible status text", () => {
    const statuses: NodeStatuses = {
      retrieve: "done",
      assemble: "done",
      synthesise: "failed",
      verify: "pending",
    };
    render(<NodeGraph statuses={statuses} />);

    expect(screen.getByTestId("node-synthesise")).toHaveAttribute("data-status", "failed");
    expect(screen.getByTestId("node-synthesise")).toHaveAccessibleName("Sintesis: Gagal");
    expect(screen.getByTestId("node-assemble")).toHaveAccessibleName("Rangkai angka: Selesai");
  });

  it("reaches a terminal (non-pending, non-running) state for all four nodes on a normal completed run", () => {
    const statuses: NodeStatuses = {
      retrieve: "done",
      assemble: "done",
      synthesise: "done",
      verify: "done",
    };
    render(<NodeGraph statuses={statuses} />);

    for (const stage of ["retrieve", "assemble", "synthesise", "verify"]) {
      const status = screen.getByTestId(`node-${stage}`).getAttribute("data-status");
      expect(["done", "failed"]).toContain(status);
    }
  });
});
