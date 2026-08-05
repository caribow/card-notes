// Edge Function: name-topics
// 职责：接收前端聚类后的「每簇代表笔记摘要」，调用 LLM 归纳出抽象话题名，返回结构化结果。
// 安全：LLM 密钥只存于 Edge Function secrets（OPENAI_API_KEY），运行时 Deno.env.get 注入，
//       绝不出现在源码 / 前端 / git 仓库。前端只见本函数，不见密钥。
// 鉴权：平台层 verify_jwt=true（网关校验），函数内再用 Auth API 确认用户，防公开函数被盗刷。
// CORS：必须最先处理 OPTIONS 预检，且所有响应带 CORS 头，否则浏览器 invoke 报
//       "Failed to send a request to the Edge Function"（预检被 405 拒）。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHAT_URL = 'https://api.gptsapi.net/v1/chat/completions'
const PRIMARY_MODEL = 'deepseek-v4-flash'

// AMD fallback 配置
const FALLBACK_URL = 'https://developer.amd.com.cn/radeon/v1/chat/completions'
const FALLBACK_MODEL = 'DeepSeek-V4-Flash'
const MAX_CLUSTERS = 60
const MAX_SAMPLES_PER_CLUSTER = 8
const MAX_EXCERPT_LENGTH = 500
const BATCH_SIZE = 5
const MAX_CONCURRENCY = 3
const UPSTREAM_TIMEOUT_MS = 35_000
const MAX_TOKENS = 1600

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

interface TopicResult {
  cluster_id: number
  valid: boolean
  name: string
  definition: string
  confidence: number
}

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
  }
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

function parseUpstreamResponse(rawText: string): { results: TopicResult[]; usage: unknown } {
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
    const content = chunks.join('')
    const parsed = JSON.parse(content)
    return { results: parsed.results, usage: null }
  }

  // 标准 JSON
  const body = JSON.parse(cleanText)
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('missing content')
  }

  // 尝试直接解析 content，失败则提取第一个 { 到最后一个 }
  let parsed: { results?: unknown }
  try {
    parsed = JSON.parse(content)
  } catch {
    const s = content.indexOf('{')
    const e = content.lastIndexOf('}')
    if (s >= 0 && e > s) {
      parsed = JSON.parse(content.slice(s, e + 1))
    } else {
      throw new Error('non-json content')
    }
  }

  if (!Array.isArray(parsed.results)) {
    throw new Error('missing results array')
  }

  return { results: parsed.results, usage: body.usage }
}

function validateBatchResults(results: TopicResult[], batch: ClusterInput[]): TopicResult[] {
  const expectedIds = new Set(batch.map(c => c.cluster_id))
  const seen = new Set<number>()

  for (const r of results) {
    if (!expectedIds.has(r.cluster_id)) {
      throw new Error(`unexpected cluster_id ${r.cluster_id}`)
    }
    if (seen.has(r.cluster_id)) {
      throw new Error(`duplicate cluster_id ${r.cluster_id}`)
    }
    seen.add(r.cluster_id)

    if (typeof r.valid !== 'boolean') throw new Error('invalid valid field')
    if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence)) {
      r.confidence = 0
    }
    r.confidence = Math.max(0, Math.min(1, r.confidence))

    if (r.valid && (!r.name || !r.definition)) {
      throw new Error(`cluster ${r.cluster_id} valid but missing name/definition`)
    }
  }

  // 检查是否有缺失的 cluster_id
  for (const id of expectedIds) {
    if (!seen.has(id)) {
      throw new Error(`missing cluster_id ${id}`)
    }
  }

  return results
}

async function callBatch(
  batch: ClusterInput[],
  model: string,
  apiKey: string,
  url: string = CHAT_URL,
): Promise<{ results: TopicResult[]; usage: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是严格的 JSON API。只返回一个 JSON 对象，不要解释，不要使用 Markdown。',
          },
          {
            role: 'user',
            content: buildPrompt(batch),
          },
        ],
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
        stream: false,
      }),
    })
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'AbortError'
    throw new UpstreamError(
      timeout ? `${model} timed out` : `${model} fetch failed: ${String(error)}`,
      true,
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    // 不把上游 HTML 或可能含隐私的正文返回前端
    await response.body?.cancel()
    throw new UpstreamError(
      `${model} returned ${response.status}`,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      response.status,
    )
  }

  const rawText = await response.text()
  let parsed: { results: TopicResult[]; usage: unknown }
  let results: TopicResult[]
  try {
    parsed = parseUpstreamResponse(rawText)
    results = validateBatchResults(parsed.results, batch)
  } catch (error) {
    // 200 但输出无法解析、漏簇或字段错误，也应触发备用模型，不能直接冒泡成 500。
    throw new UpstreamError(`${model} returned unusable output: ${String(error)}`, true, response.status)
  }

  return {
    results,
    usage: parsed.usage ?? null,
  }
}

async function nameBatch(batch: ClusterInput[], apiKey: string, fallbackKey: string) {
  try {
    return await callBatch(batch, PRIMARY_MODEL, apiKey)
  } catch (primaryError) {
    const e = primaryError as UpstreamError
    if (!e.retryable) throw e

    console.warn('name-topics primary failed; using AMD fallback', {
      model: PRIMARY_MODEL,
      status: e.status ?? null,
      clusterIds: batch.map(c => c.cluster_id),
      // 禁止记录 excerpt、prompt、模型原始输出
    })

    return await callBatch(batch, FALLBACK_MODEL, fallbackKey, FALLBACK_URL)
  }
}

function mergeUsage(usages: unknown[]): unknown {
  const valid = usages.filter(u => u && typeof u === 'object') as Array<Record<string, number>>
  if (valid.length === 0) return null
  const total: Record<string, number> = {}
  for (const u of valid) {
    for (const [k, v] of Object.entries(u)) {
      if (typeof v === 'number') {
        total[k] = (total[k] || 0) + v
      }
    }
  }
  return total
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
    const fallbackKey = Deno.env.get('AMD_API_KEY')
    if (!fallbackKey) {
      return jsonResponse({ error: 'missing AMD_API_KEY secret' }, 500)
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

    // 分批
    const batches: ClusterInput[][] = []
    for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
      batches.push(clusters.slice(i, i + BATCH_SIZE))
    }

    // 有界并发处理
    const outputs: Array<{ results: TopicResult[]; usage: unknown }> = new Array(batches.length)
    let nextIndex = 0

    async function worker() {
      while (true) {
        const index = nextIndex++
        if (index >= batches.length) return
        outputs[index] = await nameBatch(batches[index], apiKey, fallbackKey)
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENCY, batches.length) },
        () => worker(),
      ),
    )

    const allResults = outputs.flatMap(output => output.results)
    const usage = mergeUsage(outputs.map(output => output.usage))

    return jsonResponse({ results: allResults, usage })
  } catch (e) {
    console.error('name-topics unhandled error', e)
    // 只返回错误类别，不回传 prompt、摘要或上游原始正文。
    return jsonResponse({
      error: e instanceof UpstreamError ? 'all llm providers failed' : 'internal server error',
      detail: e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240),
    }, e instanceof UpstreamError ? 502 : 500)
  }
})
