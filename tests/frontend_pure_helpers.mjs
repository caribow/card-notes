import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function functionLine(name) {
  const match = html.match(new RegExp(`function ${name}\\([^\\n]+`));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

function functionBlock(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < html.length; i += 1) {
    if (html[i] === '{') { depth += 1; opened = true; }
    if (html[i] === '}' && opened) {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const storage = new Map();
const context = {
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  draftRevisionSeq: 0,
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
  'editDraftKey', 'nextDraftRevision', 'saveDraft', 'readDraft', 'getDraftRevision', 'clearDraft', 'clearDraftIfRevision', 'touchDraftRevision', 'chooseModalDraft', 'isEditDraftCurrent', 'isUploadSessionCurrent',
  'isSignedUrlCacheFresh', 'noteTitle', 'findNoteByTitle', 'noteLinkLabel', 'noteLinkToken', 'parseBilink',
].map(functionBlock).join('\n'), context);
vm.runInContext([functionBlock('escapeHTML'), functionBlock('renderMD')].join('\n'), context);

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

const revision1 = context.saveDraft('draft-revision', { text: 'same' });
const revision2 = context.saveDraft('draft-revision', { text: 'same' });
assert.notEqual(revision1, revision2, 'same draft content in a new generation must get a new revision');
assert.equal(context.clearDraftIfRevision('draft-revision', revision1), false, 'an old callback must not clear a newer equal-content draft');
assert.equal(context.clearDraftIfRevision('draft-revision', revision2), true);
assert.equal(context.localStorage.getItem('draft-revision'), null);
const quickRevision1 = context.saveDraft('quick-touch', 'same quick draft');
assert.equal(context.readDraft('quick-touch', ''), 'same quick draft', 'quick string draft must preserve its type and value');
const quickRevision2 = context.touchDraftRevision('quick-touch');
assert.notEqual(quickRevision1, quickRevision2, 'reopening an unchanged quick draft must advance its revision');
assert.equal(context.readDraft('quick-touch', ''), 'same quick draft');
context.saveDraft('object-draft', { text: 'same object draft', imgs: [] });
assert.equal(context.readDraft('object-draft', null).text, 'same object draft', 'object drafts must preserve their shape');
context.localStorage.setItem('legacy-quick', JSON.stringify('legacy quick text'));
assert.equal(context.readDraft('legacy-quick', ''), 'legacy quick text', 'legacy string drafts must remain readable');
context.localStorage.setItem('legacy-object', JSON.stringify({ text: 'legacy object' }));
assert.equal(context.readDraft('legacy-object', null).text, 'legacy object', 'legacy object drafts must remain readable');

assert.equal(
  context.renderMD('1. ordered\n- unordered'),
  '<ol><li>ordered</li></ol><ul><li>unordered</li></ul>',
  'an ordered list followed by an unordered list must render as adjacent blocks',
);
assert.equal(
  context.renderMD('- unordered\n1. ordered'),
  '<ul><li>unordered</li></ul><ol><li>ordered</li></ol>',
  'an unordered list followed by an ordered list must render as adjacent blocks',
);

assert.equal(context.noteLinkToken(context.notes[1]), '#8|重复标题');
assert.equal(context.parseBilink('#8|重复标题').note.id, 8, 'stable ID link must resolve the intended duplicate title');
assert.equal(context.noteLinkToken(context.notes[2]), '#9|笔记 9', 'empty titles need a usable label');

assert.equal(context.isSignedUrlCacheFresh({ expiresAt: 1_200_000 }, 1_000_000), true);
assert.equal(context.isSignedUrlCacheFresh({ expiresAt: 1_050_000 }, 1_000_000), false, 'cache inside refresh window must be treated as expired');

console.log('frontend_pure_helpers=ok');
