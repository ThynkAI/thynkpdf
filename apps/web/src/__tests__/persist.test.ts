import { loadPersisted, savePersisted, clearPersisted } from "@/lib/persist";
describe("session persistence (sessionStorage)", () => {
  beforeEach(() => clearPersisted());
  it("round-trips tokens and last document, merging partial updates", () => {
    const tokens = { access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 900 };
    savePersisted({ tokens }); savePersisted({ lastDocumentId: "doc1" });
    expect(loadPersisted()).toEqual({ tokens, lastDocumentId: "doc1" });
    savePersisted({ tokens: null });
    expect(loadPersisted()).toEqual({ tokens: null, lastDocumentId: "doc1" });
  });
  it("survives corrupt storage", () => {
    sessionStorage.setItem("tp-session-v1", "{nope");
    expect(loadPersisted()).toEqual({ tokens: null, lastDocumentId: null });
  });
});
