CREATE SEQUENCE "public"."sync_rev" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "sync_records" (
	"user_id" uuid NOT NULL,
	"tbl" text NOT NULL,
	"uid" text NOT NULL,
	"data" jsonb,
	"modified_at" bigint NOT NULL,
	"rev" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_records_user_id_tbl_uid_pk" PRIMARY KEY("user_id","tbl","uid")
);
--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_records_user_rev_idx" ON "sync_records" USING btree ("user_id","rev");