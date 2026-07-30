const RAILWAY_API_BASE_URL = "https://ticket-log-ticketlog.up.railway.app";

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (import.meta.env.DEV && !configured) {
    return "http://localhost:3333";
  }

  const isBrowser = typeof window !== "undefined";
  const hostname = isBrowser ? window.location.hostname : "";
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  const isPublishedHost = isBrowser && !isLocalhost;
  const isPlaceholder =
    !configured || configured.includes("localhost") || configured.includes("URL-DA-API");

  if (isPublishedHost && isPlaceholder) {
    return RAILWAY_API_BASE_URL;
  }

  if (configured) {
    return configured;
  }

  return RAILWAY_API_BASE_URL;
}

const API_BASE_URL = resolveApiBaseUrl().replace(/\/$/, "");

export function getSessionToken() {
  return localStorage.getItem("sessionToken");
}

export function setSessionToken(token: string | null) {
  if (token) localStorage.setItem("sessionToken", token);
  else localStorage.removeItem("sessionToken");
}

function devHeaders() {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  } else {
    headers["x-user-id"] = localStorage.getItem("devUserId") ?? "00000000-0000-0000-0000-000000000001";
    headers["x-user-email"] = localStorage.getItem("devUserEmail") ?? "dev@example.com";
  }

  return headers;
}

async function jsonFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error ?? data?.message ?? text ?? "REQUEST_FAILED");
  }
  return data;
}

export async function login(input: { email: string; password: string; totpCode?: string }) {
  return jsonFetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getMe() {
  return jsonFetch("/auth/me", {
    headers: devHeaders(),
  });
}

export async function logout() {
  return jsonFetch("/auth/logout", {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function setupMfa() {
  return jsonFetch("/auth/mfa/setup", {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function verifyMfa(code: string) {
  return jsonFetch("/auth/mfa/verify", {
    method: "POST",
    headers: devHeaders(),
    body: JSON.stringify({ code }),
  });
}

export async function createRequest(input: {
  vehiclePlate: string;
  vehicleGroup: string;
  requestedAmount: number;
  justification?: string;
}) {
  return jsonFetch("/requests", {
    method: "POST",
    headers: devHeaders(),
    body: JSON.stringify(input),
  });
}

export async function getPublicConfig() {
  return jsonFetch("/config/public");
}

export async function getRequest(id: string) {
  return jsonFetch(`/requests/${id}`, {
    headers: devHeaders(),
  });
}

export async function getRequestDetails(id: string) {
  return jsonFetch(`/requests/${id}/details`, {
    headers: devHeaders(),
  });
}

export async function listRequests(limit = 20) {
  return jsonFetch(`/requests?limit=${limit}`, {
    headers: devHeaders(),
  });
}

export async function approveToken(token: string) {
  return jsonFetch(`/approval/${token}/approve`, {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function getApproval(token: string) {
  return jsonFetch(`/approval/${token}`);
}

export async function secondApprove(requestId: string) {
  return jsonFetch(`/requests/${requestId}/second-approval`, {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function createApprovalLink(requestId: string) {
  return jsonFetch(`/requests/${requestId}/approval-link`, {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function retryRequest(requestId: string) {
  return jsonFetch(`/requests/${requestId}/retry`, {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function rejectRequest(requestId: string, justification: string) {
  return jsonFetch(`/requests/${requestId}/reject`, {
    method: "POST",
    headers: devHeaders(),
    body: JSON.stringify({ justification }),
  });
}

export async function getTicketLogSessionStatus() {
  return jsonFetch("/operations/ticketlog/session", {
    headers: devHeaders(),
  });
}

export async function claimTicketLogOperation() {
  return jsonFetch("/operations/ticketlog/claim", {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function releaseTicketLogOperation() {
  return jsonFetch("/operations/ticketlog/release", {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function listWhatsappSessions(limit = 30) {
  return jsonFetch(`/operations/whatsapp/sessions?limit=${limit}`, {
    headers: devHeaders(),
  });
}

export async function reopenWhatsappSession(phoneE164: string) {
  return jsonFetch(`/operations/whatsapp/sessions/${encodeURIComponent(phoneE164)}/reopen`, {
    method: "POST",
    headers: devHeaders(),
  });
}

export async function listUsers() {
  return jsonFetch("/admin/users", {
    headers: devHeaders(),
  });
}

export async function createUser(input: {
  name: string;
  employeeNumber: string;
  corporateEmail: string;
  cpf: string;
  operationScope?: string;
  phoneE164?: string;
  password: string;
  roles: string[];
}) {
  return jsonFetch("/admin/users", {
    method: "POST",
    headers: devHeaders(),
    body: JSON.stringify(input),
  });
}

export async function updateUser(userId: string, input: {
  name: string;
  employeeNumber: string;
  corporateEmail: string;
  operationScope?: string;
  phoneE164?: string;
  password?: string;
  roles: string[];
}) {
  return jsonFetch(`/admin/users/${userId}`, {
    method: "PATCH",
    headers: devHeaders(),
    body: JSON.stringify(input),
  });
}

export async function resetUserMfa(userId: string) {
  return jsonFetch(`/admin/users/${userId}/reset-mfa`, {
    method: "POST",
    headers: devHeaders(),
  });
}
