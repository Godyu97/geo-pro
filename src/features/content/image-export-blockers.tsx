import Link from "next/link";
import type { getTranslator } from "@/lib/i18n/server";
import type { InvalidImageAsset } from "./contracts";

export function ImageExportBlockers({
  images,
  editHref,
  t,
}: {
  images?: InvalidImageAsset[];
  editHref: string;
  t: Awaited<ReturnType<typeof getTranslator<"content">>>;
}) {
  if (!images?.length) return null;
  return (
    <div className="mt-2 min-w-0 space-y-2 text-sm">
      <ul aria-label={t("invalidImages")} className="list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
        {images.map((image) => (
          <li key={image.id}>
            <strong>{image.fileName}</strong>{" "}
            {t("invalidImageVersion", { version: image.version })} · {t(`invalidImage_${image.reason}`)}
          </li>
        ))}
      </ul>
      <Link href={editHref} prefetch={false} className="text-primary underline underline-offset-4">
        {t("replaceInvalidImages")}
      </Link>
    </div>
  );
}
