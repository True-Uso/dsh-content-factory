/**
 * 平台预设与批次配置归一化。
 *   node tools/test-platforms.mjs
 */
const { DEFAULT_PLATFORM, PLATFORMS, getPlatform, listPlatforms, normalizeBatchConfig } = await import('../lib/platforms.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

check('三个平台预设', listPlatforms().length === 3, String(listPlatforms().length))
check('默认平台是抖音', DEFAULT_PLATFORM === 'douyin')
check('未知平台回退到默认', getPlatform('unknown').id === 'douyin')

const base = normalizeBatchConfig({})
check('默认平台写入配置', base.platform === 'douyin')
check('默认画幅 9:16', base.aspectRatio === '9:16')
check('默认目标时长 26s', base.targetSec === 26)
check('默认审核模式 required', base.reviewMode === 'required')
check('默认发布间隔 1440 分钟', base.publishIntervalMinutes === 1440)
check('默认不设成本上限', base.costCap === null)
check('默认标题字数提示来自平台', base.validationRules.maxTitleLength === 30, String(base.validationRules.maxTitleLength))

const red = normalizeBatchConfig({ platform: 'xiaohongshu' })
check('小红书标题上限 20', red.platform === 'xiaohongshu' && red.validationRules.maxTitleLength === 20)

const auto = normalizeBatchConfig({ reviewMode: 'auto', costCap: 12.5, publishStartAt: '2026-11-05T18:00:00+08:00' })
check('自动放行保留', auto.reviewMode === 'auto')
check('成本上限保留', auto.costCap === 12.5)
check('发布时间规范化为 ISO', auto.publishStartAt === '2026-11-05T10:00:00.000Z', auto.publishStartAt)

const invalid = normalizeBatchConfig({ costCap: -1, publishIntervalMinutes: -5, publishStartAt: 'not-a-date', platform: 'nope' })
check('负成本上限归零', invalid.costCap === null)
check('负间隔回退默认', invalid.publishIntervalMinutes === 1440)
check('非法日期归零', invalid.publishStartAt === null)
check('未知平台仍归一化', invalid.platform === 'douyin')

const overridden = normalizeBatchConfig({
  platform: 'xiaohongshu', aspectRatio: '16:9', targetSec: 40,
  validationRules: { maxTitleLength: 50 },
})
check('显式画幅不被覆盖', overridden.aspectRatio === '16:9')
check('显式时长不被覆盖', overridden.targetSec === 40)
check('显式校验规则优先', overridden.validationRules.maxTitleLength === 50)

const platformRows = PLATFORMS.every((platform) => platform.coverWidth === 1080 && platform.coverHeight === 1920)
check('v1 封面尺寸复用已验证值', platformRows)

console.log(`\nALL PLATFORM CHECKS PASSED (${passed})`)
