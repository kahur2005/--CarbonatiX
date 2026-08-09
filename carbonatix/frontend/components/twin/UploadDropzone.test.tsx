import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadDropzone, { type FieldMeta } from "./UploadDropzone";
import { postDocument } from "@/lib/api";
import type { DocumentExtractionResult } from "@/types/emissions";

const EMPTY_GUIDANCE =
  "Dokumen berhasil dibaca, tetapi tidak ada medan yang dicari ditemukan di dalamnya. Masukkan nilai secara manual.";

// `UploadDropzone` is shared between onboarding and every twin node panel.
// Upload is the explicit user action: readable candidates auto-fill form
// state; nulls stay blank; nothing writes the DB from this component.
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
async function uploadDummyFile(container: HTMLElement, name = "doc.png") {
  const user = userEvent.setup();
  const file = new File(["dummy"], name, { type: "image/png" });
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input not found");
  await user.upload(input, file);
  return user;
}

describe("UploadDropzone", () => {
  beforeEach(() => {
    vi.mocked(postDocument).mockReset();
  });

  it('an unreadable candidate (value === null) renders "Tidak terbaca" and does not call onAccept', async () => {
    const result: DocumentExtractionResult = {
      candidates: [
        {
          field: "wet_ore_input_tons",
          value: null,
          confidence: 0,
          node: "stockpile",
          sourceHint: "",
          basis: null,
          evidence: "",
          derivation: "",
        },
      ],
      confidenceIsPlaceholder: true,
    };
    vi.mocked(postDocument).mockResolvedValue(result);
    const onAccept = vi.fn();
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={onAccept} />,
    );

    await uploadDummyFile(container);

    const readings = await waitFor(() => screen.getAllByText("Tidak terbaca"));
    expect(readings.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "Terima" })).not.toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("auto-applies readable candidates after upload; nulls do not call onAccept", async () => {
    const result: DocumentExtractionResult = {
      candidates: [
        {
          field: "moisture_content_pct",
          value: 0.32,
          confidence: 0.75,
          node: "stockpile",
          sourceHint: "",
          basis: "transcribed",
          evidence: "Kadar air 32%",
          derivation: "",
        },
        {
          field: "wet_ore_input_tons",
          value: null,
          confidence: 0,
          node: "stockpile",
          sourceHint: "",
          basis: null,
          evidence: "",
          derivation: "",
        },
      ],
      confidenceIsPlaceholder: true,
    };
    vi.mocked(postDocument).mockResolvedValue(result);
    const onAccept = vi.fn();
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={onAccept} />,
    );

    await uploadDummyFile(container);

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
    expect(onAccept).toHaveBeenCalledWith("moisture_content_pct", 32);
    expect(screen.queryByRole("button", { name: "Terima" })).not.toBeInTheDocument();
    expect(screen.getByText("Diterima")).toBeInTheDocument();
    expect(screen.getAllByText("Tidak terbaca").length).toBeGreaterThan(0);
  });

  it('Perbaiki clears the field via onClear and shows manual-entry status', async () => {
    vi.mocked(postDocument).mockResolvedValue({
      candidates: [
        {
          field: "moisture_content_pct",
          value: 0.32,
          confidence: 0.75,
          node: "stockpile",
          sourceHint: "",
          basis: "transcribed",
          evidence: "Kadar air 32%",
          derivation: "",
        },
      ],
      confidenceIsPlaceholder: true,
    });
    const onAccept = vi.fn();
    const onClear = vi.fn();
    const { container } = render(
      <UploadDropzone
        profile="operational"
        fieldLabels={FIELD_LABELS}
        onAccept={onAccept}
        onClear={onClear}
      />,
    );

    const user = await uploadDummyFile(container);
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Perbaiki" }));
    expect(onClear).toHaveBeenCalledWith("moisture_content_pct");
    expect(screen.getByText("Isi manual di bawah")).toBeInTheDocument();
  });

  it('labels a derived candidate with "Dihitung, bukan dibaca" and shows its exact derivation', async () => {
    vi.mocked(postDocument).mockResolvedValue({
      candidates: [
        {
          field: "wet_ore_input_tons",
          value: 1250,
          confidence: 0.75,
          node: "stockpile",
          sourceHint: "Ringkasan produksi",
          basis: "derived",
          evidence: "50 ton/jam selama 25 jam",
          derivation: "50 ton/jam × 25 jam = 1.250 ton",
        },
      ],
      confidenceIsPlaceholder: true,
    });
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container);

    expect(await screen.findByText("Dihitung, bukan dibaca")).toBeInTheDocument();
    expect(screen.getByText("50 ton/jam × 25 jam = 1.250 ton")).toBeInTheDocument();
  });

  it("does not label a transcribed candidate as derived or show a derivation", async () => {
    vi.mocked(postDocument).mockResolvedValue({
      candidates: [
        {
          field: "wet_ore_input_tons",
          value: 1250,
          confidence: 0.75,
          node: "stockpile",
          sourceHint: "Tabel penerimaan",
          basis: "transcribed",
          evidence: "Bijih basah masuk: 1.250 ton",
          derivation: "",
        },
      ],
      confidenceIsPlaceholder: true,
    });
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container);

    expect(await screen.findByText("1250 ton")).toBeInTheDocument();
    expect(screen.queryByText("Dihitung, bukan dibaca")).not.toBeInTheDocument();
  });

  it("shows manual-entry guidance after a successful response with no candidates", async () => {
    vi.mocked(postDocument).mockResolvedValue({
      candidates: [],
      confidenceIsPlaceholder: true,
    });
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    expect(screen.queryByText(EMPTY_GUIDANCE)).not.toBeInTheDocument();
    await uploadDummyFile(container);

    expect(await screen.findByText(EMPTY_GUIDANCE)).toBeInTheDocument();
  });

  it("shows manual-entry guidance when every candidate is unreadable", async () => {
    vi.mocked(postDocument).mockResolvedValue({
      candidates: [
        {
          field: "wet_ore_input_tons",
          value: null,
          confidence: 0,
          node: "stockpile",
          sourceHint: "",
          basis: null,
          evidence: "",
          derivation: "",
        },
        {
          field: "moisture_content_pct",
          value: null,
          confidence: 0,
          node: "stockpile",
          sourceHint: "",
          basis: null,
          evidence: "",
          derivation: "",
        },
      ],
      confidenceIsPlaceholder: true,
    });
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container);

    expect(await screen.findByText(EMPTY_GUIDANCE)).toBeInTheDocument();
    expect(screen.getAllByText("Tidak terbaca").length).toBeGreaterThan(0);
  });

  it("does not show empty guidance when at least one candidate is readable", async () => {
    vi.mocked(postDocument).mockResolvedValue({
      candidates: [
        {
          field: "wet_ore_input_tons",
          value: null,
          confidence: 0,
          node: "stockpile",
          sourceHint: "",
          basis: null,
          evidence: "",
          derivation: "",
        },
        {
          field: "moisture_content_pct",
          value: 0.32,
          confidence: 0.75,
          node: "stockpile",
          sourceHint: "",
          basis: "transcribed",
          evidence: "Kadar air 32%",
          derivation: "",
        },
      ],
      confidenceIsPlaceholder: true,
    });
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container);

    expect(await screen.findByText("32 %")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_GUIDANCE)).not.toBeInTheDocument();
  });

  it("renders Bahasa manual-entry guidance when the upload request times out", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.mocked(postDocument).mockRejectedValue(abortError);
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Permintaan unggah habis waktu. Masukkan nilai secara manual.",
    );
  });

  it("does not show empty guidance while an upload is pending or after it fails", async () => {
    let rejectUpload!: (reason: Error) => void;
    vi.mocked(postDocument).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpload = reject;
        }),
    );
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container);
    expect(await screen.findByText("Membaca dokumen...")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_GUIDANCE)).not.toBeInTheDocument();

    rejectUpload(new Error("Dokumen gagal dibaca."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dokumen gagal dibaca.");
    expect(screen.queryByText(EMPTY_GUIDANCE)).not.toBeInTheDocument();
  });

  it("clears a prior successful-empty state when a second upload starts", async () => {
    let resolveSecond!: (result: DocumentExtractionResult) => void;
    vi.mocked(postDocument)
      .mockResolvedValueOnce({ candidates: [], confidenceIsPlaceholder: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container);
    expect(await screen.findByText(EMPTY_GUIDANCE)).toBeInTheDocument();

    await uploadDummyFile(container);
    expect(await screen.findByText("Membaca dokumen...")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_GUIDANCE)).not.toBeInTheDocument();

    resolveSecond({ candidates: [], confidenceIsPlaceholder: true });
    expect(await screen.findByText(EMPTY_GUIDANCE)).toBeInTheDocument();
  });

  it("ignores an earlier upload that resolves while a newer upload remains pending", async () => {
    let resolveFirst!: (result: DocumentExtractionResult) => void;
    let resolveSecond!: (result: DocumentExtractionResult) => void;
    vi.mocked(postDocument)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { container } = render(
      <UploadDropzone profile="operational" fieldLabels={FIELD_LABELS} onAccept={vi.fn()} />,
    );

    await uploadDummyFile(container, "upload-a.png");
    await uploadDummyFile(container, "upload-b.png");
    expect(screen.getByText("Membaca dokumen...")).toBeInTheDocument();

    await act(async () => {
      resolveFirst({ candidates: [], confidenceIsPlaceholder: true });
    });

    expect(screen.getByText("Membaca dokumen...")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_GUIDANCE)).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond({
        candidates: [
          {
            field: "moisture_content_pct",
            value: 0.4,
            confidence: 0.75,
            node: "stockpile",
            sourceHint: "Upload B",
            basis: "transcribed",
            evidence: "Kadar air 40%",
            derivation: "",
          },
        ],
        confidenceIsPlaceholder: true,
      });
    });

    expect(screen.queryByText("Membaca dokumen...")).not.toBeInTheDocument();
    expect(screen.getByText("40 %")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_GUIDANCE)).not.toBeInTheDocument();
  });
});
