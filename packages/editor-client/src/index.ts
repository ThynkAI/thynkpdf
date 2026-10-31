export * from "./types";
export { HttpEditorApi, ApiError, VersionConflictError, DocumentSignedError, RateLimitedError } from "./http";
export { MockEditorApi } from "./mocks/mockApi";
import { HttpEditorApi } from "./http";
import { MockEditorApi } from "./mocks/mockApi";
import type { EditorApi } from "./types";

export function createEditorApi(env: { apiUrl?: string; mock?: boolean }): EditorApi {
  if (env.mock) return new MockEditorApi();
  return new HttpEditorApi({ baseUrl: env.apiUrl ?? "http://localhost:8000" });
}
