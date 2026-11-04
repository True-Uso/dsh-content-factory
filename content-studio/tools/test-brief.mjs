/**
 * 一句话需求 → 批次计划的本地解析与 LLM 合并。
 *   node tools/test-brief.mjs
 */
const { parseBrief } = await import('../lib/brief.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

const first = await parseBrief({ brief: '做 3 条秋日通勤穿搭，发小红书，每天 18:00 一条，预算 20 元' })
check('本地解析来源', first.source === 'local')
check('解析条数', first.count === 3, String(first.count))
check('解析平台', first.config.platform === 'xiaohongshu', first.config.platform)
check('默认需人工审核', first.config.reviewMode === 'required')
check('解析预算', first.config.costCap === 20, String(first.config.costCap))
check('解析发布时间', Boolean(first.config.publishStartAt), first.config.publishStartAt)
check('发布时间落在 18 点', new Date(first.config.publishStartAt).getHours() === 18, first.config.publishStartAt)
check('主题去掉指令词', first.config.topic.includes('秋日通勤穿搭') && !/小红书|预算|3 条/.test(first.config.topic), first.config.topic)
check('计划摘要非空', first.plan.summary.includes('3 条') && first.plan.summary.includes('小红书'), first.plan.summary)

const auto = await parseBrief({ brief: '自动放行 5 条抖音视频，主题是家居收纳' })
check('自动放行识别', auto.config.reviewMode === 'auto', auto.config.reviewMode)
check('条数识别', auto.count === 5, String(auto.count))
check('主题清理', auto.config.topic.includes('家居收纳') && !auto.config.topic.includes('抖音'), auto.config.topic)

const short = await parseBrief({ brief: '做2条视频号，30秒' })
check('视频号识别', short.config.platform === 'shipinhao', short.config.platform)
check('时长识别', short.config.targetSec === 30, String(short.config.targetSec))

const fallback = await parseBrief({ brief: '随便做点内容' })
check('未指定条数默认 5', fallback.count === 5, String(fallback.count))
check('默认平台抖音', fallback.config.platform === 'douyin')
check('默认审核 required', fallback.config.reviewMode === 'required')
check('假设列表说明默认值', fallback.plan.assumptions.some((line) => line.includes('条数')), JSON.stringify(fallback.plan.assumptions))

const overridden = await parseBrief({ brief: '做 3 条抖音', overrides: { count: 7, platform: 'xiaohongshu' } })
check('显式覆盖条数', overridden.count === 7, String(overridden.count))
check('显式覆盖平台', overridden.config.platform === 'xiaohongshu', overridden.config.platform)

const llm = {
  async complete() {
    return {
      json: {
        topic: 'AI 主题', count: 9, platform: 'shipinhao', targetSec: 18,
        reviewMode: 'auto', publishStartAt: '2026-11-10T10:00:00.000Z',
        publishIntervalMinutes: 60, costCap: 5,
        summary: 'AI 计划摘要', assumptions: ['AI 补充'],
      },
    }
  },
}
const merged = await parseBrief({ brief: '做 5 条内容', llm })
check('LLM 来源标记', merged.source === 'llm')
check('LLM 主题', merged.config.topic === 'AI 主题')
check('LLM 条数', merged.count === 9, String(merged.count))
check('LLM 平台', merged.config.platform === 'shipinhao')
check('LLM 时长', merged.config.targetSec === 18, String(merged.config.targetSec))
check('LLM 审核模式', merged.config.reviewMode === 'auto')
check('LLM 预算', merged.config.costCap === 5)
check('LLM 摘要', merged.plan.summary === 'AI 计划摘要')
check('LLM 假设', merged.plan.assumptions[0] === 'AI 补充')

const broken = await parseBrief({
  brief: '做 2 条抖音',
  llm: { async complete() { throw new Error('network down') } },
})
check('LLM 失败回退本地', broken.source === 'local')
check('LLM 失败留警告', broken.plan.warnings.some((line) => line.includes('AI 解析失败')), JSON.stringify(broken.plan.warnings))

console.log(`\nALL BRIEF CHECKS PASSED (${passed})`)
