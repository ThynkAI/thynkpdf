import { toQuery, parseTags } from "@/lib/docFilter";
describe("toQuery", () => {
  it("maps views, search, sort and cursor to GET /documents params", () => {
    expect(toQuery({ kind: "all" }, "  rep ", "name_asc")).toEqual({ sort: "name", order: "asc", limit: 50, q: "rep" });
    expect(toQuery({ kind: "trash" }, "", "updated_desc", "c1")).toMatchObject({ trashed: true, cursor: "c1", sort: "updated_at", order: "desc" });
    expect(toQuery({ kind: "starred" }, "", "created_desc").starred).toBe(true);
    expect(toQuery({ kind: "folder", id: "root" }, "", "created_asc").folder_id).toBe("root");
    expect(toQuery({ kind: "tag", tag: "tax" }, "", "created_asc").tag).toBe("tax");
  });
  it("parses tags to the backend charset", () => expect(parseTags("Tax, 2026 bad!tag tax q_1")).toEqual(["tax", "2026", "q_1"]));
});
