// Edge Function: name-topics
// 职责：接收前端聚类后的「每簇代表笔记摘要」，调用 LLM 归纳出抽象话题名，返回结构化结果。
// 安全：LLM 密钥只存于 Edge Function secrets（OPENAI_API_KEY），运行时 Deno.env.get 注入，
//       绝不出现在源码 / 前端 / git 仓库。前端只见本函数，不见密钥。
// 鉴权：平台层 verify_jwt=true（网关校验），函数内再用 Auth API 确认用户，防公开函数被盗刷。
// CORS：必须最先处理 OPTIONS 预检，且所有响应带 CORS 头，否则浏览器 invoke 报
//       "Failed to send a request to the Edge Function"（预检被 405 拒）。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHAT_URL = 'https://api.gptsapi.net/v1/chat/completions'
const MODEL = 'deepseek-v4-flash'
const MAX_CLUSTERS = 60
const MAX_SAMPLES_PER_CLUSTER = 8
const MAX_EXCERPT_LENGTH = 500

// Supabase Edge Function 标准 CORS 头（覆盖 invoke 会带的所有请求头）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface ClusterInput {
  cluster_id: number
  samples: Array<{ date: string; excerpt: string }>
}

function parseClusters(body: unknown): ClusterInput[] {
  if (!body || typeof body !== 'object') throw new Error('invalid body')
  const clusters = (body as { clusters?: unknown }).clusters
  if (!Array.isArray(clusters) || clusters.length === 0 || clusters.length > MAX_CLUSTERS) {
    throw new Error('invalid clusters')
  }
  return clusters.map((value) => {
    const c = value as { cluster_id?: unknown; samples?: unknown }
    if (!c || typeof c !== 'object' || !Number.isSafeInteger(c.cluster_id)) throw new Error('invalid cluster_id')
    if (!Array.isArray(c.samples) || c.samples.length === 0 || c.samples.length > MAX_SAMPLES_PER_CLUSTER) {
      throw new Error('invalid samples')
    }
    const samples = c.samples.map((sv) => {
      const s = sv as { date?: unknown; excerpt?: unknown }
      if (!s || typeof s !== 'object' || typeof s.date !== 'string' || typeof s.excerpt !== 'string') {
        throw new Error('invalid sample fields')
      }
      const excerpt = s.excerpt.trim()
      if (!excerpt || excerpt.length > MAX_EXCERPT_LENGTH) throw new Error('invalid excerpt')
      return { date: s.date.trim().slice(0, 32), excerpt }
    })
    return { cluster_id: c.cluster_id as number, samples }
  })
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
  // 必须在方法限制、鉴权、读请求体之前处理浏览器 CORS 预检
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  try {
    // 平台层 verify_jwt=true 已在网关校验 JWT；这里再用 Auth API 确认有效用户
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: 'missing Supabase environment' }, 500)
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }

    // 鉴权通过后才检查密钥配置，避免向未授权请求暴露配置状态
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return jsonResponse({ error: 'missing OPENAI_API_KEY secret' }, 500)
    }

    let requestBody: unknown
    try {
      requestBody = await req.json()
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400)
    }

    let clusters: ClusterInput[]
    try {
      clusters = parseClusters(requestBody)
    } catch {
      return jsonResponse({ error: 'invalid clusters payload' }, 400)
    }

    let llmResponse: Response
    const BATCH_SIZE = 5
    const allResults: Array<{ cluster_id: number; valid: boolean; name: string; definition: string; confidence: number }> = []
    let totalUsage: unknown = null

    // 分批调用，避免单次 prompt 过长导致上游 504
    for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
      const batch = clusters.slice(i, i + BATCH_SIZE)
      try {
        llmResponse = await fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: buildPrompt(batch) }],
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
        })
      } catch (e) {
        return jsonResponse({ error: 'llm fetch failed', detail: String(e), batch_start: i }, 502)
      }

      if (!llmResponse.ok) {
        const detail = (await llmResponse.text()).slice(0, 1000)
        return jsonResponse({ error: 'llm api failed', detail, batch_start: i }, 502)
      }

      // 先读 text 再解析，兼容上游返回 BOM / SSE / 非标准 JSON 的情况
      let llmBody: unknown
      let rawText = ''
      try {
        rawText = await llmResponse.text()
        // 去 BOM
        const cleanText = rawText.replace(/^\uFEFF/, '')
        // 检测 SSE 流式格式（data: {...}\n\n）
        if (cleanText.startsWith('data: ')) {
          const chunks: string[] = []
          for (const line of cleanText.split('\n')) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const chunk = JSON.parse(line.slice(6))
                const delta = chunk?.choices?.[0]?.delta?.content
                if (typeof delta === 'string') chunks.push(delta)
              } catch { /* 忽略无法解析的行 */ }
            }
          }
          llmBody = { choices: [{ message: { content: chunks.join('') } }] }
        } else {
          llmBody = JSON.parse(cleanText)
        }
      } catch (parseErr) {
        // 记录上游原始响应特征（不记正文），便于定位
        const rawPreview = rawText.slice(0, 200)
        const previewHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawPreview))
          .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16))
        console.error('name-topics upstream parse failed', {
          status: llmResponse.status,
          contentType: llmResponse.headers.get('content-type'),
          contentLength: llmResponse.headers.get('content-length'),
          error: String(parseErr),
          rawLength: rawText.length,
          rawPreviewHash: previewHash,
          rawStartsWith: rawText.slice(0, 50).replace(/[^\x20-\x7E]/g, '?'),
          rawEndsWith: rawText.slice(-50).replace(/[^\x20-\x7E]/g, '?'),
          batch_start: i,
        })
        return jsonResponse({
          error: 'llm returned invalid response',
          detail: 'upstream body is not valid JSON',
          upstream_status: llmResponse.status,
          upstream_content_type: llmResponse.headers.get('content-type'),
          upstream_body_length: rawText.length,
          upstream_starts_with: rawText.slice(0, 80).replace(/[^\x20-\x7E]/g, '?'),
          batch_start: i,
        }, 502)
      }

      const content = (llmBody as { choices?: Array<{ message?: { content?: unknown } }> })
        ?.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        return jsonResponse({ error: 'llm response missing content', batch_start: i }, 502)
      }

      let parsed: { results?: unknown } | null = null
      try {
        parsed = JSON.parse(content)
      } catch {
        const s = content.indexOf('{')
        const e2 = content.lastIndexOf('}')
        if (s >= 0 && e2 > s) {
          try { parsed = JSON.parse(content.slice(s, e2 + 1)) } catch { parsed = null }
        }
      }
      if (!parsed || !Array.isArray(parsed.results)) {
        return jsonResponse({ error: 'llm returned non-json', raw: content.slice(0, 500), batch_start: i }, 502)
      }

      const batchResults = parsed.results as Array<{ cluster_id: number; valid: boolean; name: string; definition: string; confidence: number }>
      allResults.push(...batchResults)

      // 合并 usage（最后一批的 usage 作为代表，或累加）
      const batchUsage = (llmBody as { usage?: unknown }).usage
      if (batchUsage) totalUsage = batchUsage
    }

    return jsonResponse({ results: allResults, usage: totalUsage })
  } catch (e) {
    console.error('name-topics unhandled error', e)
    return jsonResponse({ error: 'internal server error' }, 500)
  }
})
