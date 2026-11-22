import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import {
  LeadQualityDao,
  type LeadObservationRecord,
  type LeadQualificationRecord,
  type LeadValidityRuleRecord,
} from "./quality-dao.ts";
import type { QualifyLeadRuleInput, RecordLeadObservationInput, SaveLeadRuleInput } from "./quality-contracts.ts";
import {
  aiReferralConversion,
  crawlerVisitIsNotAiInclusion,
  qualifyLead,
  reviseValidity,
} from "./rules.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

export type LeadRuleView = {
  id: string;
  brandId: string;
  version: number;
  frozen: boolean;
  requiresRealNeed: boolean;
  requiresIndustry: boolean;
  requiresFollowUp: boolean;
  createdAt: string;
};

export type LeadQualificationView = {
  id: string;
  ruleId: string;
  ruleVersion: number;
  status: LeadQualificationRecord["status"];
  realNeed: boolean;
  targetIndustry: boolean;
  followUp: boolean;
  createdAt: string;
};

export type LeadObservationView = {
  id: string;
  identifiedReferrals: number;
  sessionDenominator: number | null;
  identified: { count: number | null; rate: number | null };
  selfReported: number;
  selfReportedOverVisits: null;
  crawlerVisits: number;
  answerCitations: number;
  calledIncluded: false;
  createdAt: string;
};

export type LeadQualityView = {
  rules: LeadRuleView[];
  qualifiedCount: number;
  qualifications: LeadQualificationView[];
  observations: LeadObservationView[];
};

function bit(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function ruleView(row: LeadValidityRuleRecord): LeadRuleView {
  return {
    id: row.id,
    brandId: row.brandId,
    version: row.version,
    frozen: row.frozen === 1,
    requiresRealNeed: row.requiresRealNeed === 1,
    requiresIndustry: row.requiresIndustry === 1,
    requiresFollowUp: row.requiresFollowUp === 1,
    createdAt: row.createdAt,
  };
}

function qualificationView(row: LeadQualificationRecord): LeadQualificationView {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleVersion: row.ruleVersion,
    status: row.status,
    realNeed: row.realNeed === 1,
    targetIndustry: row.targetIndustry === 1,
    followUp: row.followUp === 1,
    createdAt: row.createdAt,
  };
}

function observationView(row: LeadObservationRecord): LeadObservationView {
  const conversion = aiReferralConversion({
    identifiedReferrals: row.identifiedReferrals,
    sessionDenominator: row.sessionDenominator,
    selfReported: row.selfReported,
  });
  const inclusion = crawlerVisitIsNotAiInclusion({
    crawlerVisits: row.crawlerVisits,
    answerCitations: row.answerCitations,
  });
  if (inclusion.calledIncluded) throw new Error("crawler-visit-marked-included");
  return {
    id: row.id,
    identifiedReferrals: row.identifiedReferrals,
    sessionDenominator: row.sessionDenominator,
    identified: conversion.identified,
    selfReported: conversion.selfReported,
    selfReportedOverVisits: conversion.selfReportedOverVisits,
    crawlerVisits: inclusion.visits,
    answerCitations: inclusion.citations,
    calledIncluded: inclusion.calledIncluded,
    createdAt: row.createdAt,
  };
}

export async function listLeadQuality(db: DatabaseConnection, ownerId: string, brandId: string) {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new LeadQualityDao(tx);
    const rules = await dao.rulesForBrand(ownerId, brandId);
    const qualifications = await dao.qualificationsForBrand(ownerId, brandId);
    const qualifiedCount = await dao.qualifiedCount(ownerId, brandId);
    const observations = await dao.observationsForBrand(ownerId, brandId);
    return {
      rules: rules.map(ruleView),
      qualifiedCount,
      qualifications: qualifications.map(qualificationView),
      observations: observations.map(observationView),
    } satisfies LeadQualityView;
  });
}

export async function saveLeadValidityRule(
  db: DatabaseConnection,
  ownerId: string,
  input: SaveLeadRuleInput,
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new LeadQualityDao(tx);
    const latest = await dao.latestRule(ownerId, input.brandId);
    const next = latest
      ? reviseValidity({
        version: latest.version,
        frozen: latest.frozen === 1,
        requiresRealNeed: input.requiresRealNeed,
        requiresIndustry: input.requiresIndustry,
        requiresFollowUp: input.requiresFollowUp,
      })
      : {
        version: 1,
        frozen: false,
        requiresRealNeed: input.requiresRealNeed,
        requiresIndustry: input.requiresIndustry,
        requiresFollowUp: input.requiresFollowUp,
      };
    if (next.version > 10_000) return { error: "INVALID_INPUT" as const };
    const row: LeadValidityRuleRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      version: next.version,
      frozen: bit(next.frozen),
      requiresRealNeed: bit(next.requiresRealNeed),
      requiresIndustry: bit(next.requiresIndustry),
      requiresFollowUp: bit(next.requiresFollowUp),
      createdAt: clock(),
    };
    await dao.insertRule(row);
    return { rule: ruleView(row) };
  });
}

export async function freezeLeadValidityRule(db: DatabaseConnection, ownerId: string, ruleId: string) {
  return db.transaction(async (tx) => {
    const dao = new LeadQualityDao(tx);
    const current = await dao.ruleForOwner(ownerId, ruleId);
    if (!current) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, current.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const frozen = await dao.freeze(ownerId, ruleId);
    if (!frozen) return { error: "NOT_FOUND" as const };
    return { rule: ruleView(frozen) };
  });
}

export async function qualifyLeadAgainstRule(
  db: DatabaseConnection,
  ownerId: string,
  input: QualifyLeadRuleInput,
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new LeadQualityDao(tx);
    const rule = await dao.ruleForOwner(ownerId, input.ruleId);
    if (!rule || rule.brandId !== input.brandId) return { error: "NOT_FOUND" as const };
    const judgment = qualifyLead({
      version: rule.version,
      frozen: rule.frozen === 1,
      requiresRealNeed: rule.requiresRealNeed === 1,
      requiresIndustry: rule.requiresIndustry === 1,
      requiresFollowUp: rule.requiresFollowUp === 1,
    }, {
      realNeed: input.realNeed,
      targetIndustry: input.targetIndustry,
      followUp: input.followUp,
    });
    const row: LeadQualificationRecord = {
      id: randomUUID(),
      brandId: rule.brandId,
      ownerId,
      ruleId: rule.id,
      ruleVersion: judgment.ruleVersion,
      status: judgment.status,
      realNeed: bit(input.realNeed),
      targetIndustry: bit(input.targetIndustry),
      followUp: bit(input.followUp),
      createdAt: clock(),
    };
    await dao.insertQualification(row);
    return { qualification: qualificationView(row) };
  });
}

export async function recordLeadObservation(
  db: DatabaseConnection,
  ownerId: string,
  input: RecordLeadObservationInput,
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const inclusion = crawlerVisitIsNotAiInclusion({
      crawlerVisits: input.crawlerVisits,
      answerCitations: input.answerCitations,
    });
    if (inclusion.calledIncluded) throw new Error("crawler-visit-marked-included");
    const row: LeadObservationRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      identifiedReferrals: input.identifiedReferrals,
      sessionDenominator: input.sessionDenominator,
      selfReported: input.selfReported,
      crawlerVisits: inclusion.visits,
      answerCitations: inclusion.citations,
      calledIncluded: 0,
      createdAt: clock(),
    };
    await new LeadQualityDao(tx).insertObservation(row);
    return { observation: observationView(row) };
  });
}
