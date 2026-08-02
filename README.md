# 闪念笔记 · FlashNote

闪念笔记是一个面向低阻力记录的个人笔记应用，支持多级标签、稳定 ID 双链引用、图片、日期调整和移动端编辑。

新建双链使用笔记 ID 定位，标题重复或为空也不会误连；历史 `[[标题]]` 引用继续兼容。图片上传和保存回调绑定原始编辑会话，取消、关闭或切换编辑器后不会写入其他草稿。

技术栈：Supabase + GitHub Pages + 单页 HTML。

## 安全边界

- `notes` 通过 `owner_id = auth.uid()` 的 RLS 策略隔离用户数据。
- `note-images` 为私有 Storage bucket；前端仅保存对象路径，读取时生成短期 signed URL。
- 前端只使用 Supabase publishable key；`service_role` 仅存在于服务端 Edge Function 环境。

## 本地检查

```bash
python3 -m unittest discover -s tests -v
node tests/frontend_pure_helpers.mjs
```
