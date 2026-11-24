-- client/contractor creation should only require a company name; contact
-- person, phone, email and NTN are useful but not mandatory
ALTER TABLE "contractors" ALTER COLUMN "contact_person" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contractors" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contractors" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contractors" ALTER COLUMN "ntn" DROP NOT NULL;
