import type { NextRequest } from "next/server";
import {
  authorizeCompanyBrainRequest,
  companyBrainJson,
  type CompanyBrainAuthorization,
} from "@/lib/ops/company-brain-api";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";

export type CompanyBrainRole =
  | "viewer"
  | "operator"
  | "approver"
  | "automation_admin"
  | "company_admin";

export type CompanyBrainActor = {
  email: string;
  roles: CompanyBrainRole[];
  identified: boolean;
  local: boolean;
};

type ActorRoleRow = {
  actor_email: string;
  role: CompanyBrainRole;
  active: boolean;
};

const ROLE_IMPLICATIONS: Record<CompanyBrainRole, CompanyBrainRole[]> = {
  viewer: ["viewer"],
  operator: ["viewer", "operator"],
  approver: ["viewer", "operator", "approver"],
  automation_admin: ["viewer", "operator", "automation_admin"],
  company_admin: ["viewer", "operator", "approver", "automation_admin", "company_admin"],
};

function normalizeActor(value: string) {
  return value.trim().toLowerCase();
}

function defaultVerifiedRoles() {
  const configured = String(process.env.COMPANY_BRAIN_DEFAULT_VERIFIED_ROLE || "operator")
    .trim()
    .toLowerCase();
  return configured === "viewer" ? ROLE_IMPLICATIONS.viewer : ROLE_IMPLICATIONS.operator;
}

function expandRoles(roles: CompanyBrainRole[]) {
  return [...new Set(roles.flatMap((role) => ROLE_IMPLICATIONS[role] || []))];
}

export async function resolveCompanyBrainActor(auth: CompanyBrainAuthorization): Promise<CompanyBrainActor> {
  if (auth.actor === "local_ops") {
    return {
      email: auth.actor,
      roles: ROLE_IMPLICATIONS.company_admin,
      identified: true,
      local: true,
    };
  }

  if (!auth.actorIdentified) {
    return {
      email: auth.actor,
      roles: ["viewer"],
      identified: false,
      local: false,
    };
  }

  const email = normalizeActor(auth.actor);
  const rows = await supabaseRequest<ActorRoleRow[]>("company_brain_actor_roles", undefined, {
    select: "actor_email,role,active",
    actor_email: `eq.${email}`,
    active: "eq.true",
    limit: 20,
  });
  const explicitRoles = rows.map((row) => row.role).filter((role) => Boolean(ROLE_IMPLICATIONS[role]));
  return {
    email,
    roles: expandRoles(explicitRoles.length ? explicitRoles : defaultVerifiedRoles()),
    identified: true,
    local: false,
  };
}

export async function authorizeCompanyBrainActor(request: NextRequest) {
  const auth = await authorizeCompanyBrainRequest(request);
  if (!auth.ok) return auth;
  try {
    return { ok: true as const, auth, actor: await resolveCompanyBrainActor(auth) };
  } catch (error) {
    console.error("company brain actor resolution failed", error);
    return {
      ok: false as const,
      response: companyBrainJson({ ok: false, error: "actor_role_resolution_failed" }, { status: 503 }),
    };
  }
}

export function requireCompanyBrainRole(actor: CompanyBrainActor, roles: CompanyBrainRole[]) {
  if (!actor.identified) {
    return companyBrainJson({ ok: false, error: "actor_identity_required" }, { status: 403 });
  }
  if (roles.some((role) => actor.roles.includes(role))) return null;
  return companyBrainJson(
    {
      ok: false,
      error: "forbidden",
      requiredRoles: roles,
      actorRoles: actor.roles,
    },
    { status: 403 },
  );
}

export function hasCompanyBrainRole(actor: CompanyBrainActor, role: CompanyBrainRole) {
  return actor.roles.includes(role);
}
