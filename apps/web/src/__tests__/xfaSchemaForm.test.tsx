import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, groupXfaFields, type XfaSchemaOut } from "@thynkpdf/editor-client";
import { XfaSchemaForm } from "@/components/XfaSchemaForm";
import { classifyXfaError } from "@/lib/xfaConvert";

// Mirrors GET /pdf/{id}/forms/xfa/schema from backend PR #24.
const f = (o: Partial<XfaSchemaOut["fields"][number]> & { som: string }) => ({ name: null, type: "text", required: false, read_only: false, multiline: false, ...o });
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
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith("<xfa:data/>"));
  });
  it("groupXfaFields drops the common root subform", () => {
    const g = groupXfaFields(schema.fields);
    expect(g.groups.map((x) => x.name)).toEqual(["applicant", "terms"]);
  });
  it("maps every backend XFA error to an honest message; 404 without doc code = not deployed", () => {
    for (const [st, code] of [[422, "XFA_NOT_PRESENT"], [422, "XFA_MALFORMED"], [422, "XFA_UNSAFE_XML"], [413, "XFA_TOO_LARGE"], [409, "VERSION_CONFLICT"]] as const)
      expect(classifyXfaError(new ApiError(st, code, "x")).outcome).toBe("known");
    const u = classifyXfaError(new ApiError(422, "xfa_dynamic_unsupported", "x", { unsupported: ["no root subform"] }));
    expect(u.message).toContain("no root subform");
    expect(classifyXfaError(new ApiError(404, "NOT_FOUND", "x")).outcome).toBe("unavailable");
    expect(classifyXfaError(new ApiError(404, "DOCUMENT_NOT_FOUND", "x")).outcome).toBe("failed");
  });
});
