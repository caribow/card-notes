import re
import unittest
from pathlib import Path

HTML = Path(__file__).parents[1].joinpath("index.html").read_text(encoding="utf-8")


class FrontendContractTests(unittest.TestCase):
    def test_reference_and_create_replaces_copy_link(self):
        self.assertIn('data-action="reference-create"', HTML)
        self.assertIn('引用并新建', HTML)
        self.assertNotIn('复制双链', HTML)
        self.assertIn("openModal('[['+noteTitle(n)+']]\\n\\n','reference-'+id)", HTML)
        self.assertRegex(HTML, r"function openModal\([\s\S]*?setSelectionRange\(noteTextEl\.value\.length,noteTextEl\.value\.length\)")

    def test_detail_editor_has_one_cancel_and_embedded_format_bar(self):
        self.assertNotIn('id="detailEditCancel"', HTML)
        self.assertNotIn('id="detailEditTb"', HTML)
        self.assertIn('id="detailBackText">返回', HTML)
        self.assertIn('id="detailEditSave"', HTML)
        self.assertIn('class="format-panel detail-format-panel"', HTML)
        self.assertRegex(HTML, r"openDetailEdit\(id\)[\s\S]*?detailBackText'\)\.textContent='取消'")

    def test_recorded_on_drives_display_but_created_at_is_preserved(self):
        self.assertIn('id="noteRecordedOn"', HTML)
        self.assertIn('id="detailEditRecordedOn"', HTML)
        self.assertIn('recorded_on:n.recorded_on||null', HTML)
        self.assertIn('created_at:n.created_at', HTML)
        self.assertRegex(HTML, r"function noteDate\(n\).*?n\.recorded_on\|\|n\.time\|\|n\.created_at")
        self.assertRegex(HTML, r"insert\(\{text,tags,imgs:\[\.\.\.pendingImgs\],recorded_on")
        self.assertRegex(HTML, r"update\(\{text:newText,tags,imgs:\[\.\.\.detailPendingImgs\],recorded_on")
        self.assertIn("const recorded_on=null", HTML)
        self.assertIn("recorded_on:n.recorded_on||null", HTML)

    def test_format_tools_are_collapsible_and_discoverable_in_editors(self):
        self.assertGreaterEqual(HTML.count('<summary>Aa 格式</summary>'), 2)
        for label in ('@ 引用', '# 标签', '图片'):
            self.assertIn(label, HTML)
        self.assertNotRegex(HTML, r'<div class="detail-topbar">[\s\S]{0,1200}data-md=')

    def test_drafts_survive_expansion_and_clear_only_after_success(self):
        self.assertIn("const QUICK_DRAFT_KEY='card-notes-draft-quick'", HTML)
        self.assertIn("const NEW_DRAFT_KEY='card-notes-draft-new'", HTML)
        self.assertIn("const EDIT_DRAFT_PREFIX='card-notes-draft-edit-'", HTML)
        self.assertIn("function draftStorageKey(base", HTML)
        self.assertIn("currentUserId", HTML)
        self.assertIn("migrateLegacyDrafts", HTML)
        self.assertIn("quickDraftKey()", HTML)
        self.assertIn("activeModalDraftKey", HTML)
        self.assertIn("saveDraft(editDraftKey(currentDetailId)", HTML)
        expand_match = re.search(r"expandBtn\.addEventListener\('click',([^;]+);", HTML)
        if expand_match is None:
            self.fail('missing expand handler')
        expand_handler = expand_match.group(0)
        self.assertIn("openModal(ta.value,'quick')", expand_handler)
        self.assertNotIn('clearDraft', expand_handler)
        self.assertGreaterEqual(HTML.count('clearDraft('), 3)
        self.assertIn("openModal('[['+noteTitle(n)+']]\\n\\n','reference-'+id)", HTML)
        self.assertIn("chooseModalDraft", HTML)

    def test_cancel_discards_edit_draft_and_updates_are_optimistic(self):
        self.assertIn("updated_at:n.updated_at", HTML)
        self.assertIn("base_updated_at:n.updated_at", HTML)
        self.assertIn("function cancelDetailEdit()", HTML)
        self.assertIn("clearDraft(editDraftKey(currentDetailId))", HTML)
        self.assertRegex(HTML, r"\.eq\('updated_at',n\.updated_at\)\.select\(\)")
        self.assertIn("其他设备", HTML)

    def test_mobile_zoom_dependency_and_engineering_labels_are_cleaned_up(self):
        self.assertNotIn('user-scalable=no', HTML)
        self.assertRegex(HTML, r'@supabase/supabase-js@2\.\d+\.\d+')
        self.assertNotIn('>NOW<', HTML)
        self.assertNotRegex(HTML, r"\['SUN','MON','TUE','WED','THU','FRI','SAT'\]")
        self.assertNotIn('NO NOTES HERE', HTML)

    def test_user_content_and_links_are_escaped_or_validated(self):
        self.assertRegex(HTML, r"function escapeHTML\(s\).*?&quot;.*?&#39;")
        self.assertIn('function safeExternalUrl(url)', HTML)
        self.assertIn('rel="noopener noreferrer"', HTML)
        tags_match = re.search(r"const tags=n\.tags\.map\(t=>[^\n]+", HTML)
        if tags_match is None:
            self.fail('missing card tag renderer')
        card_tags = tags_match.group(0)
        self.assertIn('escapeHTML(t)', card_tags)
        self.assertIn('escapeAttr(t)', card_tags)
        self.assertNotIn("href=\"$2\"", HTML)

    def test_storage_uses_user_paths_and_signed_urls_with_legacy_compatibility(self):
        self.assertRegex(HTML, r"sb\.auth\.getUser\(\)")
        self.assertRegex(HTML, r"fileName=user\.id\+'/'.*?img_")
        self.assertNotIn('getPublicUrl(', HTML)
        self.assertIn("createSignedUrl(path,3600)", HTML)
        self.assertRegex(HTML, r"function isLegacyImageUrl\(value\)")
        self.assertRegex(HTML, r"async function resolveImageUrl\(value\)")
        self.assertIn("function isSignedUrlCacheFresh", HTML)
        self.assertIn("expiresAt", HTML)
        self.assertIn("imageUrlCache.clear()", HTML)
        self.assertIn("sb.storage.from('note-images').remove", HTML)
        self.assertIn("图片不能超过 10MB", HTML)
        self.assertIn("async function removeImg(i)", HTML)

    def test_detail_image_editor_supports_existing_delete_and_add(self):
        self.assertIn('id="detailImgAddBtn"', HTML)
        self.assertIn('id="detailImgFileInput"', HTML)
        self.assertIn('id="detailImgThumbs"', HTML)
        self.assertIn('let detailPendingImgs=[]', HTML)
        self.assertRegex(HTML, r"function removeDetailImg\(i\)")
        self.assertIn("imgs:[...n.imgs]", HTML)
        self.assertIn("detailPendingImgs=[...(draft.imgs||[])]", HTML)


if __name__ == "__main__":
    unittest.main()
