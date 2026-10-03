-- 追いつき同期（フォアグラウンド復帰 / Realtime 再接続時の差分取得）が投げる
--   select ... from tasks where updated_at >= $1 order by updated_at, id limit 1000
-- を、ユーザーの全行を舐めずに済ませるための索引。RLS の `user_id = auth.uid()` 側の
-- 絞り込みと組み合わせて使われる。差分取得は復帰のたびに走るので、行数が多い移行
-- アカウント（数千行）ほど効く。適用しなくても動作は変わらない（遅くなるだけ）。
create index if not exists tasks_user_id_updated_at_idx
on public.tasks (user_id, updated_at);
