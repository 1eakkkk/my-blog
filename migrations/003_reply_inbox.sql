-- 回复我的：仅新增已读回执，不复用早期版本遗留的 notifications 表。
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL,
  comment_id INTEGER NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);

-- 重复执行时保留首次启用时间；此前的评论仍可查看，默认视为已读。
INSERT OR IGNORE INTO system_settings (key, value)
VALUES ('site_inbox_started_at', CAST(CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS TEXT));

CREATE INDEX IF NOT EXISTS comments_reply_recipient_idx ON comments(reply_to_uid, created_at, id);
CREATE INDEX IF NOT EXISTS comments_post_created_idx ON comments(post_id, created_at, id);
