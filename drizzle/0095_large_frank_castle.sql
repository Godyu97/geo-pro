ALTER TABLE "sampling_due_run" DROP CONSTRAINT "sampling_due_run_state_check";--> statement-breakpoint
ALTER TABLE "sampling_due_run" ADD COLUMN "prompt_set_id" text;--> statement-breakpoint
ALTER TABLE "sampling_due_run" ADD COLUMN "prompt_set_version" integer;--> statement-breakpoint
ALTER TABLE "sampling_due_run" ADD CONSTRAINT "sampling_due_run_state_check" CHECK ("sampling_due_run"."plan_version" > 0
    and "sampling_due_run"."kind" in ('official', 'manual')
    and "sampling_due_run"."status" in ('reserved', 'accepted', 'sheet')
    and "sampling_due_run"."charged_minor" >= 0
    and length("sampling_due_run"."window_id") = 10
    and length("sampling_due_run"."timezone") between 1 and 64
    and length("sampling_due_run"."channel_id") between 1 and 64
    and length("sampling_due_run"."owner_id") between 1 and 128
    and length("sampling_due_run"."created_at") between 20 and 40
    and (
      ("sampling_due_run"."kind" = 'manual' and "sampling_due_run"."status" = 'sheet'
        and "sampling_due_run"."monitoring_run_id" is null and "sampling_due_run"."charged_minor" = 0
        and "sampling_due_run"."prompt_ids_json" is not null and length("sampling_due_run"."prompt_ids_json") between 38 and 2000
        and (
          ("sampling_due_run"."prompt_set_id" is null and "sampling_due_run"."prompt_set_version" is null)
          or (length("sampling_due_run"."prompt_set_id") = 36 and "sampling_due_run"."prompt_set_version" > 0)
        ))
      or ("sampling_due_run"."kind" = 'official' and "sampling_due_run"."status" = 'reserved'
        and "sampling_due_run"."monitoring_run_id" is null and "sampling_due_run"."charged_minor" = 0
        and "sampling_due_run"."prompt_ids_json" is null and "sampling_due_run"."prompt_set_id" is null and "sampling_due_run"."prompt_set_version" is null)
      or ("sampling_due_run"."kind" = 'official' and "sampling_due_run"."status" = 'accepted'
        and "sampling_due_run"."monitoring_run_id" is not null
        and "sampling_due_run"."prompt_ids_json" is null and "sampling_due_run"."prompt_set_id" is null and "sampling_due_run"."prompt_set_version" is null)
    ));