import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RecommendationPanel, {
  RECOMMENDATION_UNAVAILABLE_MESSAGE,
  type AdvisorOutcome,
} from "./RecommendationPanel";
import type { RecommendationVerifyPayload } from "@/types/emissions";

const FABRICATED_BODY = "Bayar denda sebesar 999999999 tCO2e sesuai Pasal 18.";

function verify(overrides: Partial<RecommendationVerifyPayload> = {}): RecommendationVerifyPayload {
  return {
    flagged: false,
    unsupported: [],
    citations: [],
    body: "Rekomendasi: pertahankan posisi surplus saat ini.",
    model: "claude-opus-5",
    placeholderCitations: true,
    ...overrides,
  };
}

describe("RecommendationPanel", () => {
  it('shows "menyusun rekomendasi" while the pipeline is still running', () => {
    render(<RecommendationPanel outcome={{ kind: "pending" }} />);
    expect(screen.getByText(/Menyusun rekomendasi/)).toBeInTheDocument();
    expect(screen.queryByTestId("recommendation-body")).not.toBeInTheDocument();
  });

  it("shows the exact fallback message when unavailable, fabricating nothing", () => {
    render(<RecommendationPanel outcome={{ kind: "unavailable" }} />);
    expect(screen.getByTestId("recommendation-unavailable")).toHaveTextContent(
      RECOMMENDATION_UNAVAILABLE_MESSAGE,
    );
    expect(screen.queryByTestId("recommendation-body")).not.toBeInTheDocument();
  });

  it("never renders a flagged body as advice -- only the warning, with the unsupported figures named", () => {
    const outcome: AdvisorOutcome = {
      kind: "ready",
      verify: verify({ flagged: true, unsupported: ["999999999"], body: FABRICATED_BODY }),
    };
    render(<RecommendationPanel outcome={outcome} />);

    const warning = screen.getByTestId("recommendation-flagged-warning");
    expect(warning).toHaveTextContent(
      "Rekomendasi ini memuat angka yang tidak berasal dari perhitungan sistem dan " +
        "tidak ditampilkan sebagai saran eksekusi. Angka bermasalah: 999999999",
    );

    // The fabricated body must not appear anywhere in the document, not
    // even alongside the warning -- a reader takes the number and ignores
    // the caveat if it's shown "with a warning above".
    expect(screen.queryByTestId("recommendation-body")).not.toBeInTheDocument();
    expect(screen.queryByText(FABRICATED_BODY)).not.toBeInTheDocument();
  });

  it("lists every unsupported token when several numerals are fabricated", () => {
    const outcome: AdvisorOutcome = {
      kind: "ready",
      verify: verify({ flagged: true, unsupported: ["12345", "67890"] }),
    };
    render(<RecommendationPanel outcome={outcome} />);
    expect(screen.getByTestId("recommendation-flagged-warning")).toHaveTextContent(
      "Angka bermasalah: 12345, 67890",
    );
  });

  it("renders the body and citation chips for a clean, non-flagged recommendation", () => {
    const outcome: AdvisorOutcome = {
      kind: "ready",
      verify: verify({ citations: ["Permen ESDM 16/2022 Pasal 18"], placeholderCitations: false }),
    };
    render(<RecommendationPanel outcome={outcome} />);
    expect(screen.getByTestId("recommendation-body")).toHaveTextContent(
      "Rekomendasi: pertahankan posisi surplus saat ini.",
    );
    expect(screen.getByTestId("citation-chip")).toHaveTextContent("Permen ESDM 16/2022 Pasal 18");
  });

  it("marks every citation chip as not-yet-authoritative when placeholderCitations is true, with a visible marker on the chip and a plain-language note (not a tooltip)", () => {
    const outcome: AdvisorOutcome = {
      kind: "ready",
      verify: verify({
        citations: ["Permen ESDM 16/2022 Pasal 18", "Perpres 98/2021 Pasal 47"],
        placeholderCitations: true,
      }),
    };
    render(<RecommendationPanel outcome={outcome} />);

    const chips = screen.getAllByTestId("citation-chip");
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip).toHaveAttribute("data-placeholder", "true");
    }
    // Visible marker on each chip -- not hidden in a `title` attribute.
    expect(screen.getAllByTestId("citation-unverified-badge")).toHaveLength(2);
    expect(screen.getAllByTestId("citation-unverified-badge")[0]).toHaveTextContent(
      "Belum terverifikasi",
    );

    // Plain-language note rendered as real DOM text, not a tooltip.
    const note = screen.getByTestId("placeholder-citation-note");
    expect(note).toHaveTextContent(/belum dapat diverifikasi/);
    expect(note.tagName).not.toBe("TITLE");

    // Expanding a chip must not fabricate verbatim clause text that was
    // never sent over the wire -- it must say plainly that none is
    // available, reiterating the non-authoritative status.
    fireEvent.click(chips[0]);
    const expansion = screen.getByTestId("citation-expansion");
    expect(expansion).toHaveTextContent(/belum dapat diverifikasi/);
    expect(expansion).toHaveTextContent(/TIDAK dapat dianggap/);
  });

  it("omits the placeholder marker and note once citations carry real, non-placeholder text", () => {
    const outcome: AdvisorOutcome = {
      kind: "ready",
      verify: verify({ citations: ["Permen ESDM 16/2022 Pasal 18"], placeholderCitations: false }),
    };
    render(<RecommendationPanel outcome={outcome} />);
    expect(screen.queryByTestId("citation-unverified-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("placeholder-citation-note")).not.toBeInTheDocument();
    expect(screen.getByTestId("citation-chip")).toHaveAttribute("data-placeholder", "false");
  });
});
