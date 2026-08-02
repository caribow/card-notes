import re
import unittest
from pathlib import Path

HTML = Path(__file__).parents[1].joinpath("index.html").read_text(encoding="utf-8")


class FrontendContractTests(unittest.TestCase):
    def test_reference_and_create_replaces_copy_link(self):
        self.assertIn('data-action="reference-create"', HTML)
        self.assertIn('引用并新建', HTML)
        self.assertNotIn('复制双链', HTML)
        self.assertIn("openModal('[['+noteLinkToken(n)+']]\\n\\n','reference-'+id)", HTML)
        self.assertIn("function noteLinkToken(n)", HTML)
        self.assertIn("function parseBilink(value)", HTML)
        self.assertRegex(HTML, r"function openModal\([\s\S]*?setSelectionRange\(noteTextEl\.value\.length,noteTextEl\.value\.length\)")

    def test_detail_editor_has_one_cancel_and_integrated_submit(self):
        self.assertNotIn('id="detailEditCancel"', HTML)
        self.assertNotIn('id="detailEditTb"', HTML)
        self.assertIn('id="detailBackText">返回', HTML)
        self.assertIn('id="detailEditSave"', HTML)
        self.assertIn('id="detailEditorSubmit"', HTML)
        self.assertIn('.detail-mask.editing .detail-edit-save{display:none}', HTML)
        self.assertIn("document.getElementById('detailEditSave').click()", HTML)
        self.assertRegex(HTML, r"openDetailEdit\(id\)[\s\S]*?detailBackText'\)\.textContent='取消'")

    def test_recorded_on_drives_display_but_created_at_is_preserved(self):
        self.assertIn('id="noteRecordedOn"', HTML)
        self.assertIn('id="detailEditRecordedOn"', HTML)
        self.assertIn('recorded_on:n.recorded_on||null', HTML)
        self.assertIn('created_at:n.created_at', HTML)
        self.assertRegex(HTML, r"function noteDate\(n\).*?n\.recorded_on\|\|n\.time\|\|n\.created_at")
        self.assertIn("insert({text,tags,imgs,recorded_on", HTML)
        self.assertIn("update({text:newText,tags,imgs:newImgs,recorded_on}", HTML)
        self.assertIn("const recorded_on=null", HTML)
        self.assertIn("recorded_on:n.recorded_on||null", HTML)

    def test_format_tools_are_integrated_in_both_editors(self):
        self.assertEqual(HTML.count('<summary>Aa 格式</summary>'), 0)
        self.assertGreaterEqual(HTML.count('class="detail-compose-toolbar"'), 2)
        for tool in ('bold', 'list', 'numbered', 'bilink'):
            self.assertGreaterEqual(HTML.count(f'data-md="{tool}"'), 2)
        self.assertNotIn('class="format-panel detail-format-panel"', HTML)
        self.assertNotRegex(HTML, r'<div class="detail-topbar">[\s\S]{0,1200}data-md=')

    def test_new_note_uses_the_same_compose_surface(self):
        modal = re.search(r'<div class="modal" id="modal">([\s\S]*?)</div>\s*</div>\s*<!-- ===== LIGHTBOX', HTML)
        self.assertIsNotNone(modal)
        assert modal is not None
        markup = modal.group(1)
        self.assertLess(markup.index('noteText'), markup.index('imgThumbs'))
        self.assertLess(markup.index('imgThumbs'), markup.index('modalEditorOptions'))
        self.assertLess(markup.index('modalEditorOptions'), markup.index('detail-compose-toolbar'))
        for element_id in ('modalTagTool', 'imgAddBtn', 'modalDateTool', 'btnSave'):
            self.assertIn(f'id="{element_id}"', markup)
        for class_name in ('detail-editor-options', 'detail-option-input', 'detail-attachment-count', 'detail-toolbar-spacer'):
            self.assertIn(class_name, markup)
        for wrong_class in ('detail-compose-options', 'detail-tags-input', 'detail-tool-badge', 'detail-tool-spacer'):
            self.assertNotIn(wrong_class, markup)
        self.assertRegex(markup, r'detail-toolbar-spacer[\s\S]{0,200}<button class="detail-submit" id="btnSave"')
        for old_class in ('format-panel', 'date-field', 'modal-tag-input', 'img-add-btn', 'modal-foot'):
            self.assertNotIn(old_class, markup)
        self.assertNotIn('id="btnCancel"', markup)
        self.assertNotIn('saveBtn.textContent', HTML)
        self.assertIn('function toggleModalEditorOption', HTML)

    def test_numbered_list_tool_is_supported_end_to_end(self):
        self.assertIn("case'numbered':ins='1. '+(sel||'列表项')", HTML)
        self.assertIn("<ol>", HTML)
        self.assertIn("html=html.replace(/^\\d+\\. (.+)$/gm", HTML)

    def test_drafts_survive_expansion_and_clear_only_after_success(self):
        self.assertIn("const QUICK_DRAFT_KEY='flashnote-draft-quick'", HTML)
        self.assertIn("const NEW_DRAFT_KEY='flashnote-draft-new'", HTML)
        self.assertIn("const EDIT_DRAFT_PREFIX='flashnote-draft-edit-'", HTML)
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
        self.assertIn("openModal('[['+noteLinkToken(n)+']]\\n\\n','reference-'+id)", HTML)
        self.assertIn("chooseModalDraft", HTML)

    def test_cancel_discards_edit_draft_and_updates_are_optimistic(self):
        self.assertIn("updated_at:n.updated_at", HTML)
        self.assertIn("base_updated_at:n.updated_at", HTML)
        self.assertIn("function cancelDetailEdit()", HTML)
        self.assertIn("clearDraft(editDraftKey(noteId))", HTML)
        self.assertIn("noteId=currentDetailId", HTML)
        self.assertIn("newImgs=[...detailPendingImgs]", HTML)
        self.assertIn(".eq('id',noteId).eq('updated_at',n.updated_at).select()", HTML)
        self.assertIn("if(session===detailEditSession&&currentDetailId===noteId", HTML)
        self.assertIn("let detailSaveInFlight=false", HTML)
        self.assertIn("if(detailSaveInFlight){showToast('正在保存，请稍候');return}", HTML)
        self.assertIn("setDetailSaving(true)", HTML)
        self.assertIn("setDetailSaving(false)", HTML)
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

    def test_detail_editor_uses_flomo_style_compose_surface(self):
        editor = re.search(r'detailContent\.innerHTML=`(<div class="detail-inner detail-editor">.*?)`;', HTML)
        self.assertIsNotNone(editor)
        assert editor is not None
        markup = editor.group(1)
        self.assertLess(markup.index('detail-edit-area'), markup.index('detailImgThumbs'))
        self.assertLess(markup.index('detailImgThumbs'), markup.index('detailEditorOptions'))
        self.assertLess(markup.index('detailEditorOptions'), markup.index('detail-compose-toolbar'))
        self.assertIn('class=\"detail-compose\"', markup)
        self.assertIn('id=\"detailTagTool\"', markup)
        self.assertIn('id=\"detailImgAddBtn\"', markup)
        self.assertIn('id=\"detailDateTool\"', markup)
        self.assertIn('id=\"detailEditorSubmit\"', markup)
        self.assertIn('id=\"detailAttachmentCount\"', markup)
        self.assertNotIn('detail-editor-meta', markup)
        self.assertNotIn('detail-attachments', markup)
        self.assertNotIn('detail-format-panel', markup)
        self.assertIn('.detail-compose{', HTML)
        self.assertIn('.detail-compose-toolbar{', HTML)
        self.assertIn('.detail-submit{', HTML)
        self.assertIn('function toggleDetailEditorOption', HTML)
        self.assertRegex(HTML, r"async function renderDetailThumbs\(\)\{[^\n]*detailAttachmentCount")

    def test_detail_image_editor_supports_existing_delete_and_add(self):
        self.assertIn('id="detailImgAddBtn"', HTML)
        self.assertIn('id="detailImgFileInput"', HTML)
        self.assertIn('id="detailImgThumbs"', HTML)
        self.assertIn('let detailPendingImgs=[]', HTML)
        self.assertRegex(HTML, r"function removeDetailImg\(i\)")
        self.assertIn("imgs:[...n.imgs]", HTML)
        self.assertIn("detailPendingImgs=[...(draft.imgs||[])]", HTML)

    def test_async_uploads_are_bound_to_the_originating_editor_session(self):
        self.assertIn("let detailEditSession=0", HTML)
        self.assertIn("let modalEditSession=0", HTML)
        self.assertIn("function isUploadSessionCurrent", HTML)
        detail_upload = re.search(r"async function handleDetailImages\(e\)\{[^\n]+", HTML)
        self.assertIsNotNone(detail_upload)
        assert detail_upload is not None
        self.assertIn("session=detailEditSession", detail_upload.group(0))
        self.assertIn("draftKey=editDraftKey(noteId)", detail_upload.group(0))
        self.assertIn("removeStoragePaths(paths", detail_upload.group(0))
        modal_upload = re.search(r"async function handleModalImages\(e\)\{[^\n]+", HTML)
        self.assertIsNotNone(modal_upload)
        assert modal_upload is not None
        self.assertIn("session=modalEditSession", modal_upload.group(0))
        self.assertIn("draftKey=activeModalDraftKey", modal_upload.group(0))
        self.assertIn("removeStoragePaths(paths", modal_upload.group(0))
        self.assertRegex(HTML, r"function closeModal\(\)\{modalEditSession\+\+")
        self.assertRegex(HTML, r"function closeDetail\(\)\{detailEditSession\+\+")
        self.assertIn("clearDraftIfRevision(draftKey,draftRevision)", HTML)
        self.assertIn("clearDraftIfRevision(quickKey,quickRevision)", HTML)
        self.assertIn("touchDraftRevision(quickDraftKey())", HTML)
        self.assertNotIn("clearDraftIfUnchanged", HTML)
        self.assertNotIn("clearDraft(draftKey);if(source==='quick')", HTML)

    def test_mention_selection_persists_and_uses_stable_note_id(self):
        mention = re.search(r"function selectMention\(idx\)\{[^\n]+", HTML)
        self.assertIsNotNone(mention)
        assert mention is not None
        self.assertIn("noteLinkToken(note)", mention.group(0))
        self.assertIn("dispatchEvent(new Event('input'", mention.group(0))


if __name__ == "__main__":
    unittest.main()
