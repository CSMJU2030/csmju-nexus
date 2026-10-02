-- คอลเลกชันของที่บันทึกไว้ (Instagram "คอลเลกชั่น") — เห็นได้เฉพาะเจ้าของ
--
-- แถวในคอลเลกชันไม่มี FK ไป bookmarks เพราะคีย์ของ bookmarks มี core_user_id
-- ซึ่งรู้ได้จากคอลเลกชันอยู่แล้ว — กฎ "ต้องบันทึกก่อน" บังคับที่ชั้น service
CREATE TABLE "bookmark_collections" (
    "id" TEXT NOT NULL,
    "owner_core_user_id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookmark_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bookmark_collection_items" (
    "collection_id" TEXT NOT NULL,
    "target_kind" "BookmarkTarget" NOT NULL,
    "target_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_collection_items_pkey" PRIMARY KEY ("collection_id","target_kind","target_id")
);

CREATE INDEX "bookmark_collections_owner_core_user_id_created_at_idx" ON "bookmark_collections"("owner_core_user_id", "created_at" DESC);
CREATE INDEX "bookmark_collection_items_collection_id_created_at_idx" ON "bookmark_collection_items"("collection_id", "created_at" DESC);
CREATE INDEX "bookmark_collection_items_target_kind_target_id_idx" ON "bookmark_collection_items"("target_kind", "target_id");

ALTER TABLE "bookmark_collection_items" ADD CONSTRAINT "bookmark_collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "bookmark_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
