const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3333";

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

export async function listUsers() {
  return jsonFetch("/admin/users", {
    headers: devHeaders(),
  });
}

export async function createUser(input: {
  name: string;
  employeeNumber: string;
  corporateEmail: string;
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
