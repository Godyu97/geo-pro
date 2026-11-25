"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  action: (data: FormData) => Promise<void>;
  brandId: string;
  id: string;
  fileName: string;
  title: string;
  description: string;
  confirm: string;
  cancel: string;
  pending: string;
};

function ConfirmationButtons({ confirm, cancel, pending }: Pick<Props, "confirm" | "cancel" | "pending">) {
  const status = useFormStatus();
  return (
    <DialogFooter className="mt-4">
      <DialogClose asChild>
        <Button type="button" variant="outline" className="min-h-10">{cancel}</Button>
      </DialogClose>
      <Button type="submit" variant="destructive" className="min-h-10" disabled={status.pending}>
        {status.pending ? pending : confirm}
      </Button>
    </DialogFooter>
  );
}

export function ImageRightsConfirmation({ action, brandId, id, fileName, title, description, confirm, cancel, pending }: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-10">{title}</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <span className="mb-2 block font-medium [overflow-wrap:anywhere]">{fileName}</span>
            {description}
          </DialogDescription>
        </DialogHeader>
        <form action={action}>
          <input type="hidden" name="brandId" value={brandId} />
          <input type="hidden" name="id" value={id} />
          <ConfirmationButtons confirm={confirm} cancel={cancel} pending={pending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
