import type { DbUserContext } from "@ticketlog/db";

export interface AccessProfile {
  canCreateWebRequest: boolean;
  canCreateWhatsappRequest: boolean;
  canApproveRequests: boolean;
  canRejectRequests: boolean;
  canViewScopeRequests: boolean;
  canManageUsers: boolean;
  isSupervisor: boolean;
  isCoordinator: boolean;
  isAdmin: boolean;
}

export function resolveAccessProfile(user: Pick<DbUserContext, "roles">): AccessProfile {
  const roleSet = new Set(user.roles);
  const isAdmin = roleSet.has("ADMINISTRADOR");
  const isCoordinator = isAdmin || roleSet.has("COORDENADOR") || roleSet.has("APROVADOR");
  const isSupervisor = isCoordinator || roleSet.has("SUPERVISOR") || roleSet.has("SOLICITANTE");

  return {
    canCreateWebRequest: isCoordinator,
    canCreateWhatsappRequest: isSupervisor,
    canApproveRequests: isCoordinator,
    canRejectRequests: isCoordinator,
    canViewScopeRequests: isCoordinator,
    canManageUsers: isAdmin,
    isSupervisor,
    isCoordinator,
    isAdmin,
  };
}

export function assertCanCreateWebRequest(user: DbUserContext): void {
  if (!resolveAccessProfile(user).canCreateWebRequest) {
    throw Object.assign(new Error("REQUEST_CREATE_NOT_ALLOWED"), { statusCode: 403 });
  }
}

export function assertCanApproveRequest(user: DbUserContext): void {
  if (!resolveAccessProfile(user).canApproveRequests) {
    throw Object.assign(new Error("REQUEST_APPROVAL_NOT_ALLOWED"), { statusCode: 403 });
  }
}

export function assertCanManageUsers(user: DbUserContext): void {
  if (!resolveAccessProfile(user).canManageUsers) {
    throw Object.assign(new Error("ADMIN_USERS_NOT_ALLOWED"), { statusCode: 403 });
  }
}
