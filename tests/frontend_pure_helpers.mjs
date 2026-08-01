import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function functionLine(name) {
  const match = html.match(new RegExp(`function ${name}\\([^\\n]+`));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

const context = {
  currentUserId: 'user-a',
  QUICK_DRAFT_KEY: 'card-notes-draft-quick',
  NEW_DRAFT_KEY: 'card-notes-draft-new',
  EDIT_DRAFT_PREFIX: 'card-notes-draft-edit-',
  MODAL_DRAFT_PREFIX: 'card-notes-draft-modal-',
  notes: [
    { id: 7, text: '重复标题\n第一条' },
    { id: 8, text: '重复标题\n第二条' },
    { id: 9, text: '' },
  ],
};
vm.createContext(context);
vm.runInContext([
  'draftStorageKey', 'quickDraftKey', 'newDraftKey', 'modalDraftKey',
  'editDraftKey', 'chooseModalDraft', 'isEditDraftCurrent', 'isUploadSessionCurrent',
  'isSignedUrlCacheFresh', 'noteTitle', 'findNoteByTitle', 'noteLinkLabel', 'noteLinkToken', 'parseBilink',
].map(functionLine).join('\n'), context);

const userAQuick = context.draftStorageKey(context.QUICK_DRAFT_KEY, 'user-a');
const userBQuick = context.draftStorageKey(context.QUICK_DRAFT_KEY, 'user-b');
assert.notEqual(userAQuick, userBQuick, 'draft keys must be isolated by user');
assert.notEqual(context.modalDraftKey('new'), context.modalDraftKey('reference-42'), 'new and reference drafts must use separate slots');
assert.notEqual(context.modalDraftKey('quick'), context.modalDraftKey('reference-42'), 'quick and reference drafts must use separate slots');
assert.notEqual(context.editDraftKey(1), context.draftStorageKey(context.EDIT_DRAFT_PREFIX + '1', 'user-b'), 'edit drafts must be isolated by user');

const existing = { text: 'keep me', imgs: ['user-a/a.webp'] };
assert.equal(context.chooseModalDraft(existing, 'new prefill', { text: '', imgs: [] }), existing, 'existing source draft must win over prefill');
assert.equal(context.chooseModalDraft(null, 'new prefill', { text: '', imgs: [] }).text, 'new prefill');

assert.equal(context.isEditDraftCurrent({ base_updated_at: 'v1' }, { updated_at: 'v1' }), true);
assert.equal(context.isEditDraftCurrent({ base_updated_at: 'v1' }, { updated_at: 'v2' }), false);
assert.equal(context.isEditDraftCurrent(null, { updated_at: 'v2' }), true);

assert.equal(context.isUploadSessionCurrent(4, 4, 'draft-a', 'draft-a', true), true);
assert.equal(context.isUploadSessionCurrent(4, 5, 'draft-a', 'draft-a', true), false);
assert.equal(context.isUploadSessionCurrent(4, 4, 'draft-a', 'draft-b', true), false);
assert.equal(context.isUploadSessionCurrent(4, 4, 'draft-a', 'draft-a', false), false);

assert.equal(context.noteLinkToken(context.notes[1]), '#8|重复标题');
assert.equal(context.parseBilink('#8|重复标题').note.id, 8, 'stable ID link must resolve the intended duplicate title');
assert.equal(context.noteLinkToken(context.notes[2]), '#9|笔记 9', 'empty titles need a usable label');

assert.equal(context.isSignedUrlCacheFresh({ expiresAt: 1_200_000 }, 1_000_000), true);
assert.equal(context.isSignedUrlCacheFresh({ expiresAt: 1_050_000 }, 1_000_000), false, 'cache inside refresh window must be treated as expired');

console.log('frontend_pure_helpers=ok');
