-- CreateTable
CREATE TABLE "stored_objects" (
    "bucket" VARCHAR(60) NOT NULL,
    "object_path" VARCHAR(500) NOT NULL,
    "content" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("bucket","object_path")
);

