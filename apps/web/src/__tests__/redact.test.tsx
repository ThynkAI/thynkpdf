import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
import { undo, redo, clearHistory } from "@/lib/history";
import { useRedact, toApiMarks, matchesToMarks, dedupe, addMarks, removeMarks, deleteSelectedMarks, markWholePages, reportText, summary, type RedactMark } from "@/lib/redact";
import { redactGate } from "@/components/RedactPanel";
import { RedactApplyDialog } from "@/components/RedactApplyDialog";
import { parseTool, toolAction } from "@/lib/tools";
import { TOOL_CATALOG } from "@/lib/toolCatalog";

const ref = { document_id: "doc-1", version_id: "v1", version: 1 };
const mark = (p: number, x: number): RedactMark => ({ id: `m${p}-${x}`, page: p, rect: { x, y: 700, width: 50, height: 12 }, kind: "area", label: "a" });

beforeEach(() => {
  clearHistory();
  useSession.setState({ ref, source: "backend", busy: null });
  useRedact.setState({ docId: null, marks: [], selected: [], tool: null, images: null, imagesFor: null });
});

describe("redaction marks (pure)", () => {
  it("converts marks to API rects (1-based pages, x0,y0,x1,y1) and whole pages", () => {
    expect(toApiMarks([mark(0, 72), { id: "p", page: 2, rect: null, kind: "page", label: "" }])).toEqual([
      { page: 1, rect: [72, 700, 122, 712] }, { page: 3, whole_page: true }]);
  });
  it("turns search matches into one mark per line box", () => {
    const ms = matchesToMarks([{ page: 2, text: "Jane Doe", kind: "query", rects: [[10, 20, 60, 32], [10, 5, 30, 17]] }]);
    expect(ms).toHaveLength(2);
    expect(ms[0]).toMatchObject({ page: 1, kind: "search", label: "Jane Doe", rect: { x: 10, y: 20, width: 50, height: 12 } });
  });
  it("dedupes identical boxes and repeated whole pages", () => {
    const a = mark(0, 72);
    expect(dedupe([a], [{ ...a, id: "other" }, mark(0, 300)])).toHaveLength(1);
    expect(dedupe([{ id: "x", page: 1, rect: null, kind: "page", label: "" }], [{ id: "y", page: 1, rect: null, kind: "page", label: "" }])).toEqual([]);
  });
  it("summarises the engine report", () => {
    expect(reportText({ glyphs_removed: 21, images_redacted: 1, paths_removed: 2, whole_pages: [2], sanitized: { metadata: "x" } }, "Done."))
      .toBe("Redaction applied: removed 21 characters, 1 image, 2 drawings, 1 whole page. Hidden information removed. Done.");
    expect(summary([mark(0, 1), mark(0, 100), mark(3, 1)])).toBe("3 marks on 2 pages");
  });
});

describe("redaction marks (review list + undo)", () => {
  it("add, delete selected and Ctrl+Z / redo", async () => {
    addMarks([mark(0, 72), mark(1, 72)]);
    expect(useRedact.getState().marks).toHaveLength(2);
    expect(useRedact.getState().docId).toBe("doc-1");
    useRedact.getState().set({ selected: ["m0-72"] });
    expect(deleteSelectedMarks()).toBe(1);
    expect(useRedact.getState().marks.map((m) => m.id)).toEqual(["m1-72"]);
    await undo(); expect(useRedact.getState().marks).toHaveLength(2);
    await undo(); expect(useRedact.getState().marks).toHaveLength(0);
    await redo(); expect(useRedact.getState().marks).toHaveLength(2);
    removeMarks(["m1-72"]); markWholePages([4]);
    expect(useRedact.getState().marks.map((m) => [m.page, m.kind])).toEqual([[0, "area"], [4, "page"]]);
  });
  it("marks are bound to the open document", async () => {
    addMarks([mark(0, 72)]);
    useSession.setState({ ref: { ...ref, document_id: "doc-2" } });
    addMarks([mark(0, 300)]);
    expect(useRedact.getState().marks.map((m) => m.id)).toEqual(["m0-300"]);
    await undo(); expect(useRedact.getState().marks).toHaveLength(0);
    expect(await undo()).toBeNull(); // the doc-1 step is dropped, not applied to doc-2
  });
  it("gate: needs the engine and a current version", () => {
    expect(redactGate({ ref, source: "backend", busy: null, backend: "online" }).enabled).toBe(true);
    expect(redactGate({ ref: null, source: "local", busy: null, backend: "offline" }).reason).toMatch(/engine/);
    expect(redactGate({ ref: null, source: "backend", busy: null, backend: "online" }).reason).toMatch(/read-only/);
    expect(redactGate({ ref, source: "backend", busy: "x", backend: "online" }).enabled).toBe(false);
  });
});

describe("apply dialog", () => {
  it("requires explicit acknowledgement and defaults to a new file", async () => {
    useViewerStore.getState().setDocument({} as never, "Contract.pdf", [{ width: 612, height: 792 }]);
    addMarks([mark(0, 72)]);
    render(<RedactApplyDialog onClose={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/permanently removes/);
    expect(screen.getByLabelText(/As a new file/)).toBeChecked();
    expect(screen.getByLabelText("New file name")).toHaveValue("Contract-redacted.pdf");
    expect(screen.getByTestId("redact-hidden")).toBeChecked();
    expect(screen.getByLabelText(/Black box/)).toBeChecked();
    const go = screen.getByTestId("redact-confirm");
    expect(go).toBeDisabled();
    await userEvent.click(screen.getByTestId("redact-ack"));
    expect(go).toBeEnabled();
    await userEvent.click(screen.getByLabelText(/As a new version/));
    expect(screen.getByText(/Earlier versions/)).toBeInTheDocument();
  });
});

describe("tools", () => {
  it("has Redact / Add image / Images to PDF / Export images tiles and deep links", () => {
    expect(TOOL_CATALOG.map((t) => t.id)).toEqual(expect.arrayContaining(["redact", "add-image", "image-to-pdf", "export-images"]));
    expect(TOOL_CATALOG).toHaveLength(12);
    expect(parseTool("?tool=redaction")).toBe("redact");
    expect(parseTool("?tool=images-to-pdf")).toBe("image-to-pdf");
    expect(toolAction("redact")).toEqual({ panelSection: "rd-h", redact: true });
    expect(toolAction("image-to-pdf").needsDoc).toBe(false);
  });
});
