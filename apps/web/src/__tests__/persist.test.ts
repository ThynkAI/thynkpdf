import { loadPersisted, savePersisted, clearPersisted } from "@/lib/persist";
describe("session persistence (sessionStorage, no tokens)", () => {
  beforeEach(() => clearPersisted());
  it("stores only the last document id — never tokens (refresh token is an httpOnly cookie)", () => {
    savePersisted({ lastDocumentId: "doc1" });
    expect(loadPersisted()).toEqual({ lastDocumentId: "doc1" });
    expect(JSON.stringify(sessionStorage)).not.toContain("token");
  });
  it("drops the legacy v1 token blob", () => {
    sessionStorage.setItem("tp-session-v1", JSON.stringify({ tokens: { refresh_token: "r" } }));
    savePersisted({ lastDocumentId: null });
    expect(sessionStorage.getItem("tp-session-v1")).toBeNull();
  });
  it("survives corrupt storage", () => {
    sessionStorage.setItem("tp-session-v2", "{nope");
    expect(loadPersisted()).toEqual({ lastDocumentId: null });
  });
});
