// Edge Function: name-topics
// 职责：接收前端聚类后的「每簇代表笔记摘要」，调用 LLM 归纳出抽象话题名，返回结构化结果。
// 安全：LLM 密钥只存于 Edge Function secrets（OPENAI_API_KEY），运行时 Deno.env.get 注入，
//       绝不出现在源码 / 前端 / git 仓库。前端只见本函数，不见密钥。
// 鉴权：必须带本人用户 JWT，否则 401，避免公开函数被盗刷。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHAT_URL = 'https://api.gptsapi.net/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'

interface ClusterInput {
  cluster_id: number
  samples: Array<{ date: string; excerpt: string }>
}

function buildPrompt(clusters: ClusterInput[]): string {
  const blocks = clusters.map((c) => {
    const lines = c.samples.map((s) => `- [${s.date}] ${s.excerpt}`).join('\n')
    return `候选簇 ${c.cluster_id}：\n${lines}`
  }).join('\n\n')

  return `下面是从一个人多年的私人笔记向量聚类得到的若干候选簇，每簇给出若干条带日期的代表笔记摘要。

你的任务：判断每个候选簇是否存在一个"反复出现的隐性话题"——即作者表面用词不同、但深层反复在写的同一个关切 / 矛盾 / 判断框架 / 反复提出的问题。

命名要求：
- 名称是抽象概念，6~14 个汉字，解释"这些表面不同的笔记为什么属于同一个话题"，而不是概括它们写了什么；
- 不得拼接高频词，不得直接复用笔记原文词或用户标签，不得照抄任一摘要的句子；
- 不得使用"生活感悟""个人成长""情绪思考""工作问题"这类空泛名称；
- 不做心理诊断，不夸大为作者的人格或长期趋势；
- 如果该簇没有清晰、可解释的共同话题，把 valid 设为 false，不要硬命名。

只返回严格 JSON（不要 markdown 代码块、不要多余文字），格式：
{"results":[{"cluster_id":数字,"valid":true或false,"name":"话题名","definition":"一句话解释这个反复出现的关切","confidence":0到1}]}

候选簇如下：

${blocks}`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'missing OPENAI_API_KEY secret' }), { status: 500 })
  }

  // 鉴权：必须是本人（有效用户 JWT），否则拒绝，防止公开函数被盗刷 LLM 额度。
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  let clusters: ClusterInput[]
  try {
    const body = await req.json()
    clusters = body.clusters
    if (!Array.isArray(clusters) || !clusters.length) throw new Error('empty')
    // 限制规模，防止异常大请求
    if (clusters.length > 60) throw new Error('too many clusters')
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid clusters payload' }), { status: 400 })
  }

  const prompt = buildPrompt(clusters)

  let llmResp
  try {
    llmResp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'llm fetch failed', detail: String(e) }), { status: 502 })
  }

  if (!llmResp.ok) {
    const t = await llmResp.text()
    return new Response(JSON.stringify({ error: 'llm api failed', detail: t }), { status: 502 })
  }

  const lj = await llmResp.json()
  const content = lj?.choices?.[0]?.message?.content ?? ''
  const usage = lj?.usage ?? null

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    // 模型偶尔会在 JSON 外包一层，尝试截取第一个 { 到最后一个 }
    const s = content.indexOf('{'); const e2 = content.lastIndexOf('}')
    if (s >= 0 && e2 > s) {
      try { parsed = JSON.parse(content.slice(s, e2 + 1)) } catch { parsed = null }
    }
  }
  if (!parsed || !Array.isArray(parsed.results)) {
    return new Response(JSON.stringify({ error: 'llm returned non-json', raw: content.slice(0, 500) }), { status: 502 })
  }

  return new Response(JSON.stringify({ results: parsed.results, usage }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
