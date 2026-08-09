import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MonthPicker from "./MonthPicker";
import { PeriodProvider } from "./PeriodProvider";
import { ThemeProvider } from "./ThemeProvider";
import { listProductionMonths } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  listProductionMonths: vi.fn(),
}));

function renderPicker() {
  return render(
    <ThemeProvider>
      <PeriodProvider>
        <MonthPicker />
      </PeriodProvider>
    </ThemeProvider>,
  );
}

describe("MonthPicker", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(listProductionMonths).mockReset().mockResolvedValue([
      { period: "2025-02", updatedAt: "2025-02-01T00:00:00Z", hasInputs: true },
    ]);
  });

  it("places a month dropdown that can select Januari 2025", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button", { name: "Pilih bulan produksi" }));
    expect(await screen.findByRole("option", { name: /Januari 2025/ })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Januari 2025/ }));
    expect(screen.getByRole("button", { name: "Pilih bulan produksi" })).toHaveTextContent(
      "Januari 2025",
    );
  });
});
