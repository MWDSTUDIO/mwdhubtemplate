"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireHouseSession } from "@/lib/session";

/**
 * The Desk — "Accès": the house hands the keys itself.
 * Accounts are created here (couple, coordinator, team member) with a
 * generated password shown once to the team, who passes it on with the
 * elegance of the house. Room codes are managed by Estelle alone.
 */

function housePassword() {
  const words = ["Jardin", "Lumiere", "Linon", "Olivier", "Aurore", "Tilleul", "Argile", "Muguet"];
  const w = () => words[Math.floor(Math.random() * words.length)];
  return `${w()}-${w()}-${Math.floor(100 + Math.random() * 900)}`;
}

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export interface MemberRow {
  profileId: string;
  name: string;
  email: string;
  role: "client" | "coordinator" | "team";
  isPrincipal: boolean;
  isTeamwork: boolean;
  weddings: string[];
}

export async function listMembers(): Promise<MemberRow[]> {
  await teamSession();
  const admin = createAdminClient();
  const [{ data: profiles }, { data: members }, { data: weddings }, usersRes] =
    await Promise.all([
      admin.from("profiles").select("*"),
      admin.from("wedding_members").select("*"),
      admin.from("weddings").select("id, couple_display_name"),
      admin.auth.admin.listUsers({ perPage: 1000 })
    ]);
  const emailOf = new Map(
    (usersRes.data?.users ?? []).map((u) => [u.id, u.email ?? "—"])
  );
  const weddingName = new Map((weddings ?? []).map((w) => [w.id, w.couple_display_name]));
  return (profiles ?? [])
    .map((p) => ({
      profileId: p.id,
      name: p.full_name,
      email: emailOf.get(p.id) ?? "—",
      role: p.role,
      isPrincipal: p.is_principal,
      isTeamwork: p.is_teamwork,
      weddings: (members ?? [])
        .filter((m) => m.profile_id === p.id)
        .map((m) => weddingName.get(m.wedding_id) ?? "?")
    }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

export async function inviteMember(input: {
  email: string;
  name: string;
  role: "client" | "coordinator" | "team";
  weddingId: string | null;
  locale?: string;
}) {
  await teamSession();
  const admin = createAdminClient();
  const password = housePassword();

  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password,
    email_confirm: true
  });
  if (error || !created.user) {
    return { ok: false as const, error: error?.message ?? "creation failed" };
  }

  await admin.from("profiles").upsert({
    id: created.user.id,
    full_name: input.name.trim(),
    role: input.role,
    is_principal: false,
    is_teamwork: false,
    locale: input.locale ?? "en"
  });

  if (input.weddingId && input.role !== "team") {
    await admin.from("wedding_members").upsert({
      wedding_id: input.weddingId,
      profile_id: created.user.id,
      relation: input.role === "client" ? "couple" : "coordinator"
    });
  }

  revalidatePath("/desk");
  return { ok: true as const, password };
}

/** A fresh key, shown once — for a guest of the house who mislaid theirs. */
export async function resetMemberPassword(profileId: string) {
  await teamSession();
  const admin = createAdminClient();
  const password = housePassword();
  const { error } = await admin.auth.admin.updateUserById(profileId, { password });
  if (error) return { ok: false as const };
  return { ok: true as const, password };
}

export async function removeMember(profileId: string) {
  const session = await teamSession();
  if (!session.isPrincipal) throw new Error("Estelle only");
  if (profileId === session.userId) throw new Error("cannot remove yourself");
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(profileId);
  revalidatePath("/desk");
  return { ok: true };
}

/** Estelle alone rewrites the room codes (bcrypt-hashed, never stored raw). */
export async function setRoomCode(scope: "teamwork" | "vault", code: string) {
  const session = await requireHouseSession();
  if (!session.isPrincipal) throw new Error("Estelle only");
  if (!/^\d{4,8}$/.test(code)) return { ok: false as const };
  const admin = createAdminClient();
  const code_hash = bcrypt.hashSync(code, 10);
  if (scope === "teamwork") {
    await admin.from("access_codes").update({ code_hash }).eq("scope", "teamwork").is("profile_id", null);
  } else {
    await admin
      .from("access_codes")
      .upsert({ scope: "vault", profile_id: session.userId, code_hash }, { onConflict: "scope,profile_id" });
  }
  return { ok: true as const };
}
