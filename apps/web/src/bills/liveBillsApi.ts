import type { AuthClient } from "../auth/client";
import type { BillsApi } from "./types";

/** Bills backed by the real API, always for one organisation. */
export function createLiveBillsApi(
  client: AuthClient,
  organizationId: string,
): BillsApi {
  const r = <T>(path: string, init: RequestInit & { json?: unknown } = {}) =>
    client.request<T>(`/bills${path}`, {
      ...init,
      headers: { "X-Organization-Id": organizationId },
    });
  return {
    list: (q) => {
      const p = new URLSearchParams({
        page: String(q.page),
        pageSize: String(q.pageSize),
      });
      if (q.state) p.set("state", q.state);
      if (q.contactId) p.set("contactId", q.contactId);
      if (q.search) p.set("search", q.search);
      return r(`?${p}`);
    },
    get: (id) => r(`/${id}`),
    create: (input) => r("", { method: "POST", json: input }),
    update: (id, input) => r(`/${id}`, { method: "PATCH", json: input }),
    remove: (id) => r(`/${id}`, { method: "DELETE" }),
    record: (id) => r(`/${id}/record`, { method: "POST" }),
    void: (id, input) => r(`/${id}/void`, { method: "POST", json: input }),
  };
}
