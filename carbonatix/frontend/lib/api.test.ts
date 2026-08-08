import { afterEach, describe, expect, it, vi } from "vitest";
import { postDocument, streamRecommendation } from "./api";
import type { RecommendationEvent } from "@/types/emissions";

/**
 * Direct tests for `streamRecommendation`'s hand-rolled SSE frame parser
 * (`fetch` + `ReadableStream` + `TextDecoder` + manual `\n\n` splitting).
 *
 * Every other test touching this generator (`app/dashboard/page.test.tsx`,
 * `components/advisor/*.test.tsx`) mocks `streamRecommendation` itself at
 * the module boundary and never actually runs this parsing code -- these
 * are the only tests that do, stubbing `fetch` with a synthetic
 * `ReadableStream` instead.
 */

vi.mock("./supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
    },
  }),
}));

/** A `ReadableStream<Uint8Array>` that hands out exactly the given chunks,
 * one per `read()` call -- lets a test control precisely where a chunk
 * boundary falls, including mid-frame and mid-UTF-8-sequence. */
function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]);
      i += 1;
    },
  });
}

function encode(...parts: string[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return parts.map((p) => encoder.encode(p));
}

function stubFetchWithStream(stream: ReadableStream<Uint8Array>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
      text: async () => "",
    }),
  );
}

async function collect(runId = "run-1"): Promise<RecommendationEvent[]> {
  const out: RecommendationEvent[] = [];
  for await (const event of streamRecommendation(runId)) {
    out.push(event);
  }
  return out;
}

const EVENT_A: RecommendationEvent = {
  stage: "retrieve",
  status: "done",
  payload: { refs: ["Perpres 98/2021 Pasal 47"] },
  placeholderCitations: true,
};

const EVENT_B: RecommendationEvent = {
  stage: "assemble",
  status: "running",
  payload: null,
  placeholderCitations: true,
};

describe("streamRecommendation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer token from the current Supabase session", async () => {
    stubFetchWithStream(streamFromChunks(encode(`data: ${JSON.stringify(EVENT_A)}\n\n`)));
    await collect();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/runs/run-1/recommendation"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("parses a single data: frame delivered in one chunk", async () => {
    stubFetchWithStream(streamFromChunks(encode(`data: ${JSON.stringify(EVENT_A)}\n\n`)));
    expect(await collect()).toEqual([EVENT_A]);
  });

  it("reassembles one JSON payload split across two read() chunks -- the case the buffer exists for", async () => {
    const full = `data: ${JSON.stringify(EVENT_A)}\n\n`;
    const splitAt = Math.floor(full.length / 2);
    stubFetchWithStream(
      streamFromChunks(encode(full.slice(0, splitAt), full.slice(splitAt))),
    );
    expect(await collect()).toEqual([EVENT_A]);
  });

  it("decodes a multi-byte UTF-8 character split across a chunk boundary", async () => {
    // U+2014 EM DASH encodes to 3 bytes in UTF-8 -- splitting inside that
    // sequence is exactly what `{ stream: true }` on `TextDecoder.decode`
    // exists to hold back until the rest of the bytes arrive.
    const event: RecommendationEvent = {
      stage: "synthesise",
      status: "done",
      payload: { body: "Posisi karbon — status surplus" },
      placeholderCitations: true,
    };
    const full = `data: ${JSON.stringify(event)}\n\n`;
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(full);
    const dashByteOffset = encoder.encode(full.slice(0, full.indexOf("—"))).length;
    // Split one byte into the 3-byte em-dash sequence.
    const splitAt = dashByteOffset + 1;
    stubFetchWithStream(
      streamFromChunks([fullBytes.slice(0, splitAt), fullBytes.slice(splitAt)]),
    );
    expect(await collect()).toEqual([event]);
  });

  it("parses several frames arriving in a single chunk", async () => {
    stubFetchWithStream(
      streamFromChunks(
        encode(`data: ${JSON.stringify(EVENT_A)}\n\ndata: ${JSON.stringify(EVENT_B)}\n\n`),
      ),
    );
    expect(await collect()).toEqual([EVENT_A, EVENT_B]);
  });

  it("normalises CRLF frame terminators (SSE permits CRLF; a proxy could rewrite line endings)", async () => {
    stubFetchWithStream(streamFromChunks(encode(`data: ${JSON.stringify(EVENT_A)}\r\n\r\n`)));
    expect(await collect()).toEqual([EVENT_A]);
  });

  it("drops an unterminated trailing partial frame without throwing", async () => {
    const complete = `data: ${JSON.stringify(EVENT_A)}\n\n`;
    const partial = `data: {"stage":"assemble","status":"running"`; // never closed with \n\n
    stubFetchWithStream(streamFromChunks(encode(complete + partial)));
    // The complete frame is still yielded; the dangling partial is silently
    // dropped rather than throwing or yielding a half-parsed event -- see
    // `lib/api.ts`'s comment on the deliberate accept-loss choice.
    expect(await collect()).toEqual([EVENT_A]);
  });

  it("skips a malformed frame without killing the rest of the stream", async () => {
    const malformed = "data: {not valid json\n\n";
    const good = `data: ${JSON.stringify(EVENT_B)}\n\n`;
    stubFetchWithStream(streamFromChunks(encode(malformed + good)));
    expect(await collect()).toEqual([EVENT_B]);
  });
});

describe("postDocument timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes an AbortSignal to fetch and aborts it after exactly 120 seconds", async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: {
      ok: boolean;
      json: () => Promise<{ candidates: never[]; confidenceIsPlaceholder: boolean }>;
    }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const request = postDocument(
      new File(["document"], "document.pdf", { type: "application/pdf" }),
      "operational",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(init?.signal?.aborted).toBe(true);

    resolveFetch({
      ok: true,
      json: async () => ({ candidates: [], confidenceIsPlaceholder: true }),
    });
    await request;
  });

  it("clears the timeout after a successful response", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [], confidenceIsPlaceholder: true }),
      }),
    );

    await postDocument(
      new File(["document"], "document.pdf", { type: "application/pdf" }),
      "operational",
    );

    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout when fetch rejects", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed")));

    await expect(
      postDocument(
        new File(["document"], "document.pdf", { type: "application/pdf" }),
        "operational",
      ),
    ).rejects.toThrow("network failed");

    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
