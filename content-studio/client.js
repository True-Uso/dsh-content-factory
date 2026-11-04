window.__ModuleLoader__.load({
  id: '@local/content-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/content-studio/api'

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */
    const LINE = '1px solid color-mix(in srgb, currentColor 18%, transparent)'
    const SOFT = 'color-mix(in srgb, currentColor 6%, transparent)'

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 32px' },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      spread: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' },
      col: { display: 'flex', flexDirection: 'column', gap: 8 },
      card: { border: LINE, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
      muted: { opacity: 0.62, fontSize: 12 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
      btn: {
        font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 7,
        border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      },
      btnOn: {
        font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 7,
        border: '1px solid color-mix(in srgb, currentColor 40%, transparent)',
        background: 'color-mix(in srgb, currentColor 12%, transparent)',
        color: 'inherit', cursor: 'pointer',
      },
      tab: (active) => ({
        font: 'inherit', fontSize: 13, padding: '6px 12px', cursor: 'pointer',
        borderBottom: active ? '2px solid currentColor' : '2px solid transparent',
        background: 'transparent', color: 'inherit', opacity: active ? 1 : 0.6,
      }),
      input: {
        font: 'inherit', fontSize: 12, padding: '5px 8px', borderRadius: 7,
        border: LINE, background: SOFT, color: 'inherit', minWidth: 0,
      },
      area: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5,
        width: '100%', minHeight: 180, padding: 10, borderRadius: 8, border: LINE, background: SOFT,
        color: 'inherit', boxSizing: 'border-box',
      },
      badge: (tone) => ({
        fontSize: 11, padding: '1px 7px', borderRadius: 999, border: LINE,
        opacity: 0.9, whiteSpace: 'nowrap',
        background: tone === 'ok' ? 'color-mix(in srgb, #2ea043 18%, transparent)'
          : tone === 'warn' ? 'color-mix(in srgb, #d29922 20%, transparent)'
          : tone === 'bad' ? 'color-mix(in srgb, #f85149 18%, transparent)'
          : 'transparent',
      }),
      media: { width: '100%', maxHeight: 420, borderRadius: 10, background: '#000', objectFit: 'contain' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 },
      pre: {
        margin: 0, padding: 10, borderRadius: 8, border: LINE, maxHeight: 220, overflow: 'auto',
        fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      },
      progress: { height: 4, borderRadius: 999, background: SOFT, overflow: 'hidden' },
      progressFill: (pct) => ({ height: '100%', width: `${Math.round(pct * 100)}%`, background: 'currentColor', opacity: 0.5 }),
      dot: (on) => ({ width: 7, height: 7, borderRadius: 999, background: 'currentColor', opacity: on ? 0.9 : 0.22 }),
    }

    const ITEM_STATUS_ZH = {
      pending: '待处理', running: '生成中', review_pending: '待审核', approved: '已通过',
      rejected: '已驳回', failed: '失败', cancelled: '已取消',
    }
    const STATUS_TONE = {
      review_pending: 'warn', approved: 'ok', failed: 'bad', rejected: 'bad', running: '', pending: '', cancelled: '',
    }
    const BATCH_STATUS_ZH = {
      draft: '草稿', queued: '排队', running: '运行中', paused: '已暂停', review: '待审核',
      done: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消',
    }
    const BATCH_STATUS_TONE = {
      running: '', paused: 'warn', review: 'warn', done: 'ok', failed: 'bad', partial: 'warn',
    }
    const REVIEW_MODE_ZH = { required: '需人工审核', auto: '自动放行' }
    const PAUSE_REASON_ZH = { user: '手动暂停', cost_cap: '成本达到上限' }
    const STEP_ZH = {
      script: '文案', voice: '配音', subtitle: '字幕', visual: '画面',
      plan: '剪辑方案', render: '渲染', cover: '封面', validate: '校验',
    }
    const REVIEW_REASONS = ['文案质量', '画面质量', '封面问题', '配音问题', '字幕错误', '时长不符', '其他']

    /* ------------------------------------------------------------------ */
    /* api                                                                 */
    /* ------------------------------------------------------------------ */
    async function api(method, path, body) {
      const res = await fetch(API + path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let data
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { raw: text }
      }
      if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
      return data
    }

    function Badge({ tone, children }) {
      return h('span', { style: S.badge(tone) }, children)
    }

    function platformLabel(platforms, id) {
      return (platforms || []).find((platform) => platform.id === id)?.label || id || '—'
    }

    async function downloadZip(path, filename) {
      const res = await fetch(API + path)
      if (!res.ok) {
        const text = await res.text()
        let message = `${res.status} ${res.statusText}`
        try { message = JSON.parse(text).error || message } catch { /* keep status text */ }
        throw new Error(message)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }

    /* ------------------------------------------------------------------ */
    /* 批次                                                            */
    /* ------------------------------------------------------------------ */
    function NewBatchForm({ onCreated, groups, health, services, platforms = [] }) {
      const [form, setForm] = useState({
        title: '', topic: '', count: 5, dirs: '', group: '', targetSec: 26,
        aspectRatio: '9:16', materialMode: 'folder', shotCount: 8, voice: '', transition: 'cut', concurrency: '',
        platform: 'douyin', publishStartAt: '', publishIntervalMinutes: 1440, reviewMode: 'required', costCap: '',
      })
      const [busy, setBusy] = useState('')
      const [message, setMessage] = useState(null)
      const [scanned, setScanned] = useState(null)

      const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
      const platformPreset = useMemo(
        () => (platforms || []).find((platform) => platform.id === form.platform),
        [platforms, form.platform],
      )
      const changePlatform = (event) => {
        const id = event.target.value
        const preset = (platforms || []).find((platform) => platform.id === id)
        setForm((current) => ({
          ...current,
          platform: id,
          aspectRatio: preset?.aspectRatio || current.aspectRatio,
          targetSec: preset?.targetSec || current.targetSec,
        }))
      }

      const dirList = useMemo(
        () => form.dirs.split(/[\n;,]/).map((s) => s.trim()).filter(Boolean),
        [form.dirs],
      )

      const scan = async () => {
        setBusy('scan')
        setMessage(null)
        try {
          const result = await api('POST', '/materials/scan', { dirs: dirList })
          setScanned(result)
          setMessage({ ok: true, text: `扫描完成：${result.total} 个素材，${result.invalid.length} 个无效` })
        } catch (error) {
          setMessage({ ok: false, text: error.message })
        } finally {
          setBusy('')
        }
      }

      const create = async () => {
        setBusy('create')
        setMessage(null)
        try {
          const config = {
            topic: form.topic || form.title,
            style: '',
            platform: form.platform,
            targetSec: Number(form.targetSec) || 26,
            aspectRatio: form.aspectRatio,
            materialMode: form.materialMode,
            group: form.group || undefined,
            shotCount: Number(form.shotCount) || 8,
            voice: form.voice || undefined,
            transition: form.transition,
            concurrency: Number(form.concurrency) > 0 ? Number(form.concurrency) : undefined,
            publishStartAt: form.publishStartAt || null,
            publishIntervalMinutes: Number(form.publishIntervalMinutes) || 0,
            reviewMode: form.reviewMode,
            costCap: Number(form.costCap) > 0 ? Number(form.costCap) : null,
          }
          const result = await api('POST', '/batches', { title: form.title || form.topic, count: Number(form.count) || 1, config })
          const warnings = result.preflight?.warnings || []
          setMessage({
            ok: true,
            text: warnings.length > 0
              ? `批次已创建：${result.batch.id} —— 注意：${warnings.join('；')}`
              : `批次已创建：${result.batch.id}`,
            warnings,
          })
          onCreated?.(result.batch)
        } catch (error) {
          setMessage({ ok: false, text: error.message })
        } finally {
          setBusy('')
        }
      }

      const ready = (form.topic || form.title) && Number(form.count) > 0

      return h(
        'div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, '新建批次'),
        health && health.ffmpeg && !health.ffmpeg.ok
          ? h('div', { style: { ...S.muted, color: '#f85149' } }, health.ffmpeg.error || 'ffmpeg 不可用')
          : null,
        h('div', { style: S.row },
          h('select', { style: { ...S.input, flex: '0 0 110px' }, value: form.platform, onChange: changePlatform },
            (platforms.length > 0 ? platforms : [{ id: 'douyin', label: '抖音' }]).map((platform) =>
              h('option', { key: platform.id, value: platform.id }, platform.label))),
          h('input', { style: { ...S.input, flex: '2 1 220px' }, placeholder: '主题（必填）', value: form.topic, onChange: set('topic') }),
          h('input', { style: { ...S.input, flex: '1 1 80px' }, type: 'number', min: 1, max: 200, placeholder: '数量', value: form.count, onChange: set('count') }),
          h('input', { style: { ...S.input, flex: '1 1 90px' }, type: 'number', placeholder: '目标秒数', value: form.targetSec, onChange: set('targetSec') }),
        ),
        h('div', { style: S.row },
          h('select', { style: { ...S.input, flex: '1 1 100px' }, value: form.aspectRatio, onChange: set('aspectRatio') },
            ['9:16', '16:9', '1:1', '4:5'].map((v) => h('option', { key: v, value: v }, v))),
          h('select', { style: { ...S.input, flex: '1 1 110px' }, value: form.materialMode, onChange: set('materialMode') },
            h('option', { value: 'folder' }, '按分类取材'),
            h('option', { value: 'pool' }, '全库混剪')),
          h('select', { style: { ...S.input, flex: '1 1 140px' }, value: form.group, onChange: set('group') },
            h('option', { value: '' }, '分类：自动'),
            (groups || []).map((g) => h('option', { key: g.group, value: g.group }, `${g.group} (${g.count})`))),
          h('select', { style: { ...S.input, flex: '1 1 100px' }, value: form.transition, onChange: set('transition') },
            h('option', { value: 'cut' }, '硬切'),
            h('option', { value: 'fade' }, '淡入淡出')),
          h('input', { style: { ...S.input, flex: '1 1 120px' }, placeholder: '音色（可留空）', value: form.voice, onChange: set('voice') }),
          h('input', {
            style: { ...S.input, flex: '0 0 90px' }, type: 'number', min: 1, max: 8, placeholder: '并发',
            value: form.concurrency, onChange: set('concurrency'),
          }),
        ),
        h('div', { style: S.row },
          h('span', { style: S.muted }, '发布设置'),
          h('input', {
            style: { ...S.input, flex: '1 1 190px' }, type: 'datetime-local',
            title: '计划发布起点（只记录，不自动发布）', value: form.publishStartAt, onChange: set('publishStartAt'),
          }),
          h('input', {
            style: { ...S.input, flex: '0 0 120px' }, type: 'number', min: 0, placeholder: '间隔（分钟）',
            value: form.publishIntervalMinutes, onChange: set('publishIntervalMinutes'),
          }),
          h('select', { style: { ...S.input, flex: '0 0 130px' }, value: form.reviewMode, onChange: set('reviewMode') },
            h('option', { value: 'required' }, '需人工审核'),
            h('option', { value: 'auto' }, '自动放行')),
          h('input', {
            style: { ...S.input, flex: '0 0 120px' }, type: 'number', min: 0, step: '0.01', placeholder: '成本上限 ¥',
            value: form.costCap, onChange: set('costCap'),
          }),
          platformPreset
            ? h('span', { style: S.muted }, `标题上限 ${platformPreset.titleMaxLength} 字（仅提示）`)
            : null,
        ),
        h('textarea', {
          style: { ...S.input, minHeight: 56, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
          placeholder: '素材目录，一行一个（例如 D:\\素材\\穿搭）',
          value: form.dirs,
          onChange: set('dirs'),
        }),
        h('div', { style: S.row },
          h('button', { style: S.btn, onClick: scan, disabled: busy === 'scan' || dirList.length === 0 },
            busy === 'scan' ? '扫描中…' : '先扫描素材'),
          h('button', {
            style: S.btn,
            disabled: !services?.pickDirectory,
            title: services?.pickDirectory ? '打开系统目录选择器' : '当前环境不支持目录选择',
            onClick: async () => {
              try {
                const picked = await services.pickDirectory()
                if (!picked) return
                setForm((current) => ({
                  ...current,
                  dirs: current.dirs.trim() ? `${current.dirs.trim()}\n${picked}` : picked,
                }))
              } catch (e) {
                setMessage({ ok: false, text: `选择目录失败：${e.message}` })
              }
            },
          }, '选择目录'),
          h('button', { style: S.btnOn, onClick: create, disabled: busy === 'create' || !ready },
            busy === 'create' ? '创建中…' : '创建批次'),
          scanned ? h('span', { style: S.muted }, `索引 ${scanned.total} 个 · ${scanned.groups.map((g) => `${g.group}:${g.count}`).join(' / ')}`) : null,
        ),
        message
          ? h('div', {
              style: {
                fontSize: 12,
                color: message.ok ? (message.warnings?.length ? '#d29922' : 'inherit') : '#f85149',
                opacity: message.ok && !message.warnings?.length ? 0.75 : 1,
              },
            }, message.text)
          : null,
      )
    }

    const ROLE_ZH = { llm: '文案模型', tts: '配音模型', video: '视频模型', image: '生图模型' }

    /** 首次使用的就绪检查：缺什么、点哪里，直接说清楚。 */
    function Readiness({ health, onConfigure }) {
      if (!health) return null
      const issues = []
      if (!health.ffmpeg?.ok) issues.push(health.ffmpeg?.error || 'ffmpeg 未就绪')
      const roles = new Set((health.providers || []).filter((p) => p.enabled).map((p) => p.role))
      const missing = ['llm', 'tts', 'video'].filter((role) => !roles.has(role))
      if (missing.length > 0) issues.push(`缺少${missing.map((role) => ROLE_ZH[role]).join('、')}`)
      if (issues.length === 0) return null

      return h('div', { style: { ...S.card, borderColor: 'color-mix(in srgb, #d29922 55%, transparent)' } },
        h('strong', { style: { fontSize: 13 } }, '还不能开始生产'),
        issues.map((text, index) => h('div', { key: index, style: { fontSize: 12, opacity: 0.85 } }, `· ${text}`)),
        h('div', { style: S.row },
          missing.length > 0 ? h('button', { style: S.btnOn, onClick: onConfigure }, '去配置模型') : null,
          !health.ffmpeg?.ok
            ? h('span', { style: S.muted }, '把 ffmpeg.exe / ffprobe.exe 放进 ~/.content-studio/bin/，或用 CONTENT_STUDIO_FFMPEG 指定路径')
            : null,
        ),
      )
    }

    function StepStrip({ steps }) {
      return h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
        Object.entries(STEP_ZH).map(([key, label]) => {
          const status = steps?.[key]?.status || 'pending'
          const tone = status === 'done' ? 'ok' : status === 'running' ? 'warn' : status === 'failed' ? 'bad' : ''
          return h('span', { key, style: { ...S.badge(tone), opacity: status === 'pending' ? 0.4 : 0.95 } }, label)
        }),
      )
    }

    function UsageLine({ totals }) {
      if (!totals || !totals.usage) return null
      const usage = totals.usage
      const parts = []
      if (usage.llmTokens) parts.push(`文案 ${usage.llmTokens} token`)
      if (usage.ttsCharacters) parts.push(`配音 ${usage.ttsCharacters} 字 / ${Number(usage.ttsSeconds || 0).toFixed(1)}s`)
      if (usage.videoSeconds) parts.push(`生成 ${Number(usage.videoSeconds).toFixed(1)}s × ${usage.videoShots || 0} 镜`)
      if (usage.imageCount) parts.push(`生图 ${usage.imageCount} 张`)
      if (parts.length === 0) return null
      const price = totals.cost && totals.cost.priced ? `≈ ${totals.cost.currency} ${totals.cost.total.toFixed(2)}` : '未配置价目表'
      return h('div', { style: S.muted }, `用量：${parts.join(' · ')} —— ${price}`)
    }

    function CostBar({ totals }) {
      if (!totals || !totals.costCap) return null
      const spent = Number(totals.cost?.total) || 0
      const pct = Math.min(100, Math.round((totals.capRatio || 0) * 100))
      const tone = totals.capReached ? '#f85149' : totals.capWarning ? '#d29922' : 'currentColor'
      return h('div', { style: S.col },
        h('div', { style: S.spread },
          h('span', { style: { fontSize: 12 } }, `成本上限 ¥${totals.costCap.toFixed(2)}`),
          h('span', { style: { ...S.muted, color: tone } },
            totals.cost?.priced ? `已用 ¥${spent.toFixed(2)} · ${pct}%` : '未配置价目表，成本仍为 0')),
        h('div', { style: S.progress },
          h('div', { style: { ...S.progressFill(Math.min(1, totals.capRatio || 0)), background: tone } })),
        totals.capReached
          ? h('div', { style: { ...S.muted, color: '#f85149' } }, '已达到成本上限，队列会暂停，等人工提高上限后继续')
          : totals.capWarning
            ? h('div', { style: { ...S.muted, color: '#d29922' } }, '已使用 80% 以上')
            : null,
      )
    }

    function LogViewer({ batchId, onError }) {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const load = useCallback(async () => {
        setBusy(true)
        try {
          setData(await api('GET', `/batches/${batchId}/log`))
        } catch (error) {
          onError?.(error.message)
        } finally {
          setBusy(false)
        }
      }, [batchId, onError])
      useEffect(() => { load() }, [load])
      if (!data) return h('div', { style: S.muted }, busy ? '读取日志…' : '')
      return h('div', { style: S.card },
        h('div', { style: S.spread },
          h('strong', { style: { fontSize: 13 } }, '生产日志'),
          h('button', { style: S.btn, onClick: load }, busy ? '刷新中…' : '刷新'),
        ),
        h('div', { style: S.muted }, '批次日志'),
        h('pre', { style: S.pre }, data.batch || '（空）'),
        (data.items || []).map((item) => h('details', { key: item.id, style: { marginTop: 8 } },
          h('summary', { style: { fontSize: 12, cursor: 'pointer' } }, `${String(item.seq || '').padStart(2, '0')} ${item.id}`),
          h('pre', { style: S.pre }, item.log || '（空）'),
        )),
      )
    }

    function BatchDetail({ batchId, onOpenReview, refreshKey, onDeleted, platforms = [] }) {
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [showLog, setShowLog] = useState(false)
      const [exporting, setExporting] = useState('')

      const load = useCallback(async () => {
        try {
          setDetail(await api('GET', `/batches/${batchId}`))
          setError('')
        } catch (e) {
          setError(e.message)
        }
      }, [batchId])

      useEffect(() => { load() }, [load, refreshKey])

      const act = async (label, path) => {
        setBusy(path)
        try {
          await api('POST', path)
          await load()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy('')
        }
      }

      const approveAll = async () => {
        const pending = (detail?.batch?.items || []).filter((item) => item.status === 'review_pending')
        if (pending.length === 0) return
        setBusy('approve-all')
        const failed = []
        for (const item of pending) {
          try {
            await api('POST', `/items/${item.id}/approve`, { note: '批量通过' })
          } catch (e) {
            failed.push(`${item.seq}: ${e.message}`)
          }
        }
        await load()
        setBusy('')
        if (failed.length > 0) setError(`部分通过失败：${failed.join('；')}`)
      }

      const exportBatch = async () => {
        setExporting('batch')
        setError('')
        try {
          await downloadZip(`/batches/${batchId}/export`, `content-studio-${batchId}.zip`)
        } catch (e) {
          setError(e.message)
        } finally {
          setExporting('')
        }
      }

      const exportItem = async (item) => {
        setExporting(item.id)
        setError('')
        try {
          await downloadZip(`/items/${item.id}/export`, `content-studio-item-${String(item.seq).padStart(3, '0')}.zip`)
        } catch (e) {
          setError(e.message)
        } finally {
          setExporting('')
        }
      }

      if (error) return h('div', { style: S.card }, `读取失败：${error}`)
      if (!detail) return h('div', { style: S.muted }, '读取中…')

      const { batch } = detail
      const counts = batch.items.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1
        return acc
      }, {})

      return h('div', { style: S.col },
        h('div', { style: S.spread },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, batch.title),
            h(Badge, { tone: BATCH_STATUS_TONE[batch.status] || '' }, BATCH_STATUS_ZH[batch.status] || batch.status),
            h('span', { style: S.muted }, platformLabel(platforms, batch.config?.platform)),
            h('span', { style: S.muted }, REVIEW_MODE_ZH[batch.config?.reviewMode] || '需人工审核'),
            h('span', { style: S.muted }, `${batch.items.length} 条`),
            Object.entries(counts).map(([status, count]) =>
              h('span', { key: status, style: S.muted }, `${ITEM_STATUS_ZH[status] || status} ${count}`)),
          ),
          h('div', { style: S.row },
            h('button', { style: S.btnOn, disabled: exporting === 'batch', onClick: exportBatch }, exporting === 'batch' ? '导出中…' : '导出整批'),
            h('button', { style: S.btn, onClick: () => setShowLog((open) => !open) }, showLog ? '收起日志' : '生产日志'),
            h('button', { style: S.btn, onClick: () => act('start', `/batches/${batch.id}/start`) }, '开始'),
            h('button', { style: S.btn, onClick: () => act('pause', `/batches/${batch.id}/pause`) }, '暂停'),
            h('button', { style: S.btn, onClick: () => act('resume', `/batches/${batch.id}/resume`) }, '继续'),
            h('button', { style: S.btn, onClick: () => act('cancel', `/batches/${batch.id}/cancel`) }, '取消'),
            h('button', {
              style: S.btnOn,
              disabled: busy !== '' || !batch.items.some((item) => item.status === 'review_pending'),
              onClick: approveAll,
            }, busy === 'approve-all' ? '通过中…' : '通过全部待审'),
            h('button', { style: S.btn, onClick: load }, '刷新'),
            h('button', {
              style: S.btn,
              onClick: async () => {
                if (!window.confirm('删除这个批次及其全部产物？不可恢复。')) return
                try {
                  await api('DELETE', `/batches/${batch.id}?purge=1`)
                  onDeleted?.(batch.id)
                } catch (e) {
                  setError(e.message)
                }
              },
            }, '删除'),
          ),
        ),
        h('div', { style: S.muted },
          batch.config?.publishStartAt
            ? `计划发布 ${new Date(batch.config.publishStartAt).toLocaleString('zh-CN')} · 间隔 ${batch.config.publishIntervalMinutes} 分钟`
            : '未设置计划发布时间（只记录，不自动发布）'),
        batch.status === 'paused' && batch.pauseReason
          ? h('div', { style: { ...S.card, borderColor: 'color-mix(in srgb, #d29922 55%, transparent)' } },
              h('span', { style: { fontSize: 12, color: '#d29922' } }, `已暂停：${PAUSE_REASON_ZH[batch.pauseReason] || batch.pauseReason}`),
              batch.pauseReason === 'cost_cap'
                ? h('button', {
                    style: S.btnOn,
                    disabled: busy === 'cap',
                    onClick: async () => {
                      const value = window.prompt('新的成本上限（¥）', String(batch.config?.costCap || ''))
                      if (!value) return
                      setBusy('cap')
                      try {
                        await api('POST', `/batches/${batch.id}/config`, { costCap: Number(value) })
                        await api('POST', `/batches/${batch.id}/resume`)
                        await load()
                      } catch (e) {
                        setError(e.message)
                      } finally {
                        setBusy('')
                      }
                    },
                  }, '提高上限并继续')
                : null,
            )
          : null,
        batch.items.some((item) => item.status === 'running') ? h('div', { style: S.muted }, '有任务正在运行，可点刷新查看进度') : null,
        h(UsageLine, { totals: batch.totals }),
        h(CostBar, { totals: batch.totals }),
        showLog ? h(LogViewer, { batchId: batch.id, onError: setError }) : null,
        h('div', { style: S.grid },
          batch.items.map((item) =>
            h('div', { key: item.id, style: S.card },
              h('div', { style: S.spread },
                h('span', { style: { fontSize: 12, fontWeight: 600 } }, `${String(item.seq).padStart(2, '0')} ${item.title || '（未命名）'}`),
                h('div', { style: S.row },
                  item.autoRetries ? h('span', { style: S.muted }, `自动重试 ${item.autoRetries}`) : null,
                  h(Badge, { tone: STATUS_TONE[item.status] || '' }, ITEM_STATUS_ZH[item.status] || item.status),
                ),
              ),
              h(StepStrip, { steps: item.steps }),
              h('div', { style: S.row },
                item.status === 'review_pending'
                  ? h('button', { style: S.btnOn, onClick: () => onOpenReview(item.id, batch.items.filter((i) => i.status === 'review_pending').map((i) => i.id)) }, '去审核')
                  : null,
                item.status === 'approved'
                  ? h('button', { style: S.btnOn, disabled: exporting === item.id, onClick: () => exportItem(item) }, exporting === item.id ? '导出中…' : '导出发布包')
                  : null,
                item.status === 'failed'
                  ? h('button', { style: S.btn, onClick: () => act('retry', `/items/${item.id}/retry`) }, '重新入队')
                  : null,
              ),
              item.error ? h('div', { style: { ...S.muted, color: '#f85149' } }, String(item.error).slice(0, 160)) : null,
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 审核                                                             */
    /* ------------------------------------------------------------------ */
    function ReviewCard({ itemId, onDone, index, total, onPrev, onNext }) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [reason, setReason] = useState(REVIEW_REASONS[0])
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState('')
      const [saved, setSaved] = useState(false)
      const [draft, setDraft] = useState({ title: '', description: '', hashtags: '', coverMain: '', coverSub: '' })

      const load = useCallback(async () => {
        try {
          setData(await api('GET', `/items/${itemId}`))
          setError('')
        } catch (e) {
          setError(e.message)
        }
      }, [itemId])

      useEffect(() => { load() }, [load])

      // Seed the editable copy whenever the item reloads.
      useEffect(() => {
        const source = data?.script
        if (!source) return
        setDraft({
          title: source.title || '',
          description: source.description || '',
          hashtags: (source.hashtags || []).join(' '),
          coverMain: source.coverText?.main || '',
          coverSub: source.coverText?.sub || '',
        })
      }, [data])

      // 键盘：a 通过 / r 驳回 / ←→ 翻页。输入框里打字时不拦截。
      // 必须在任何 early return 之前注册，否则 hooks 顺序会随渲染变化。
      useEffect(() => {
        const onKey = (event) => {
          const tag = String(event.target?.tagName || '').toLowerCase()
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return
          const status = data?.item?.status
          if (event.key === 'a' && status === 'review_pending') {
            api('POST', `/items/${itemId}/approve`, { note }).then(() => { load(); onDone?.() }).catch(() => {})
          } else if (event.key === 'r' && status === 'review_pending') {
            api('POST', `/items/${itemId}/reject`, { reason, note }).then(() => { load(); onDone?.() }).catch(() => {})
          } else if (event.key === 'ArrowRight') {
            onNext?.()
          } else if (event.key === 'ArrowLeft') {
            onPrev?.()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [itemId, data, note, reason, onNext, onPrev, load, onDone])

      const act = async (label, path, body) => {
        setBusy(label)
        try {
          await api('POST', path, body)
          await load()
          onDone?.()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy('')
        }
      }

      if (error) return h('div', { style: S.card }, `读取失败：${error}`)
      if (!data) return h('div', { style: S.muted }, '读取中…')

      const { item, script, report, review, media } = data
      const base = media.base
      const approved = item.status === 'approved'
      const rejected = item.status === 'rejected'

      return h('div', { style: S.col },
        h('div', { style: S.spread },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, script?.title || item.title || item.id),
            h(Badge, { tone: STATUS_TONE[item.status] || '' }, ITEM_STATUS_ZH[item.status] || item.status),
            h('span', { style: S.muted }, item.durationSec ? `${item.durationSec.toFixed(1)}s` : ''),
            typeof index === 'number' && total
              ? h('span', { style: S.muted }, `${index + 1} / ${total}`)
              : null,
          ),
          h('div', { style: S.row },
            onPrev ? h('button', { style: S.btn, onClick: onPrev }, '← 上一条') : null,
            onNext ? h('button', { style: S.btn, onClick: onNext }, '下一条 →') : null,
            h('button', { style: S.btn, onClick: load }, '刷新'),
          ),
        ),

        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(240px, 1fr)', gap: 12 } },
          h('div', { style: S.col },
            media.master > 0
              ? h('video', { key: `${itemId}-${media.master}`, src: `${base}/06-render/master.mp4`, controls: true, style: S.media })
              : h('div', { style: { ...S.card, ...S.muted } }, '成片尚未生成'),
            media.covers.vertical > 0
              ? h('img', { src: `${base}/07-cover/cover-vertical.png`, style: { width: '100%', borderRadius: 10, border: LINE } })
              : null,
          ),
          h('div', { style: S.col },
            h('div', null, h('div', { style: S.muted }, '标题'), h('input', {
              style: { ...S.input, width: '100%', boxSizing: 'border-box' },
              value: draft.title, disabled: busy !== '' || approved,
              onChange: (e) => setDraft({ ...draft, title: e.target.value }),
            })),
            h('div', null, h('div', { style: S.muted }, '简介'), h('textarea', {
              style: { ...S.input, width: '100%', minHeight: 54, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' },
              value: draft.description, disabled: busy !== '' || approved,
              onChange: (e) => setDraft({ ...draft, description: e.target.value }),
            })),
            h('div', null, h('div', { style: S.muted }, '标签（空格分隔）'), h('input', {
              style: { ...S.input, width: '100%', boxSizing: 'border-box' },
              value: draft.hashtags, disabled: busy !== '' || approved,
              onChange: (e) => setDraft({ ...draft, hashtags: e.target.value }),
            })),
            h('div', { style: S.row },
              h('div', { style: { flex: '1 1 90px' } },
                h('div', { style: S.muted }, '封面主文案'),
                h('input', {
                  style: { ...S.input, width: '100%', boxSizing: 'border-box' },
                  value: draft.coverMain, disabled: busy !== '' || approved,
                  onChange: (e) => setDraft({ ...draft, coverMain: e.target.value }),
                })),
              h('div', { style: { flex: '1 1 90px' } },
                h('div', { style: S.muted }, '封面副文案'),
                h('input', {
                  style: { ...S.input, width: '100%', boxSizing: 'border-box' },
                  value: draft.coverSub, disabled: busy !== '' || approved,
                  onChange: (e) => setDraft({ ...draft, coverSub: e.target.value }),
                })),
            ),
            h('div', { style: S.row },
              h('button', {
                style: S.btnOn,
                disabled: busy !== '' || approved,
                onClick: async () => {
                  setBusy('save-copy')
                  try {
                    await api('POST', `/items/${itemId}/script`, {
                      title: draft.title,
                      description: draft.description,
                      hashtags: draft.hashtags.split(/\s+/).map((t) => t.trim()).filter(Boolean),
                      coverText: { main: draft.coverMain, sub: draft.coverSub },
                    })
                    setSaved(true)
                    setTimeout(() => setSaved(false), 2000)
                    await load()
                    onDone?.()
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setBusy('')
                  }
                },
              }, saved ? '已保存，将重跑校验' : '保存文案'),
              h('span', { style: S.muted }, '只重跑校验，不重新渲染'),
            ),
            report
              ? h('div', null,
                  h('div', { style: S.muted }, `校验：${report.summary.passed}/${report.summary.total} 通过 · ${report.summary.warnings} 告警`),
                  report.errors.length > 0 ? h('div', { style: { color: '#f85149', fontSize: 12 } }, report.errors.map((e) => `${e.id}: ${e.detail}`).join('；')) : null,
                  report.warnings.length > 0 ? h('div', { style: { ...S.muted, fontSize: 12 } }, report.warnings.map((w) => `${w.id}: ${w.detail}`).join('；')) : null,
                )
              : null,
            review ? h('div', { style: S.muted }, `上次审核：${review.decision === 'approved' ? '通过' : review.decision === 'withdrawn' ? '已撤回' : '驳回'}${review.reason ? ` · ${review.reason}` : ''}${review.note ? ` · ${review.note}` : ''}`) : null,
          ),
        ),

        h('div', { style: S.row },
          h('button', {
            style: S.btnOn,
            disabled: busy !== '' || approved,
            onClick: () => act('approve', `/items/${itemId}/approve`, { note }),
          }, '通过'),
          h('select', { style: S.input, value: reason, onChange: (e) => setReason(e.target.value) },
            REVIEW_REASONS.map((r) => h('option', { key: r, value: r }, r))),
          h('input', { style: { ...S.input, flex: '1 1 160px' }, placeholder: '驳回备注', value: note, onChange: (e) => setNote(e.target.value) }),
          h('button', { style: S.btn, disabled: busy !== '', onClick: () => act('reject', `/items/${itemId}/reject`, { reason, note }) }, '驳回'),
          approved
            ? h('button', { style: S.btn, disabled: busy !== '', onClick: () => act('unapprove', `/items/${itemId}/unapprove`) }, '撤回通过')
            : null,
        ),

        h('div', { style: S.row },
          h('span', { style: S.muted }, '局部重做：'),
          ['script', 'voice', 'render', 'cover'].map((step) =>
            h('button', {
              key: step,
              style: S.btn,
              disabled: busy !== '' || approved,
              onClick: () => act(`rerun-${step}`, `/items/${itemId}/rerun`, { from: step }),
            }, `${STEP_ZH[step] || step}起`)),
          rejected ? h('button', { style: S.btn, onClick: () => act('retry', `/items/${itemId}/retry`) }, '重新入队') : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 模型配置                                                          */
    /* ------------------------------------------------------------------ */
    const PRESETS = {
      llm: {
        id: 'gpt-text', kind: 'llm', enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '',
      },
      tts: {
        id: 'bailian-tts', kind: 'tts', enabled: false,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-tts', voice: 'Cherry', apiKey: '',
      },
      image: {
        id: 'gpt-image', kind: 'image', enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: '',
      },
      comfyui: {
        id: 'local-comfyui', kind: 'comfyui', enabled: false, baseUrl: 'http://127.0.0.1:8188',
        defaults: { width: 768, height: 1344, durationSec: 5, fps: 24 },
        limits: { concurrency: 1 }, workflowRef: 'D:\\素材\\ltx-t2v.json',
      },
      httpGeneric: {
        id: 'local-http', kind: 'http-generic', enabled: false, baseUrl: 'http://127.0.0.1:9000',
        defaults: { width: 768, height: 1344, durationSec: 5, fps: 24 }, limits: { concurrency: 1 },
        protocol: {
          health: { method: 'GET', path: '/health' },
          submit: { method: 'POST', path: '/generate', body: { prompt: '${prompt}', num_frames: '${frames}', seed: '${seed}' } },
          poll: { method: 'GET', path: '/tasks/${taskId}' },
          extract: { taskId: '$.task_id', state: '$.data.status', videoUrl: '$.data.video_url', error: '$.data.message' },
          stateMap: { queued: ['pending', 'queued'], running: ['running'], succeeded: ['success', 'done'], failed: ['error', 'failed'] },
        },
      },
      ark: { id: 'seedance', kind: 'ark-seedance', enabled: false, modelId: '', apiKey: '' },
    }

    function ProvidersPage() {
      const [providers, setProviders] = useState([])
      const [health, setHealth] = useState(null)
      const [draft, setDraft] = useState(null)
      const [text, setText] = useState('')
      const [result, setResult] = useState(null)
      const [busy, setBusy] = useState('')

      const load = useCallback(async () => {
        const [list, info] = await Promise.all([api('GET', '/providers'), api('GET', '/health')])
        setProviders(list.providers || [])
        setHealth(info)
      }, [])

      useEffect(() => { load().catch((e) => setResult({ ok: false, title: '读取失败', detail: e.message })) }, [load])

      const startEdit = (provider) => {
        setDraft(provider)
        setText(JSON.stringify(provider, null, 2))
        setResult(null)
      }
      const addPreset = (key) => {
        setDraft(PRESETS[key])
        setText(JSON.stringify(PRESETS[key], null, 2))
        setResult(null)
      }
      const save = async () => {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch (e) {
          setResult({ ok: false, title: 'JSON 解析失败', detail: e.message })
          return
        }
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(parsed.id || '')) {
          setResult({ ok: false, title: 'id 不合法', detail: '字母、数字、点、下划线、短横线，≤64' })
          return
        }
        setBusy('save')
        try {
          await api('PUT', `/providers/${encodeURIComponent(parsed.id)}`, parsed)
          setDraft(null)
          await load()
          setResult({ ok: true, title: '已保存', detail: parsed.id })
        } catch (e) {
          setResult({ ok: false, title: '保存失败', detail: e.message })
        } finally {
          setBusy('')
        }
      }
      const check = async (id) => {
        setBusy(`health:${id}`)
        try {
          const data = await api('POST', `/providers/${encodeURIComponent(id)}/health`)
          setResult({ ok: data.health?.ok !== false, title: `${id} 健康检查`, detail: data.health?.detail || (data.health?.ok ? '正常' : '不可用') })
        } catch (e) {
          setResult({ ok: false, title: `${id} 检查失败`, detail: e.message })
        } finally {
          setBusy('')
        }
      }
      const test = async (id) => {
        setBusy(`test:${id}`)
        setResult({ ok: true, title: `${id} 测试中…`, detail: '' })
        try {
          const data = await api('POST', `/providers/${encodeURIComponent(id)}/test`, {})
          setResult({ ok: data.job.status === 'succeeded', title: `${id} 测试结果`, detail: data.job.detail || data.job.error || data.job.status })
        } catch (e) {
          setResult({ ok: false, title: `${id} 测试失败`, detail: e.message })
        } finally {
          setBusy('')
        }
      }
      const remove = async (id) => {
        await api('DELETE', `/providers/${encodeURIComponent(id)}`).catch(() => {})
        await load()
      }

      return h('div', { style: S.col },
        health && !health.ffmpeg.ok ? h('div', { style: { ...S.card, color: '#f85149' } }, health.ffmpeg.error) : null,
        health ? h('div', { style: S.muted },
          `ffmpeg ${health.ffmpeg.ok ? '已就绪' : '不可用'} · 队列 ${health.queue ? `${health.queue.active.length} 运行 / ${health.queue.queued} 排队` : '未启动'}`,
        ) : null,
        h('div', { style: S.row },
          h('button', { style: S.btnOn, onClick: () => addPreset('llm') }, '＋ 文案模型'),
          h('button', { style: S.btnOn, onClick: () => addPreset('tts') }, '＋ 配音模型'),
          h('button', { style: S.btnOn, onClick: () => addPreset('image') }, '＋ 生图模型'),
          h('button', { style: S.btnOn, onClick: () => addPreset('comfyui') }, '＋ 本地 ComfyUI'),
          h('button', { style: S.btnOn, onClick: () => addPreset('httpGeneric') }, '＋ 本地 HTTP'),
          h('button', { style: S.btn, onClick: () => addPreset('ark') }, '＋ 方舟 Seedance（预留）'),
        ),
        providers.length === 0
          ? h('div', { style: { ...S.card, ...S.muted } }, '还没有配置任何模型。至少要配一个文案模型、一个配音模型、一个视频模型才能产出。')
          : null,
        providers.map((provider) =>
          h('div', { key: provider.id, style: S.card },
            h('div', { style: S.spread },
              h('div', { style: S.row },
                h('span', { style: S.dot(provider.enabled !== false) }),
                h('strong', { style: { fontSize: 13 } }, provider.id),
                h('span', { style: S.badge('') }, provider.kind),
                provider.kind === 'ark-seedance' && !provider.modelId ? h('span', { style: S.muted }, '未配置模型 ID') : null,
              ),
              h('div', { style: S.row },
                h('button', { style: S.btn, disabled: busy === `health:${provider.id}`, onClick: () => check(provider.id) }, '健康检查'),
                h('button', { style: S.btn, disabled: busy === `test:${provider.id}`, onClick: () => test(provider.id) },
                  busy === `test:${provider.id}` ? '测试中…' : '测试'),
                h('button', { style: S.btn, onClick: () => startEdit(provider) }, '编辑'),
                h('button', { style: S.btn, onClick: () => remove(provider.id) }, '删除'),
              ),
            ),
            provider.baseUrl ? h('div', { style: S.mono }, provider.baseUrl) : null,
          ),
        ),
        draft
          ? h('div', { style: S.card },
              h('div', { style: S.muted }, '整段 JSON 就是配置，保存后立即生效。apiKey 显示 __stored__ 表示已保存；填新值即替换，留空即清除。'),
              h('textarea', { style: S.area, value: text, spellCheck: false, onChange: (e) => setText(e.target.value) }),
              h('div', { style: S.row },
                h('button', { style: S.btnOn, onClick: save, disabled: busy === 'save' }, '保存'),
                h('button', { style: S.btn, onClick: () => setDraft(null) }, '取消'),
              ),
            )
          : null,
        result
          ? h('div', { style: S.card },
              h('strong', { style: { fontSize: 13 } }, (result.ok ? '✓ ' : '✕ ') + result.title),
              result.detail ? h('div', { style: S.mono }, String(result.detail).slice(0, 500)) : null,
            )
          : null,
      )
    }

    function ReadyPage({ refreshKey, platforms = [], onError }) {
      const [batches, setBatches] = useState([])
      const [busy, setBusy] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await api('GET', '/batches')
          setBatches(data.batches || [])
        } catch (error) {
          onError?.(error.message)
        }
      }, [onError])

      useEffect(() => { load() }, [load, refreshKey])

      const rows = []
      for (const batch of batches) {
        for (const item of batch.items || []) {
          if (item.status === 'approved') rows.push({ batch, item })
        }
      }

      const download = async (item) => {
        setBusy(item.id)
        try {
          await downloadZip(`/items/${item.id}/export`, `content-studio-item-${String(item.seq).padStart(3, '0')}.zip`)
        } catch (error) {
          onError?.(error.message)
        } finally {
          setBusy('')
        }
      }

      return h('div', { style: S.col },
        h('div', { style: S.spread },
          h('div', { style: S.row },
            h('strong', { style: { fontSize: 13 } }, '待发布'),
            h('span', { style: S.muted }, `${rows.length} 条已通过，等待导出发布包`),
          ),
          h('button', { style: S.btn, onClick: load }, '刷新'),
        ),
        rows.length === 0
          ? h('div', { style: { ...S.card, ...S.muted } }, '还没有待发布的条目。审核通过的条目会出现在这里。')
          : h('div', { style: S.col },
              rows.map(({ batch, item }) => h('div', { key: item.id, style: S.card },
                h('div', { style: S.spread },
                  h('div', { style: S.row },
                    h('strong', { style: { fontSize: 12 } }, item.title || item.id),
                    h(Badge, { tone: 'ok' }, '已通过'),
                    h('span', { style: S.muted }, platformLabel(platforms, batch.config?.platform)),
                    h('span', { style: S.muted }, item.durationSec ? `${item.durationSec.toFixed(1)}s` : ''),
                    h('span', { style: S.muted }, batch.title),
                  ),
                  h('button', { style: S.btnOn, disabled: busy === item.id, onClick: () => download(item) },
                    busy === item.id ? '导出中…' : '导出发布包'),
                ),
              )),
            ),
      )
    }

    function SettingsPage({ platforms = [] }) {
      return h('div', { style: S.col },
        h(ProvidersPage),
        h('div', { style: S.card },
          h('strong', { style: { fontSize: 13 } }, '平台预设'),
          h('div', { style: S.muted }, 'v1 复用同一组已验证规格；平台差异先只影响标题字数提示，后续可按平台调参。'),
          platforms.map((platform) => h('div', { key: platform.id, style: { ...S.row, borderTop: LINE, paddingTop: 6 } },
            h('span', { style: { fontSize: 12, fontWeight: 600 } }, platform.label),
            h('span', { style: S.muted }, `${platform.aspectRatio} · 目标 ${platform.targetSec}s · 标题 ≤${platform.titleMaxLength} 字 · 封面 ${platform.coverWidth}×${platform.coverHeight}`),
          )),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 工作台                                                            */
    /* ------------------------------------------------------------------ */
    function Workbench({ services }) {
      const [tab, setTab] = useState('console')
      const [batches, setBatches] = useState([])
      const [selected, setSelected] = useState(null)
      const [reviewQueue, setReviewQueue] = useState([])
      const [reviewIndex, setReviewIndex] = useState(0)
      const [groups, setGroups] = useState([])
      const [platforms, setPlatforms] = useState([])
      const [health, setHealth] = useState(null)
      const [error, setError] = useState('')
      const [tick, setTick] = useState(0)

      const load = useCallback(async () => {
        try {
          const [list, groupInfo, healthInfo, metaInfo] = await Promise.all([
            api('GET', '/batches'), api('GET', '/materials/groups'), api('GET', '/health'), api('GET', '/meta'),
          ])
          setBatches(list.batches || [])
          setGroups(groupInfo.groups || [])
          setHealth(healthInfo)
          setPlatforms(metaInfo.platforms || [])
          setError('')
        } catch (e) {
          setError(e.message)
        }
      }, [])

      useEffect(() => { load() }, [load, tick])

      useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), 5000)
        return () => clearInterval(timer)
      }, [])

      const itemStatuses = batches.flatMap((batch) => (batch.items || []).map((item) => item.status))
      const summary = [
        ['运行中', itemStatuses.filter((status) => status === 'running').length],
        ['待审核', itemStatuses.filter((status) => status === 'review_pending').length],
        ['失败', itemStatuses.filter((status) => status === 'failed').length],
        ['待发布', itemStatuses.filter((status) => status === 'approved').length],
      ]

      return h('div', { style: S.page },
        h('div', null,
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, '内容生产 · 总控台'),
          h('div', { style: S.muted }, '批量生产：文案 → 配音 → 字幕 → 画面 → 渲染 → 封面 → 校验 → 审核/导出'),
        ),
        error ? h('div', { style: { ...S.card, color: '#f85149' } }, `接口不可用：${error}`) : null,
        h(Readiness, { health, onConfigure: () => setTab('settings') }),
        h('div', { style: { display: 'flex', gap: 4, borderBottom: LINE } },
          [['console', '总控台'], ['review', '审核'], ['ready', '待发布'], ['settings', '设置']].map(([key, label]) =>
            h('button', { key, style: S.tab(tab === key), onClick: () => setTab(key) }, label)),
        ),

        tab === 'console'
          ? h('div', { style: S.col },
              h('div', { style: { ...S.card, display: 'flex', gap: 18, flexWrap: 'wrap' } },
                summary.map(([label, value]) => h('div', { key: label, style: { fontSize: 12 } },
                  h('span', { style: S.muted }, `${label} `), h('strong', null, String(value))),
                ),
              ),
              h(NewBatchForm, {
                groups,
                health,
                services,
                platforms,
                onCreated: (batch) => { setSelected(batch.id); load() },
              }),
              h('div', { style: S.card },
                h('div', { style: S.spread },
                  h('span', { style: { fontSize: 13, fontWeight: 600 } }, '批次列表'),
                  h('button', { style: S.btn, onClick: load }, '刷新'),
                ),
                batches.length === 0
                  ? h('div', { style: S.muted }, '还没有批次')
                  : h('div', { style: S.col },
                      batches.map((batch) => {
                        const failed = (batch.items || []).filter((item) => item.status === 'failed').length
                        return h('div', {
                          key: batch.id,
                          style: { ...S.row, justifyContent: 'space-between', cursor: 'pointer', padding: '6px 0', borderTop: LINE },
                          onClick: () => setSelected(batch.id),
                        },
                          h('div', { style: S.row },
                            h('span', { style: S.dot(batch.status !== 'cancelled') }),
                            h('strong', { style: { fontSize: 12 } }, batch.title),
                            h(Badge, { tone: BATCH_STATUS_TONE[batch.status] || '' }, BATCH_STATUS_ZH[batch.status] || batch.status),
                            h('span', { style: S.muted }, platformLabel(platforms, batch.config?.platform)),
                            failed > 0 ? h('span', { style: { ...S.muted, color: '#f85149' } }, `失败 ${failed}`) : null,
                          ),
                          h('span', { style: S.muted }, `${batch.items.length} 条 · ${new Date(batch.createdAt).toLocaleString('zh-CN')}`),
                        )
                      }),
                    ),
              ),
              selected ? h(BatchDetail, {
                batchId: selected,
                refreshKey: tick,
                platforms,
                onOpenReview: (itemId, queue) => {
                  const ids = Array.isArray(queue) && queue.length > 0 ? queue : [itemId]
                  setReviewQueue(ids)
                  setReviewIndex(Math.max(0, ids.indexOf(itemId)))
                  setTab('review')
                },
                onDeleted: () => { setSelected(null); setTick((n) => n + 1) },
              }) : null,
            )
          : null,

        tab === 'review'
          ? h('div', { style: S.col },
              reviewQueue.length > 0
                ? h(ReviewCard, {
                    key: reviewQueue[reviewIndex],
                    itemId: reviewQueue[reviewIndex],
                    index: reviewIndex,
                    total: reviewQueue.length,
                    onPrev: reviewIndex > 0 ? () => setReviewIndex((i) => Math.max(0, i - 1)) : undefined,
                    onNext: reviewIndex < reviewQueue.length - 1 ? () => setReviewIndex((i) => i + 1) : undefined,
                    onDone: () => {
                      setTick((n) => n + 1)
                      if (reviewIndex < reviewQueue.length - 1) setReviewIndex((i) => i + 1)
                    },
                  })
                : h('div', { style: { ...S.card, ...S.muted } }, '在总控台的批次详情里点「去审核」选择一条内容。'),
              h('div', { style: S.row },
                reviewQueue.length > 0
                  ? h('button', { style: S.btn, onClick: () => { setReviewQueue([]); setReviewIndex(0) } }, '关闭审核')
                  : null,
                h('span', { style: S.muted }, '快捷键：A 通过 · R 驳回 · ← → 翻页'),
              ),
            )
          : null,

        tab === 'ready' ? h(ReadyPage, { refreshKey: tick, platforms, onError: setError }) : null,

        tab === 'settings' ? h(SettingsPage, { platforms }) : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* registration                                                        */
    /* ------------------------------------------------------------------ */
    function SidebarIcon({ size = 18, active = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { opacity: active ? 1 : 0.78 },
      },
        h('rect', { x: 3, y: 7, width: 18, height: 13, rx: 2 }),
        h('path', { d: 'M3 11h18' }),
        h('path', { d: 'M7 7l2-3M12 7l2-3M17 7l2-3' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 目录选择器来自宿主；拿不到时表单退化成手填路径
        const services = {
          pickDirectory: async () => {
            // 可选服务：没挂目录选择器时表单退化成手填路径
            const picker = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace
            if (!picker || typeof picker.pickDirectory !== 'function') return null
            return picker.pickDirectory()
          },
        }
        const Bound = (props) => h(Workbench, { ...props, services })
        Bound.displayName = 'ContentStudioWorkbench'

        // 主区域面板 + 左侧栏图标，和「插件」「自动化任务」同一套 slot；
        // 不再注册 settings.section，避免两个入口。
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'content-studio',
            },
            Bound,
          ),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'content-studio',
              order: 25,
              label: () => '内容生产',
            },
            SidebarIcon,
          ),
        )
      },
      // 测试缝隙：渲染测试需要单独挂载这些子组件。Cordis 忽略未知字段。
      __components: {
        Workbench, ProvidersPage, NewBatchForm, BatchDetail, ReviewCard,
        Readiness, UsageLine, StepStrip, CostBar, LogViewer, ReadyPage, SettingsPage, SidebarIcon,
      },
    }
  },
})
