import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, groupXfaFields, splitSom, stripSomIndices, xfaLeafName, xfaInstancePath, type XfaSchemaOut, type XfaSchemaField } from "@thynkpdf/editor-client";
import { XfaSchemaForm } from "@/components/XfaSchemaForm";
import { classifyXfaError } from "@/lib/xfaConvert";

// Mirrors GET /pdf/{id}/forms/xfa/schema from backend PR #24.
const f = (o: Partial<XfaSchemaField> & { som: string }): XfaSchemaField => ({ name: null, type: "text", required: false, read_only: false, multiline: false, ...o } as XfaSchemaField);
const schema: XfaSchemaOut = {
  document_id: "d", version: 1, warnings: ["lr-tb layout rendered top-down"], scripts_ignored: 2,
  xfa: { present: true, kind: "dynamic", packets: ["template", "datasets"], has_scripts: true },
  fields: [
    f({ name: "form1.applicant.full_name", som: "form1[0].applicant[0].full_name[0]", caption: "Full name", required: true, value: "Jane" }),
    f({ name: "form1.applicant.notes", som: "form1[0].applicant[0].notes[0]", caption: "Notes", multiline: true }),
    f({ name: "form1.applicant.province", som: "form1[0].applicant[0].province[0]", type: "choice", caption: "Province", options: ["ON", "QC"], option_captions: ["Ontario", "Quebec"] }),
    f({ name: "form1.terms.agree", som: "form1[0].terms[0].agree[0]", type: "checkbox", caption: "I agree", on_value: "1", value: "0" }),
    f({ name: "form1.terms.sig", som: "form1[0].terms[0].sig[0]", type: "signature", caption: "Signature" }),
    f({ name: null, som: "form1[0].terms[0].calc[0]", caption: "Computed" }),
  ],
};

describe("XfaSchemaForm (mocked backend schema)", () => {
  it("groups flat fields into subforms and submits data-path keyed values", async () => {
    const onSubmit = vi.fn();
    render(<XfaSchemaForm schema={schema} onSubmit={onSubmit} />);
    expect(screen.getByText("applicant")).toBeInTheDocument();
    expect(screen.getByText("terms")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Jane");
    expect(screen.getByLabelText("Notes").tagName).toBe("TEXTAREA");
    expect(screen.getByRole("option", { name: "Ontario" })).toHaveValue("ON");
    expect(screen.getByText(/signature field — not editable/)).toBeInTheDocument();
    expect(screen.getByLabelText("Computed")).toBeDisabled();
    expect(screen.getByText(/scripts \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("lr-tb layout rendered top-down")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Full name"));
    await userEvent.type(screen.getByLabelText("Full name"), "Deep");
    await userEvent.selectOptions(screen.getByLabelText("Province"), "ON");
    await userEvent.click(screen.getByLabelText("I agree"));
    await userEvent.click(screen.getByRole("button", { name: "Save values (new version)" }));
    expect(onSubmit).toHaveBeenCalledWith({ "form1.applicant.full_name": "Deep", "form1.applicant.province": "ON", "form1.terms.agree": true });
  });
  it("hides Import/Export when unavailable; passes XML text when provided", async () => {
    const { rerender } = render(<XfaSchemaForm schema={schema} onSubmit={() => {}} />);
    expect(screen.queryByRole("button", { name: "Import data XML" })).toBeNull();
    const onImport = vi.fn(), onExport = vi.fn();
    rerender(<XfaSchemaForm schema={schema} onSubmit={() => {}} onImportXml={onImport} onExportXml={onExport} />);
    await userEvent.click(screen.getByRole("button", { name: "Export data XML" }));
    expect(onExport).toHaveBeenCalled();
    await userEvent.upload(screen.getByTestId("xfa-xml-input"), new File(["<xfa:data/>"], "d.xml", { type: "application/xml" }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith("<xfa:data/>", "merge"));
  });
  it("groupXfaFields drops the common root subform", () => {
    const g = groupXfaFields(schema.fields);
    expect(g.groups.map((x) => x.name)).toEqual(["applicant", "terms"]); // SOM-parent fallback (no `section` from older backend)
  });
  it("maps every backend XFA error to an honest message; 404 without doc code = not deployed", () => {
    for (const [st, code] of [[422, "XFA_NOT_PRESENT"], [422, "XFA_MALFORMED"], [422, "XFA_UNSAFE_XML"], [413, "XFA_TOO_LARGE"], [409, "VERSION_CONFLICT"]] as const)
      expect(classifyXfaError(new ApiError(st, code, "x")).outcome).toBe("known");
    const u = classifyXfaError(new ApiError(422, "xfa_dynamic_unsupported", "x", { unsupported: ["no root subform"] }));
    expect(u.message).toContain("no root subform");
    expect(classifyXfaError(new ApiError(404, "NOT_FOUND", "x")).outcome).toBe("unavailable");
    expect(classifyXfaError(new ApiError(404, "DOCUMENT_NOT_FOUND", "x")).outcome).toBe("failed");
  });

  // Mirrors the 363976fe contract: indexed som, section/section_name/section_caption, occur/instance, tooltip.
  const v2: XfaSchemaOut = {
    document_id: "d", version: 3, warnings: [], scripts_ignored: 0,
    xfa: { present: true, kind: "hybrid", packets: ["template", "datasets"], has_scripts: false },
    fields: [
      f({ name: "form1.Part1.ANumber", som: "form1[0].#subform[0].Part1[0].ANumber[0]", acroform_field: "form1[0].#subform[0].Part1[0].ANumber[0]", section: "form1[0].#subform[0].Part1[0]", section_name: "Part1", section_caption: "Part 1. Information About You", caption: "A-Number", tooltip: "Enter your 9-digit Alien Registration Number." }),
      f({ name: "form1.Section9\\.1.Note", som: "form1[0].Section9\\.1[0].Note[0]", section: "form1[0].Section9\\.1[0]", section_name: "Section9.1" }),
      f({ name: "form1.items.row[0].item", som: "form1[0].items[0].row[0].item[0]", section: "form1[0].items[0].row[0]", section_name: "row", section_caption: "Item", occur: { min: 1, max: 3, initial: 1 }, instance: 0, caption: "Item name", value: "Pen" }),
      f({ name: "form1.items.row[1].item", som: "form1[0].items[0].row[1].item[0]", section: "form1[0].items[0].row[1]", section_name: "row", section_caption: "Item", occur: { min: 1, max: 3, initial: 1 }, instance: 1, caption: "Item name", value: "Ink" }),
    ],
  };
  it("groups by backend section with captions, shows tooltips, handles indexed/escaped som", async () => {
    render(<XfaSchemaForm schema={v2} onSubmit={() => {}} />);
    expect(screen.getByText("Part 1. Information About You")).toBeInTheDocument();
    expect(screen.getByText("Section9.1")).toBeInTheDocument();
    const a = screen.getByLabelText("A-Number");
    expect(a).toHaveAttribute("title", "Enter your 9-digit Alien Registration Number.");
    expect(a).toHaveAccessibleDescription("Enter your 9-digit Alien Registration Number.");
    expect(screen.getByLabelText("Note")).toBeInTheDocument(); // leaf from escaped data path
    const g = groupXfaFields(v2.fields);
    expect(g.groups.map((x) => x.path)).toEqual(["form1[0].#subform[0]", "form1[0].Section9\\.1[0]", "form1[0].items[0]"]);
    expect(splitSom("form1[0].Section9\\.1[0].Note[0]")).toEqual(["form1[0]", "Section9\\.1[0]", "Note[0]"]);
    expect(stripSomIndices("form1[0].body[0].X[0]")).toBe("form1.body.X");
    expect(xfaLeafName({ name: null, som: "form1[0].#subform[2].#area[0].ANumber[0]" })).toBe("ANumber");
    expect(xfaInstancePath("app.row[1].item", "row", 2)).toBe("app.row[2].item");
  });
  it("repeat instances: numbered, Add creates the next indexed instance up to occur.max, fill keys are indexed", async () => {
    const onSubmit = vi.fn();
    render(<XfaSchemaForm schema={v2} onSubmit={onSubmit} />);
    expect(screen.getByText("Item (1 of 2)")).toBeInTheDocument();
    expect(screen.getByText("Item (2 of 2)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Add Item" }));
    expect(screen.getByText("Item (3 of 3)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add Item" })).toBeNull();
    expect(screen.getByText("Maximum of 3 Item reached.")).toBeInTheDocument();
    const items = screen.getAllByLabelText("Item name");
    expect(items[2]).toHaveValue("");
    expect(items[2].closest("[data-som]")).toHaveAttribute("data-som", "form1[0].items[0].row[2].item[0]");
    await userEvent.type(items[2], "Cap");
    await userEvent.click(screen.getByRole("button", { name: "Save values (new version)" }));
    expect(onSubmit).toHaveBeenCalledWith({ "form1.items.row[2].item": "Cap" });
  });
  it("Import data XML defaults to merge and can switch to replace", async () => {
    const onImport = vi.fn();
    render(<XfaSchemaForm schema={v2} onSubmit={() => {}} onImportXml={onImport} />);
    expect(screen.getByLabelText("Import mode")).toHaveValue("merge");
    await userEvent.selectOptions(screen.getByLabelText("Import mode"), "replace");
    await userEvent.upload(screen.getByTestId("xfa-xml-input"), new File(["<a/>"], "d.xml", { type: "application/xml" }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith("<a/>", "replace"));
  });
});
