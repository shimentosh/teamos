ALTER TABLE "user_avatar" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_avatar" ADD COLUMN "stored_file_id" text;--> statement-breakpoint
ALTER TABLE "user_avatar" ADD CONSTRAINT "user_avatar_stored_file_id_stored_file_id_fk" FOREIGN KEY ("stored_file_id") REFERENCES "public"."stored_file"("id") ON DELETE set null ON UPDATE cascade;