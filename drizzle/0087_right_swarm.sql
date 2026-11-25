ALTER TABLE "content_maintenance_task" DROP CONSTRAINT "content_maintenance_task_state_check";--> statement-breakpoint
ALTER TABLE "content_maintenance_task" ADD CONSTRAINT "content_maintenance_task_state_check" CHECK ("content_maintenance_task"."status" in ('open', 'closed')
    and "content_maintenance_task"."reason" in ('expired', 'revoked', 'mismatch', 'removed')
    and length("content_maintenance_task"."created_at") between 20 and 40
    and length("content_maintenance_task"."updated_at") between 20 and 40);