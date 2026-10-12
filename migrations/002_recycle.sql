-- Additive migration: original content, IDs, timestamps and likes remain intact.
CREATE TABLE IF NOT EXISTS content_recycle (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'comment')),
  target_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  deleted_by INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL,
  deletion_id TEXT NOT NULL,
  PRIMARY KEY (kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_content_recycle_owner ON content_recycle(owner_id, deleted_at DESC);

CREATE VIEW IF NOT EXISTS active_posts AS
SELECT posts.* FROM posts
WHERE NOT EXISTS (SELECT 1 FROM content_recycle r WHERE r.kind = 'post' AND r.target_id = posts.id);

CREATE VIEW IF NOT EXISTS active_comments AS
SELECT comments.* FROM comments
JOIN active_posts p ON p.id = comments.post_id
WHERE NOT EXISTS (SELECT 1 FROM content_recycle r WHERE r.kind = 'comment' AND r.target_id = comments.id)
  AND (comments.parent_id IS NULL OR EXISTS (
    SELECT 1 FROM comments root WHERE root.id = comments.parent_id
      AND root.post_id = comments.post_id AND root.parent_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM content_recycle r WHERE r.kind = 'comment' AND r.target_id = root.id)
  ));
