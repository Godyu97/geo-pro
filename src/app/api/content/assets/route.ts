import { imageAssetCreateResponse } from "@/features/asset-reuse/image-asset-api";

export function POST(request: Request) {
  return imageAssetCreateResponse(request);
}
