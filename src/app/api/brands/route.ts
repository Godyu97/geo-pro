import { readBrandResponse, writeBrandResponse } from "@/features/brands/api";

export const runtime = "nodejs";
export const GET = readBrandResponse;
export const POST = writeBrandResponse;
