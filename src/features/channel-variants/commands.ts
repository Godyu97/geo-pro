import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  publishChannelProfileSchema,
  type ChannelProfileError,
  type PublishChannelProfileInput,
} from "./contracts.ts";
import { ChannelProfileDao, type ChannelProfileVersionRow } from "./dao.ts";

type Failure = { error: ChannelProfileError };

function denied(error: ChannelProfileError): Failure {
  return { error };
}

export async function publishChannelProfile(
  db: DatabaseConnection,
  ownerId: string,
  input: PublishChannelProfileInput,
  clock: () => string = () => new Date().toISOString(),
) {
  const parsed = publishChannelProfileSchema.safeParse(input);
  if (!parsed.success) return denied("INVALID_INPUT");
  return db.transaction(async (transaction) => {
    const brands = new BrandDao(transaction);
    if (!await brands.lockOwner(ownerId)) return denied("NOT_FOUND");
    const brand = await brands.owned(ownerId, parsed.data.brandId);
    if (!brand || brand.status !== "active") return denied("NOT_FOUND");
    const dao = new ChannelProfileDao(transaction);
    const now = clock();
    const current = await dao.findProfile(ownerId, parsed.data.brandId, parsed.data.channelKey);
    const profileId = current?.id ?? randomUUID();
    if (!current) {
      await dao.insertProfile({
        id: profileId,
        brandId: parsed.data.brandId,
        ownerId,
        channelKey: parsed.data.channelKey,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await dao.touchProfile(ownerId, profileId, now);
    }
    const version: ChannelProfileVersionRow = {
      id: randomUUID(),
      profileId,
      brandId: parsed.data.brandId,
      ownerId,
      channelKey: parsed.data.channelKey,
      maxCharacters: parsed.data.maxCharacters,
      note: parsed.data.note,
      versionNumber: (current?.latest ?? 0) + 1,
      createdAt: now,
    };
    await dao.insertVersion(version);
    return { version };
  });
}

export async function listChannelProfiles(db: DatabaseConnection, ownerId: string, brandId: string) {
  if (!brandIdSchema.safeParse(brandId).success) return denied("INVALID_INPUT");
  const brand = await new BrandDao(db).owned(ownerId, brandId);
  if (!brand) return denied("NOT_FOUND");
  const versions = await new ChannelProfileDao(db).listVersions(ownerId, brandId);
  return { brandId, readOnly: brand.status !== "active", versions };
}
