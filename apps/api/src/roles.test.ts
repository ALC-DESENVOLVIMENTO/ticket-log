import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccessProfile } from "./roles.js";

test("resolveAccessProfile gives supervisor readonly web access", () => {
  const result = resolveAccessProfile({ roles: ["SUPERVISOR"] as any });
  assert.equal(result.canCreateWhatsappRequest, true);
  assert.equal(result.canCreateWebRequest, false);
  assert.equal(result.canApproveRequests, false);
  assert.equal(result.canManageUsers, false);
});

test("resolveAccessProfile gives coordinator approval access", () => {
  const result = resolveAccessProfile({ roles: ["COORDENADOR"] as any });
  assert.equal(result.canCreateWebRequest, true);
  assert.equal(result.canApproveRequests, true);
  assert.equal(result.canRejectRequests, true);
  assert.equal(result.canViewScopeRequests, true);
});

test("resolveAccessProfile gives admin full access", () => {
  const result = resolveAccessProfile({ roles: ["ADMINISTRADOR"] as any });
  assert.equal(result.canCreateWebRequest, true);
  assert.equal(result.canApproveRequests, true);
  assert.equal(result.canManageUsers, true);
});
