// Cloud mode: signed in to a bookie-server, the ported db modules (companies,
// customers, projects, time entries) call its REST API instead of the local
// SQLite file, and every other local query refuses (see getDb), so local and
// cloud ids never mix.

const KEY = "bookie.cloud";

export type CloudSession = { url: string; token: string; email: string };

export function cloud(): CloudSession | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null; // no localStorage (tests) = local mode
  }
}

export class CloudError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = status === 402
      ? "Kein aktives bookie Cloud Abo für dieses Unternehmen"
      : status === 403
        ? "Keine Berechtigung für diesen Bereich"
        : `Server: ${status} ${code}`,
  ) {
    super(message);
  }
}

async function request<T>(
  url: string,
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(url + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  // Only "unauthorized" means the session is gone; a 401 invalid_credentials
  // (wrong current password on change / 2FA disable) must not sign out.
  if (res.status === 401 && token && data?.error === "unauthorized") {
    localStorage.removeItem(KEY);
    throw new CloudError(
      401,
      "session_expired",
      "Sitzung abgelaufen, bitte neu anmelden",
    );
  }
  if (!res.ok) throw new CloudError(res.status, data?.error ?? res.statusText);
  return data as T;
}

export function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const c = cloud();
  if (!c) throw new Error("Nicht mit bookie Cloud angemeldet");
  return request<T>(c.url, path, method, body, c.token);
}

/** REST resource of bookie-server (`/api/<name>`) in the shape the db modules return. */
export function resource<T>(name: string) {
  return {
    list: () => api<T[]>(`/api/${name}`),
    page: (limit: number, offset: number) =>
      api<{ rows: T[]; totalCount: number }>(
        `/api/${name}?limit=${limit}&offset=${offset}`,
      ),
    get: (id: number) =>
      api<T>(`/api/${name}/${id}`).catch((e) =>
        e instanceof CloudError && e.status === 404
          ? undefined
          : Promise.reject(e),
      ),
    create: async (data: object) =>
      (await api<{ id: number }>(`/api/${name}`, "POST", data)).id,
    update: async (id: number, data: object) =>
      void (await api(`/api/${name}/${id}`, "PATCH", data)),
    remove: async (id: number) =>
      void (await api(`/api/${name}/${id}`, "DELETE")),
  };
}

/** Unauthenticated call (register, password reset mail). */
export const publicApi = <T>(url: string, path: string, body: unknown) =>
  request<T>(url.replace(/\/+$/, ""), path, "POST", body);

/** The server takes a 6-digit TOTP as `code`, anything else as `recoveryCode`. */
export const secondFactor = (code: string) =>
  /^\d{6}$/.test(code.trim()) ? { code: code.trim() } : { recoveryCode: code };

/** Returns "mfa" when the account has 2FA and no code was given. */
export async function login(
  url: string,
  email: string,
  password: string,
  code?: string,
): Promise<"mfa" | void> {
  url = url.replace(/\/+$/, "");
  let r = await request<{ token?: string; mfaToken?: string }>(
    url,
    "/auth/login",
    "POST",
    { email, password },
  );
  if (r.mfaToken) {
    if (!code) return "mfa";
    r = await request(url, "/auth/login/totp", "POST", {
      mfaToken: r.mfaToken,
      ...secondFactor(code),
    });
  }
  localStorage.setItem(KEY, JSON.stringify({ url, token: r.token, email }));
}

export async function logout(): Promise<void> {
  await api("/auth/logout", "POST", {}).catch(() => {}); // local sign-out even if the server is gone
  localStorage.removeItem(KEY);
}

export type Me = {
  user: { id: number; email: string; name: string; totpEnabled: boolean };
  activeCompanyId: number | null;
  companies: {
    id: number;
    name: string;
    role: "admin" | "member" | "subcontractor";
    paid: boolean;
  }[];
};
