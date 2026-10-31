/**
 * Public page URLs. Query-string pages (/sign/?token=, /shared/?token=) work with the static export used by apps/desktop,
 * where the same origin also serves the API's /sign/{token} and /shared/{token} JSON routes.
 */
export const signerPageUrl = (token: string, origin: string) => `${origin}/sign/?token=${encodeURIComponent(token)}`;
export const sharedPageUrl = (apiPath: string, origin: string) => `${origin}/shared/?token=${encodeURIComponent(apiPath.split("/").filter(Boolean).pop() ?? "")}`;
export const tokenFromSearch = (search: string) => new URLSearchParams(search).get("token") ?? "";
