import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flattenXfaFields, type XfaSchema } from "@thynkpdf/editor-client";
import { XfaSchemaForm } from "@/components/XfaSchemaForm";

const schema: XfaSchema = {
  kind: "dynamic", packets: ["config", "template", "datasets"], has_scripts: true,
  root: { kind: "subform", name: "form1", som: "form1[0]", children: [
    { kind: "subform", name: "applicant", som: "form1[0].applicant[0]", caption: "Applicant", children: [
      { kind: "field", name: "FullName", som: "form1[0].applicant[0].FullName[0]", type: "text", caption: "Full name", required: true, value: "Jane" },
      { kind: "field", name: "Notes", som: "form1[0].applicant[0].Notes[0]", type: "multiline", caption: "Notes" },
      { kind: "field", name: "Province", som: "form1[0].applicant[0].Province[0]", type: "choice", caption: "Province", options: [{ value: "ON", label: "Ontario" }, { value: "QC", label: "Quebec" }] },
    ] },
    { kind: "subform", name: "items", som: "form1[0].items[0]", caption: "Items", repeatable: true, children: [
      { kind: "field", name: "Agree", som: "form1[0].items[0].Agree[0]", type: "checkbox", caption: "I agree", has_scripts: true },
      { kind: "field", name: "Sig", som: "form1[0].items[0].Sig[0]", type: "signature", caption: "Signature" },
    ] },
  ] },
};

describe("XfaSchemaForm (mocked schema)", () => {
  it("renders subforms and typed fields and submits SOM-keyed values", async () => {
    const onSubmit = vi.fn();
    render(<XfaSchemaForm schema={schema} onSubmit={onSubmit} />);
    expect(screen.getByText("Applicant")).toBeInTheDocument();
    expect(screen.getByText("Items (repeatable)")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Jane");
    expect(screen.getByText(/signature field — not editable/)).toBeInTheDocument();
    expect(screen.getByText(/This form has scripts/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Full name"));
    await userEvent.type(screen.getByLabelText("Full name"), "Deep");
    await userEvent.selectOptions(screen.getByLabelText("Province"), "ON");
    await userEvent.click(screen.getByLabelText("I agree"));
    await userEvent.click(screen.getByRole("button", { name: "Save values (new version)" }));
    expect(onSubmit).toHaveBeenCalledWith({ "form1[0].applicant[0].FullName[0]": "Deep", "form1[0].applicant[0].Province[0]": "ON", "form1[0].items[0].Agree[0]": true });
  });
  it("hides Import/Export when the endpoints are unavailable, shows them when provided", async () => {
    const { rerender } = render(<XfaSchemaForm schema={schema} onSubmit={() => {}} />);
    expect(screen.queryByRole("button", { name: "Import data XML" })).toBeNull();
    const onImport = vi.fn(), onExport = vi.fn();
    rerender(<XfaSchemaForm schema={schema} onSubmit={() => {}} onImportXml={onImport} onExportXml={onExport} />);
    await userEvent.click(screen.getByRole("button", { name: "Export data XML" }));
    expect(onExport).toHaveBeenCalled();
    await userEvent.upload(screen.getByTestId("xfa-xml-input"), new File(["<xfa:data/>"], "d.xml", { type: "application/xml" }));
    expect(onImport).toHaveBeenCalled();
  });
  it("flattenXfaFields walks nested subforms", () => expect(flattenXfaFields(schema.root).map((f) => f.name)).toEqual(["FullName", "Notes", "Province", "Agree", "Sig"]));
});
