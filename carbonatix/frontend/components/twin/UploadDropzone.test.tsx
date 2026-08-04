import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadDropzone, { type FieldMeta } from "./UploadDropzone";
import { postDocument } from "@/lib/api";
import type { DocumentExtractionResult } from "@/types/emissions";

// `UploadDropzone` is shared between onboarding (Task 16) and every one of
// the twin's five node panels (Task 17); it implements the one rule that
// matters most in the whole ingestion pipeline -- "a candidate never
// populates a field without an explicit click" -- and until now was
// verified only by reading the code. These tests are that component's
// first DOM-level coverage.
vi.mock("@/lib/api", () => ({
  postDocument: vi.fn(),
}));

const FIELD_LABELS: Record<string, FieldMeta> = {
  wet_ore_input_tons: { label: "Bijih basah masuk", unit: "ton", isPercent: false },
  moisture_content_pct: { label: "Kadar air", unit: "%", isPercent: true },
};

/** Scoped to `container` (the render's own root), not the global
 * `document` -- an unscoped query can match another test's DOM if cleanup
 * ever regresses, silently uploading to the wrong component instance. */
async function uploadDummyFile(container: HTMLElement) {
  const user = userEvent.setup();
  const file = new File(["dummy"], "doc.png", { type: "image/png" });
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input not found");
  await user.upload(input, file);
  return user;
}

describe("UploadDropzone", () => {
  beforeEach(() => {
    vi.mocked(postDocument).mockReset();
  });

  it('an unreadable candidate (value === null) renders "Tidak terbaca" and offers no accept control', async () => {
    const result: DocumentExtractionResult = {
      candidates: [
        { field: "wet_ore_input_tons", value: null, confidence: 0, node: "stockpile", sourceHint: "" },
      ],
      confidenceIsPlaceholder: true,
    };
    vi.mocked(postDocument).mockResolvedValue(result);
    const onAccept = vi.fn();
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={onAccept} />,
    );

    await uploadDummyFile(container);

    // Both the value display and the readability badge read "Tidak
    // terbaca" for a null candidate -- there is nothing to accept.
    const readings = await waitFor(() => screen.getAllByText("Tidak terbaca"));
    expect(readings).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Terima" })).not.toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('clicking "Terima" populates the field exactly once, only in direct response to the click', async () => {
    const result: DocumentExtractionResult = {
      candidates: [
        {
          field: "moisture_content_pct",
          value: 0.32,
          confidence: 0.75,
          node: "stockpile",
          sourceHint: "",
        },
      ],
      confidenceIsPlaceholder: true,
    };
    vi.mocked(postDocument).mockResolvedValue(result);
    const onAccept = vi.fn();
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={onAccept} />,
    );

    const user = await uploadDummyFile(container);

    const acceptButton = await screen.findByRole("button", { name: "Terima" });
    // The candidate was returned and rendered, but onAccept must not have
    // fired yet -- only the click below may trigger it.
    expect(onAccept).not.toHaveBeenCalled();

    await user.click(acceptButton);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith("moisture_content_pct", 32);

    // A second render pass (e.g. a re-render from unrelated state) must not
    // re-fire it: the button is gone, replaced by a static "Diterima" label.
    expect(screen.queryByRole("button", { name: "Terima" })).not.toBeInTheDocument();
    expect(screen.getByText("Diterima")).toBeInTheDocument();
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
