CREATE TABLE IF NOT EXISTS "attachment_blobs" (
	"attachment_id" integer PRIMARY KEY NOT NULL,
	"data" bytea NOT NULL
);
