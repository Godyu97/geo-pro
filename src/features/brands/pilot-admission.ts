export const pilotAdmissionIds = [
  "emailDelivery",
  "accountRecovery",
  "retentionDisclosure",
  "backupDrill",
  "pilotAuthorization",
] as const;

export type PilotAdmissionId = (typeof pilotAdmissionIds)[number];

export type BrandIntakeMode = "fixture" | "real";

export type PilotAdmissionItem = {
  id: PilotAdmissionId;
  met: boolean;
};

function attested(env: NodeJS.ProcessEnv, name: string) {
  return env[name] === "true";
}

/** Server-side record of the real brand-intake gate. Mock mail never counts as delivery evidence. */
export function readPilotAdmission(env: NodeJS.ProcessEnv): {
  items: PilotAdmissionItem[];
  realIntakeOpen: boolean;
} {
  const mailGateway = Boolean(env.GEO_AUTH_MAIL_URL && env.GEO_AUTH_MAIL_SECRET);
  const mailMock = env.GEO_AUTH_MAIL_MOCK === "true";
  const items: PilotAdmissionItem[] = [
    {
      id: "emailDelivery",
      met: mailGateway && !mailMock && attested(env, "GEO_PILOT_EMAIL_DELIVERY_VERIFIED"),
    },
    { id: "accountRecovery", met: attested(env, "GEO_PILOT_RECOVERY_VERIFIED") },
    { id: "retentionDisclosure", met: attested(env, "GEO_PILOT_RETENTION_DISCLOSED") },
    { id: "backupDrill", met: attested(env, "GEO_PILOT_BACKUP_DRILL_VERIFIED") },
    { id: "pilotAuthorization", met: attested(env, "GEO_PILOT_AUTHORIZED") },
  ];
  return {
    items,
    realIntakeOpen: items.every((item) => item.met) && attested(env, "GEO_BRAND_REAL_INTAKE"),
  };
}
