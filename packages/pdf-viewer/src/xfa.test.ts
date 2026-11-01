import { describe, it, expect } from "vitest";
import { classifyXfa } from "./xfa";

describe("classifyXfa", () => {
  it("pure XFA wins", () => expect(classifyXfa({ isPureXfa: true, xfaPresent: true, firstPageText: "Please wait..." })).toBe("pure"));
  it("no XFA", () => expect(classifyXfa({ isPureXfa: false, xfaPresent: false, firstPageText: "Please wait..." })).toBe("none"));
  it("placeholder page means XFA could not be rendered", () => {
    expect(classifyXfa({ isPureXfa: false, xfaPresent: true, firstPageText: "Please wait... If this message is not eventually replaced by the proper contents of the document" })).toBe("unrendered");
    expect(classifyXfa({ isPureXfa: false, xfaPresent: true, firstPageText: "To view the full contents of this document, you need a later version of the PDF viewer." })).toBe("unrendered");
  });
  it("XFA + real AcroForm content is hybrid", () => expect(classifyXfa({ isPureXfa: false, xfaPresent: true, firstPageText: "Application for benefits  Name" })).toBe("hybrid"));
});
