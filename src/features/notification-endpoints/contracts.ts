import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const notificationEndpointListLimit = 50;
export const notificationDeliveryListLimit = 200;

const labelSchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 80
    && value.isWellFormed()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/password|token|secret|cookie/i.test(value);
});

const noticeBodySchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 400
    && value.isWellFormed()
    && !/[\u0000-\u001f\u007f]/.test(value);
});

export const endpointStatuses = ["verified", "revoked"] as const;

export const registerNotificationEndpointSchema = z.strictObject({
  brandId: brandIdSchema,
  label: labelSchema,
});

export const revokeNotificationEndpointSchema = z.strictObject({});

export const requestNotificationDeliverySchema = z.strictObject({
  body: noticeBodySchema,
});

export const notificationEndpointErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type NotificationEndpointError = keyof typeof notificationEndpointErrors;
export type RegisterNotificationEndpointInput = z.infer<typeof registerNotificationEndpointSchema>;
export type RequestNotificationDeliveryInput = z.infer<typeof requestNotificationDeliverySchema>;
export type EndpointStatus = (typeof endpointStatuses)[number];

export type NotificationDeliveryView = {
  id: string;
  sent: boolean;
  bodyHasCustomerText: boolean;
  bodyHash: string;
  createdAt: string;
};

export type NotificationEndpointView = {
  id: string;
  brandId: string;
  label: string;
  status: EndpointStatus;
  createdAt: string;
  updatedAt: string;
  deliveries: NotificationDeliveryView[];
};

export type NotificationEndpointList = {
  brands: { id: string }[];
  endpoints: NotificationEndpointView[];
};
