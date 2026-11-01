import { ApiError } from "@thynkpdf/editor-client";
import { classifyConvertError } from "@/lib/xfaConvert";
describe("XFA convert error handling", () => {
  it("404/405 means the endpoint isn't deployed yet", () => {
    expect(classifyConvertError(new ApiError(404, "NOT_FOUND", "x"))).toBe("unavailable");
    expect(classifyConvertError(new ApiError(405, "HTTP_405", "x"))).toBe("unavailable");
  });
  it("422 xfa_dynamic_unsupported is reported honestly", () => expect(classifyConvertError(new ApiError(422, "xfa_dynamic_unsupported", "x"))).toBe("unsupported"));
  it("anything else is a failure", () => expect(classifyConvertError(new ApiError(500, "E", "x"))).toBe("failed"));
});
