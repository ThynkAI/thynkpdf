import { filterDocs } from "@/lib/docFilter";
const d = (filename: string, created_at: string) => ({ document_id: filename, filename, current_version: 1, version_id: "v", created_at });
const docs = [d("b.pdf", "2026-01-02"), d("Alpha.pdf", "2026-01-03"), d("c-report.pdf", "2026-01-01")];
describe("filterDocs", () => {
  it("filters case-insensitively", () => expect(filterDocs(docs, "ALP", "created_desc").map((x) => x.filename)).toEqual(["Alpha.pdf"]));
  it("sorts", () => {
    expect(filterDocs(docs, "", "created_desc").map((x) => x.filename)).toEqual(["Alpha.pdf", "b.pdf", "c-report.pdf"]);
    expect(filterDocs(docs, "", "name_desc")[0].filename).toBe("c-report.pdf");
  });
});
