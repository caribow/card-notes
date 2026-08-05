// Edge Function: embed-note
// 触发方式：前端 insert/update notes 后，由前端调用本函数；或由 Database Webhook 触发。
// 职责：调用嵌入模型为单条笔记生成向量，写回 notes.embedding。
// 密钥：OPENAI_API_KEY 存于 Edge Function secrets，绝不进前端/仓库。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EMBED_URL = 'https://api.gptsapi.net/v1/embeddings'
const MODEL = 'text-embedding-3-small'

// Day One 导出中可能带有统一的 AI 回信。笔记原文照常保存，但语义向量只表示用户自己的文字。
function stripSemanticNoise(text: string): string {
  const raw = String(text ?? '')
  const marker = /\n\s*(?:(?:---|\*\*\*)\s*)?🐰月儿来信\s*[:：]?/i
  const match = marker.exec(raw)
  return (match ? raw.slice(0, match.index) : raw).trim()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'missing OPENAI_API_KEY secret' }), { status: 500 })
  }
  const allowedUserId = Deno.env.get('CARD_NOTES_OWNER_ID')
  if (!allowedUserId) {
    return new Response(JSON.stringify({ error: 'missing owner configuration' }), { status: 500 })
  }

  // 鉴权：两条合法路径
  //  A) 数据库触发器经共享密钥 INTERNAL_EMBED_SECRET 调用（pg_net 异步，无用户 JWT）
  //  B) 已登录用户（你本人）带用户 JWT 调用
  // 其余一律 401，避免公开函数被滥用刷嵌入额度。
  const authHeader = req.headers.get('Authorization') ?? ''
  const internalSecret = req.headers.get('x-embed-secret') ?? ''
  const expectedSecret = Deno.env.get('INTERNAL_EMBED_SECRET') ?? ''
  const isInternal = expectedSecret && internalSecret && internalSecret === expectedSecret

  if (!isInternal) {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    }
    if (user.id !== allowedUserId) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    }
  }

  let noteId, text
  try {
    const body = await req.json()
    // 兼容两种负载：前端直传 {note_id, text}，或 Database Webhook {record:{id,text}}
    noteId = body.note_id ?? body.record?.id
    text = body.text ?? body.record?.text
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 })
  }
  if (!noteId || !text || !String(text).trim()) {
    return new Response(JSON.stringify({ error: 'note_id and text required' }), { status: 400 })
  }

  const semanticText = stripSemanticNoise(String(text))
  if (!semanticText) {
    return new Response(JSON.stringify({ error: 'no semantic text after filtering' }), { status: 400 })
  }

  // 调嵌入模型
  const er = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: semanticText.slice(0, 8000) }),
  })
  if (!er.ok) {
    const t = await er.text()
    return new Response(JSON.stringify({ error: 'embedding api failed', detail: t }), { status: 502 })
  }
  const ej = await er.json()
  const vector = ej?.data?.[0]?.embedding
  if (!Array.isArray(vector) || vector.length !== 1536) {
    return new Response(JSON.stringify({ error: 'unexpected embedding shape' }), { status: 502 })
  }

  // 用 service_role 写回（绕过 RLS，且只更新 embedding 列）
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { error } = await supabase
    .from('notes')
    .update({ embedding: JSON.stringify(vector) })
    .eq('id', noteId)
    .eq('owner_id', allowedUserId)
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
  return new Response(JSON.stringify({ ok: true, note_id: noteId, dims: vector.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
