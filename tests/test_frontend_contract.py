import re
import unittest
from pathlib import Path

HTML = Path(__file__).parents[1].joinpath("index.html").read_text(encoding="utf-8")
EDGE = Path(__file__).parents[1].joinpath("supabase/functions/embed-note/index.ts").read_text(encoding="utf-8")
MIGRATION_SQL = "\n".join(
    p.read_text(encoding="utf-8")
    for p in sorted(Path(__file__).parents[1].joinpath("supabase/migrations").glob("*.sql"))
)


class FrontendContractTests(unittest.TestCase):
    def test_reference_and_create_replaces_copy_link(self):
        self.assertIn('data-action="reference-create"', HTML)
        self.assertIn('>引用</div>', HTML)
        self.assertNotIn('复制双链', HTML)
        self.assertIn("openModal('[['+noteLinkToken(n)+']]\\n\\n','reference-'+id,{tags:n.tags.join(' ')})", HTML)
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

    def test_both_fullscreen_editors_use_text_save_buttons(self):
        self.assertRegex(HTML, r'id="btnSave"[^>]*>保存</button>')
        self.assertRegex(HTML, r'id=\"detailEditorSubmit\"[^>]*>保存</button>')
        detail_submit = re.search(r'id=\"detailEditorSubmit\"([\s\S]{0,250})</button>', HTML)
        self.assertIsNotNone(detail_submit)
        assert detail_submit is not None
        self.assertNotIn('<svg', detail_submit.group(1))

    def test_detail_menu_is_anchored_to_its_button(self):
        self.assertIn('class="detail-menu-anchor"', HTML)
        self.assertRegex(
            HTML,
            r'<div class="detail-menu-anchor">[\s\S]{0,500}id="detailMenuBtn"',
        )
        self.assertIn('.detail-menu-anchor{position:relative;flex-shrink:0}', HTML)

    def test_desktop_sidebar_is_a_finite_card_not_a_viewport_rail(self):
        desktop = re.search(r'@media\(min-width:769px\)\{([\s\S]*?)\n\}', HTML)
        self.assertIsNotNone(desktop)
        assert desktop is not None
        css = desktop.group(1)
        self.assertIn('height:auto', css)
        self.assertIn('max-height:calc(100vh - 32px)', css)
        self.assertIn('grid-template-columns:248px minmax(0,640px)', css)
        self.assertIn('column-gap:28px', css)
        self.assertIn('max-width:916px', css)
        self.assertIn('margin:0 auto', css)
        self.assertIn('padding:32px 0 80px', css)
        self.assertIn('position:relative', css)
        self.assertNotIn('position:sticky', css)
        self.assertIn('.feed{padding:0 0 80px}', css)
        self.assertNotIn('position:relative;transform:none !important;box-shadow:none', css)

    def test_obsolete_topbar_brand_is_removed(self):
        self.assertNotIn('topbar-brand', HTML)
        self.assertNotIn('>闪念笔记</span>', HTML)

    def test_mobile_navigation_and_touch_targets_are_phone_safe(self):
        # 抓取包含 sidebar 样式的那个 768px 媒体查询块
        blocks = re.findall(r'@media\(max-width:768px\)\{([\s\S]*?)\n\}', HTML)
        css = next((b for b in blocks if '--side-w' in b), '')
        self.assertIn('--side-w:min(86vw,300px)', css)
        self.assertIn('.menu-btn{width:40px;height:40px}', css)
        self.assertIn('.card-menu-btn{width:36px;height:36px', css)
        self.assertIn('.detail-menu-btn{width:40px;height:40px}', css)
        self.assertIn('.modal .modal-textarea{font-size:16px}', css)
        self.assertIn('.detail-edit-area{font-size:16px}', css)

    def test_recorded_on_drives_display_but_created_at_is_preserved(self):
        self.assertIn('id="noteRecordedOn"', HTML)
        self.assertIn('id="detailEditRecordedOn"', HTML)
        self.assertIn('recorded_on:r.recorded_on||null', HTML)
        self.assertIn('created_at:r.created_at', HTML)
        self.assertRegex(HTML, r"function noteDate\(n\).*?n\.recorded_on\|\|n\.time\|\|n\.created_at")
        self.assertIn("insert({text,tags,imgs,recorded_on", HTML)
        self.assertIn("update({text:newText,tags,imgs:newImgs,recorded_on}", HTML)
        self.assertIn("const recorded_on=null", HTML)

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
        self.assertIn("openModal('[['+noteLinkToken(n)+']]\\n\\n','reference-'+id,{tags:n.tags.join(' ')})", HTML)
        self.assertIn("chooseModalDraft", HTML)

    def test_pin_feature_is_wired_end_to_end(self):
        self.assertIn("async function togglePin(id)", HTML)
        self.assertIn("pinned_at:newVal", HTML)
        self.assertGreaterEqual(HTML.count('data-action="pin"'), 1)
        self.assertIn("function compareNotes(a,b)", HTML)
        self.assertIn("n.pinned_at?' pinned':''", HTML)
        self.assertIn("pinned_at:r.pinned_at||null", HTML)

    def test_note_menu_is_a_single_shared_component(self):
        # 菜单全局唯一：只有一份 DOM，所有页面（首页/详情/洞察/随机漫步）复用
        self.assertEqual(HTML.count('id="noteMenuPop"'), 1)
        self.assertEqual(HTML.count('data-action="reference-create"'), 1)
        self.assertEqual(HTML.count('data-action="pin"'), 1)
        self.assertEqual(HTML.count('data-action="insight"'), 1)
        self.assertIn("function showNoteMenu(btn,id)", HTML)
        self.assertIn("if(action==='pin')togglePin(id)", HTML)
        self.assertIn("if(action==='reference-create')referenceAndCreate(id)", HTML)
        self.assertIn("if(action==='insight')openInsightFromMenu(id)", HTML)
        self.assertIn("if(action==='restore')restoreNotes([id])", HTML)
        self.assertIn("confirmDelete(id)", HTML)
        self.assertNotIn('detail-menu-item', HTML)
        self.assertNotIn('id="cardMenuPop"', HTML)

    def test_heatmap_placeholder_does_not_collide_with_global_empty_class(self):
        # 热力图月初占位格禁止使用全局 .empty 类（笔记列表空状态带 padding:60px，会撑爆格子）
        self.assertIn('class="heatmap-cell heat-empty"', HTML)
        self.assertNotIn('class="heatmap-cell empty"', HTML)
        self.assertIn('.heatmap-cell.heat-empty{', HTML)

    def test_wander_is_wired_and_uses_shared_menu(self):
        self.assertIn('id="wanderEntry"', HTML)
        self.assertIn('id="wanderMask"', HTML)
        self.assertIn('async function buildWanderList()', HTML)
        self.assertIn('WANDER_MAX', HTML)
        # 菜单弹层必须高于所有全屏页（240-250），否则被盖住
        self.assertIn('.card-menu-pop{position:fixed;z-index:650', HTML)
        # 从漫步跳转编辑/引用/洞察前先关闭漫步页
        self.assertIn("closeWander()", HTML)
        # 日期临近用环形月日距离，不是 m*31+d
        self.assertIn('function monthDayDistance(a,b)', HTML)
        self.assertNotIn('m*31+d', HTML)

    def test_recycle_bin_is_wired(self):
        self.assertIn("alter table public.notes add column if not exists deleted_at", MIGRATION_SQL)
        self.assertIn("is('deleted_at',null)", HTML)
        self.assertIn('id="trashEntry"', HTML)
        self.assertIn('id="trashMask"', HTML)
        self.assertIn('async function restoreNotes(ids)', HTML)
        self.assertIn('async function hardDeleteNotes(ids)', HTML)

    def test_note_menu_scenario_is_strictly_separated(self):
        # hidden 属性会被 display:flex 覆盖，必须有 [hidden]{display:none!important} 兜底
        self.assertIn('.card-menu-item[hidden]{display:none !important}', HTML)
        # 回收站只显示「恢复」；非回收站显示五项、隐藏「恢复」
        self.assertIn("if(inTrash){it.hidden=(a!=='restore')}", HTML)
        self.assertIn("else{it.hidden=(a==='restore')}", HTML)

    def test_trash_entry_is_below_wander_with_map_entries(self):
        # 回收站与认知地图/随机漫步同级，放在随机漫步下方、标签树上方
        wander_pos = HTML.index('id="wanderEntry"')
        trash_pos = HTML.index('id="trashEntry"')
        tree_pos = HTML.index('id="tree"')
        self.assertLess(wander_pos, trash_pos)
        self.assertLess(trash_pos, tree_pos)

    def test_wander_fullscreen_and_return_to_wander_after_edit(self):
        # 全屏=卡片右下角「展开」用详情页放大看，返回回漫步（不用浏览器 requestFullscreen）
        self.assertIn('data-wander-expand', HTML)
        self.assertIn('detailReturnToWander', HTML)
        self.assertNotIn('requestFullscreen', HTML)

    def test_notes_loading_paginates_past_postgrest_1000_row_cap(self):
        # PostgREST 单次最多 1000 行，加载必须循环 .range() 分页直到拿完
        self.assertIn('.range(from,from+PAGE-1)', HTML)
        self.assertIn('if(!data||data.length<PAGE)break', HTML)

    def test_insight_batch_tag_is_wired(self):
        self.assertIn('id="insightSelectAll"', HTML)
        self.assertIn('id="insightActionbar"', HTML)
        self.assertIn('id="batchTagMask"', HTML)
        self.assertIn('function mergeTags(existing,added)', HTML)
        self.assertIn('setupTagSuggest(batchTagInput)', HTML)
        # 追加而非覆盖：先取最新 tags 再合并，乐观锁更新
        self.assertIn(".select('id,tags,updated_at')", HTML)
        self.assertIn('.update({tags:merged})', HTML)

    def test_tag_suggest_is_bound_to_all_tag_inputs(self):
        self.assertIn("function setupTagSuggest(inp)", HTML)
        self.assertIn("setupTagSuggest(document.getElementById('noteTags'))", HTML)
        self.assertIn("setupTagSuggest(document.getElementById('detailEditTags'))", HTML)
        self.assertIn('id="tagSuggestDropdown"', HTML)

    def test_cognitive_map_is_wired(self):
        self.assertIn('id="mapEntry"', HTML)
        self.assertIn('id="mapMask"', HTML)
        self.assertIn('async function openMap()', HTML)
        self.assertIn('new UMAP(', HTML)
        self.assertIn('d3.contours()', HTML)
        self.assertIn('parseEmbedding', HTML)
        self.assertIn('umap-js', HTML)
        self.assertIn('d3@7', HTML)

    def test_cognitive_map_filters_noise_and_uses_quality_fences(self):
        self.assertIn('function isSubstantiveMapNote(note)', HTML)
        self.assertIn("tags.includes('IFTTT')", HTML)
        self.assertIn("tags.includes('Day One/Ifttt 自动化')", HTML)
        self.assertIn('function findMeaningfulThemes(pts)', HTML)
        self.assertIn('function sphericalKMeans(pts,k)', HTML)
        self.assertIn('minThemeSize', HTML)
        self.assertIn('cohesion>=THEME_MIN_COHESION', HTML)
        self.assertIn('margin>=THEME_MIN_MARGIN', HTML)
        self.assertIn('nameThemeFromContent', HTML)
        self.assertNotIn('function detectPeaks(pts)', HTML)
        self.assertNotIn("name=tt?tt[0].split('/').pop():'笔记'", HTML)

    def test_cognitive_map_uses_real_chinese_word_segmentation(self):
        self.assertIn("new Intl.Segmenter('zh-CN',{granularity:'word'})", HTML)
        self.assertIn('part.isWordLike', HTML)
        self.assertIn('CONCEPT_SINGLE_CHARS', HTML)
        self.assertNotIn('for(let len=4;len>=2;len--)', HTML)
        self.assertNotIn('seg.substr(i,len)', HTML)

    def test_semantic_text_excludes_dayone_ai_reply_without_altering_note(self):
        self.assertIn('function stripSemanticNoise(text)', HTML)
        self.assertIn('stripSemanticNoise(stripBilinks(m.note.text||', HTML)
        self.assertIn('function stripSemanticNoise(text: string)', EDGE)
        self.assertIn('🐰月儿来信', EDGE)
        self.assertIn('input: semanticText.slice(0, 8000)', EDGE)

    def test_cognitive_map_renders_per_theme_fences_and_explains_them(self):
        self.assertIn('function renderThemeFence(', HTML)
        self.assertIn('themes.filter(theme=>theme.qualified)', HTML)
        self.assertIn('id="mapThemePanel"', HTML)
        self.assertIn('代表笔记', HTML)
        self.assertIn('function showMapTheme(theme)', HTML)
        self.assertIn('data-map-note-id', HTML)
        self.assertNotIn('// 等高线（按密度）', HTML)

    def test_cognitive_map_supports_pan_pinch_and_zoom_controls(self):
        for element_id in ('mapZoomIn', 'mapZoomOut', 'mapZoomReset'):
            self.assertIn(f'id="{element_id}"', HTML)
        self.assertIn('d3.zoom().scaleExtent([0.6,8])', HTML)
        self.assertIn("svg.call(mapZoomBehavior)", HTML)
        self.assertIn('function resetMapZoom()', HTML)
        self.assertIn('touch-action:none', HTML)

    def test_mobile_fullscreen_surface(self):
        self.assertNotIn('<span class="topbar-brand">闪念笔记</span>', HTML)
        self.assertIn(".modal{max-width:none;padding:0;transform:none}", HTML)
        self.assertIn(".detail-compose{border:none;border-radius:0}", HTML)
        self.assertIn("blockBg", HTML)

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
        self.assertRegex(HTML, r"function closeDetail\(\)\{[\s\S]*?detailEditSession\+\+")
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
