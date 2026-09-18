// User settings (13-auth-database.md; master plan §16).
//
// The row is created with the account, so every signed-in user always has one. Phase 14 syncs
// these with the browser's local preferences; this phase only stores and reads them.
import type { UserSettings } from "@onestop/types";
import { requirePrisma, type PrismaClient } from "../db/client.ts";

const THEMES = new Set(["light", "dark", "system"]);

type SettingsRow = {
  userId: string;
  theme: string;
  preferredAI: string | null;
  preferences: unknown;
  updatedAt: Date;
};

function toSettings(row: SettingsRow): UserSettings {
  return {
    userId: row.userId,
    theme: THEMES.has(row.theme) ? (row.theme as UserSettings["theme"]) : "system",
    preferredAI: row.preferredAI,
    preferences:
      row.preferences && typeof row.preferences === "object" && !Array.isArray(row.preferences)
        ? (row.preferences as Record<string, unknown>)
        : {},
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getUserSettings(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<UserSettings> {
  const row = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return toSettings(row as SettingsRow);
}

export interface UserSettingsPatch {
  theme?: UserSettings["theme"];
  preferredAI?: string | null;
  preferences?: Record<string, unknown>;
}

export async function updateUserSettings(
  userId: string,
  patch: UserSettingsPatch,
  prisma: PrismaClient = requirePrisma(),
): Promise<UserSettings> {
  const theme = patch.theme && THEMES.has(patch.theme) ? patch.theme : undefined;
  const data = {
    ...(theme ? { theme } : {}),
    ...(patch.preferredAI !== undefined ? { preferredAI: patch.preferredAI } : {}),
    ...(patch.preferences !== undefined ? { preferences: patch.preferences as never } : {}),
  };
  const row = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return toSettings(row as SettingsRow);
}
