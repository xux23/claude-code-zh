#!/usr/bin/env node
/**
 * Claude Code 扩展汉化工具
 *
 *   node localize.js              汉化（扩展更新后重跑这一条即可）
 *   node localize.js --restore    还原为英文原版
 *   node localize.js --check      只检查不修改
 *   node localize.js --strict     跳过「强制替换」清单，只用安全规则
 *   node localize.js --dir <路径> 指定扩展目录
 *
 * 首次运行会自动备份原文件为 *.orig；之后始终基于 .orig 重新生成，重复运行结果一致。
 */
const fs = require('fs')
const path = require('path')

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const opt = {
  restore: argv.includes('--restore'),
  check: argv.includes('--check'),
  strict: argv.includes('--strict'),
  dir: null,
}
const dirIdx = argv.indexOf('--dir')
if (dirIdx >= 0) opt.dir = argv[dirIdx + 1]
if (!opt.dir) opt.dir = process.env.CLAUDE_EXT_DIR || 'D:/AAAGreen/VSCodium-win32-x64-1.143.17183/data/extensions/anthropic.claude-code-2.1.311'

const dictPath = path.join(__dirname, '词典.json')
if (!fs.existsSync(dictPath)) {
  console.error('✗ 找不到 词典.json（应与本脚本同目录）')
  process.exit(1)
}
if (!fs.existsSync(opt.dir)) {
  console.error('✗ 扩展目录不存在:', opt.dir)
  console.error('  用 --dir 指定，或设环境变量 CLAUDE_EXT_DIR')
  process.exit(1)
}

const config = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
const TARGETS = {
  webview: path.join(opt.dir, 'webview', 'index.js'),
  pkg: path.join(opt.dir, 'package.json'),
}

// ---------- 通用工具 ----------
const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
}

function backupPath(p) { return p + '.orig' }

/** 读取原始英文版：优先用 .orig 备份，保证重复运行结果一致（幂等） */
function readSource(p) {
  const b = backupPath(p)
  if (fs.existsSync(b)) return { text: fs.readFileSync(b, 'utf8'), fromBackup: true }
  return { text: fs.readFileSync(p, 'utf8'), fromBackup: false }
}

// ---------- webview 处理 ----------
const DISPLAY_KEYS = [
  'children', 'label', 'title', 'placeholder', 'description', 'aria-label',
  'ariaLabel', 'alt', 'tooltip', 'message', 'header', 'subtitle', 'hint',
  'buttonText', 'confirmLabel', 'cancelLabel', 'emptyText', 'name',
]

function isDisplayAt(src, quotePos) {
  let i = quotePos - 1
  if (src[i] !== ':') return false
  i--
  let quoteClose = false
  if (src[i] === '"' || src[i] === "'") { quoteClose = true; i-- }
  for (const k of DISPLAY_KEYS) {
    if (i - k.length + 1 < 0) continue
    if (src.slice(i - k.length + 1, i + 1) !== k) continue
    const before = src[i - k.length]
    const boundaryOk = before === undefined || !/[A-Za-z0-9_$]/.test(before)
    if (!boundaryOk) continue
    if (quoteClose) {
      if (before === '"' || before === "'") return true
      continue
    }
    return true
  }
  return false
}

function isMapValueAt(src, quotePos) {
  let i = quotePos - 1
  if (src[i] !== ':') return false
  i--
  let j = i
  while (j >= 0 && /[A-Za-z0-9_$]/.test(src[j])) j--
  if (j === i) return false
  const key = src.slice(j + 1, i + 1)
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return false
  return /^(label|title|description|text|placeholder|tooltip|name|message|header|subtitle|hint|summary)$/.test(key)
}

const looksLikeSentence = v => /[一-龥]/.test(v) || (/\s/.test(v) && v.length >= 4)

function isTernaryBranch(src, quoteEnd, value) {
  const next = src[quoteEnd]
  const prev = src[src.lastIndexOf('"', quoteEnd - 1) - 1]
  if (next === ':' || prev === '?' || prev === ':') return looksLikeSentence(value)
  return false
}

function findAll(src, needle) {
  const out = []
  let i = -1
  while ((i = src.indexOf(needle, i + 1)) !== -1) out.push(i)
  return out
}

function buildWebviewEdits(source) {
  const { 词典, 强制替换, 手工补丁 } = config.webview
  const forceSet = new Set(强制替换)
  const edits = []
  const skipped = []
  let replacedEntries = 0

  for (const [en, zh] of Object.entries(词典)) {
    const dqBody = JSON.stringify(en).slice(1, -1)
    const sqBody = en.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
    const occ = [
      ...findAll(source, '"' + dqBody + '"').map(p => ({ quotePos: p, start: p, end: p + dqBody.length + 2, quote: '"' })),
      ...findAll(source, "'" + sqBody + "'").map(p => ({ quotePos: p, start: p, end: p + sqBody.length + 2, quote: "'" })),
    ]
    const seen = new Set()
    const uniq = occ.filter(o => {
      const key = o.start + o.quote
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (!uniq.length) continue

    const displays = uniq.filter(o =>
      isDisplayAt(source, o.quotePos) ||
      isMapValueAt(source, o.quotePos) ||
      isTernaryBranch(source, o.end - 1, en)
    )
    const allSafe = displays.length === uniq.length
    const singleSentence = displays.length === 0 && uniq.length === 1 && looksLikeSentence(en)
    // 「强制替换」清单里的词条已人工核对过全部出现位置，默认应用；--strict 可关闭
    const forced = forceSet.has(en) && !opt.strict

    if (!allSafe && !singleSentence && !forced) {
      skipped.push({ en, total: uniq.length, display: displays.length, reason: '涉及逻辑比较' })
      continue
    }

    replacedEntries++
    for (const o of uniq) {
      const body = o.quote === '"'
        ? JSON.stringify(zh).slice(1, -1)
        : zh.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
      edits.push({ start: o.start, end: o.end, text: o.quote + body + o.quote, orig: source.slice(o.start, o.end) })
    }
  }

  const patchWarn = []
  for (const p of 手工补丁) {
    const idx = source.indexOf(p.from)
    const cnt = source.split(p.from).length - 1
    if (idx === -1 || cnt !== p.expectCount) {
      patchWarn.push({ note: p.note, want: p.expectCount, got: cnt })
      continue
    }
    edits.push({ start: idx, end: idx + p.from.length, text: p.to, orig: p.from, patch: true })
  }

  return { edits, skipped, replacedEntries, patchWarn }
}

function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return { error: `替换区间重叠：\n   A: ${JSON.stringify(sorted[i - 1].orig.slice(0, 100))}\n   B: ${JSON.stringify(sorted[i].orig.slice(0, 100))}` }
    }
  }
  let out = source
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return { out }
}

/** 语法校验：用 Function 构造而不执行 */
function syntaxOk(code) {
  try { new Function(code); return null } catch (e) { return e.message }
}

/** 逐条核对：每条替换在原文中的位置确实对应 orig，且新文本不破坏字面量 */
function verifyEdits(source, edits) {
  const problems = []
  for (const e of edits) {
    if (source.slice(e.start, e.end) !== e.orig) {
      problems.push('偏移不匹配: ' + JSON.stringify(e.orig.slice(0, 60)))
      continue
    }
    if (e.patch) continue
    const q = e.text[0]
    const body = e.text.slice(1, -1)
    let i = 0
    let bad = false
    while (i < body.length) {
      if (body[i] === '\\') { i += 2; continue }
      if (body[i] === q) { bad = true; break }
      i++
    }
    if (bad || e.text[e.text.length - 1] !== q) problems.push('字面量破损: ' + JSON.stringify(e.text.slice(0, 60)))
  }
  return problems
}

// ---------- package.json 处理 ----------
function localizePackage(pkgText) {
  const pkg = JSON.parse(pkgText)
  const { 说明, 枚举 } = config.settings
  const hit = { desc: 0, enum: 0 }
  const miss = new Set()
  const tr = s => (typeof s === 'string' && Object.prototype.hasOwnProperty.call(说明, s) ? 说明[s] : s)
  const trEnum = s => (typeof s === 'string' && Object.prototype.hasOwnProperty.call(枚举, s) ? 枚举[s] : s)

  function walk(obj) {
    for (const v of Object.values(obj)) {
      if (!v || typeof v !== 'object') continue
      for (const field of ['description', 'markdownDescription']) {
        if (typeof v[field] !== 'string') continue
        const before = v[field]
        const after = tr(before)
        v[field] = after
        if (after !== before) hit.desc++
        else if (/^[A-Za-z]/.test(before) && before.length > 12) miss.add(before.split('\n')[0])
      }
      for (const field of ['enumItemLabels', 'enumDescriptions']) {
        if (!Array.isArray(v[field])) continue
        v[field] = v[field].map(x => { const y = trEnum(x); if (y !== x) hit.enum++; return y })
      }
      if (v.properties) walk(v.properties)
      if (v.items) walk({ items: v.items })
    }
  }
  if (pkg.contributes?.configuration?.properties) walk(pkg.contributes.configuration.properties)
  return { pkg, hit, miss }
}

// ---------- 主流程 ----------
function main() {
  console.log(c.bold('\nClaude Code 扩展汉化'))
  console.log(c.dim('扩展目录: ' + opt.dir + '\n'))

  const modeLabel = opt.restore ? '还原' : opt.check ? '检查' : '汉化'
  console.log('模式: ' + modeLabel + (opt.strict ? c.yellow('（严格：跳过强制替换清单）') : '') + '\n')

  // ===== webview/index.js =====
  const wv = TARGETS.webview
  if (!fs.existsSync(wv)) {
    console.error(c.red('✗ 找不到 ' + wv))
  } else {
    const { text: source, fromBackup } = readSource(wv)

    if (opt.restore) {
      if (!fromBackup) {
        console.log(c.yellow('⚠ 没有备份文件，无法还原: ' + backupPath(wv)))
      } else {
        fs.writeFileSync(wv, source, 'utf8')
        console.log(c.green('✓ 界面文件已还原为原版'))
      }
    } else {
      const { edits, skipped, replacedEntries, patchWarn } = buildWebviewEdits(source)
      const result = applyEdits(source, edits)

      if (result.error) {
        console.error(c.red('✗ ' + result.error))
        process.exitCode = 1
      } else {
        const problems = verifyEdits(source, edits)
        const syntaxErr = syntaxOk(result.out)
        const cjk = (result.out.match(/[一-龥]/g) || []).length

        console.log(c.bold('界面文案'))
        console.log(`  词条      ${replacedEntries} 条`)
        console.log(`  替换      ${edits.length} 处`)
        console.log(`  中文字符  ${cjk}`)
        if (skipped.length) {
          console.log(c.dim(`  跳过      ${skipped.length} 条（参与逻辑比较或未命中，属正常）`))
        }
        if (patchWarn.length) {
          console.log(c.yellow(`\n  ⚠ ${patchWarn.length} 条手工补丁未命中（扩展可能已改动，需检查 manual-patches）：`))
          for (const p of patchWarn) console.log(c.dim(`    ${p.note}（期望 ${p.want} 次，实际 ${p.got} 次）`))
        }
        if (problems.length) {
          console.log(c.red(`\n  ✗ 校验失败 ${problems.length} 处：`))
          for (const p of problems.slice(0, 5)) console.log('    ' + p)
          process.exitCode = 1
        } else {
          console.log(c.green('  ✓ 替换校验通过'))
        }
        if (syntaxErr) {
          console.log(c.red(`  ✗ 语法错误: ${syntaxErr}`))
          process.exitCode = 1
        } else {
          console.log(c.green('  ✓ 语法检查通过'))
        }

        if (!opt.check && !problems.length && !syntaxErr) {
          if (!fromBackup) fs.writeFileSync(backupPath(wv), source, 'utf8')
          fs.writeFileSync(wv, result.out, 'utf8')
          console.log(c.green('  ✓ 已写入' + (fromBackup ? '' : '（已备份原文件）')))
        }
        if (fromBackup) console.log(c.dim('  （基于 .orig 备份重新生成，结果幂等）'))
      }
    }
  }

  // ===== package.json =====
  const pk = TARGETS.pkg
  if (!fs.existsSync(pk)) {
    console.error(c.red('\n✗ 找不到 ' + pk))
  } else if (opt.restore) {
    const b = backupPath(pk)
    if (fs.existsSync(b)) {
      fs.writeFileSync(pk, fs.readFileSync(b, 'utf8'))
      console.log(c.green('✓ 设置说明已还原为原版'))
    }
  } else {
    const { text: source, fromBackup } = readSource(pk)
    let pkgObj
    try { pkgObj = JSON.parse(source) } catch (e) {
      console.error(c.red('\n✗ package.json 解析失败: ' + e.message))
      process.exitCode = 1
    }
    if (pkgObj) {
      const { pkg, hit, miss } = localizePackage(source)
      console.log(c.bold('\n设置说明'))
      if (fromBackup) {
        console.log(`  说明 ${hit.desc} 条，枚举标签 ${hit.enum} 个`)
        if (miss.size) {
          console.log(c.yellow(`  ⚠ ${miss.size} 条未翻译（词典中没有，请补充到 词典.json）：`))
          for (const m of miss) console.log(c.dim('    ' + m.slice(0, 80)))
        }
      } else {
        console.log(c.dim('  基于已汉化文件统计：全部已翻译'))
      }
      // 键名必须与原版完全一致（扩展按这些键读取设置）
      const keysBefore = Object.keys(pkgObj.contributes?.configuration?.properties || {})
      const keysAfter = Object.keys(pkg.contributes?.configuration?.properties || {})
      if (JSON.stringify(keysBefore) !== JSON.stringify(keysAfter)) {
        console.log(c.red('  ✗ 设置键名发生变化，已中止写入'))
        process.exitCode = 1
      } else {
        console.log(c.green('  ✓ 设置键名未变（扩展读取不受影响）'))
        if (opt.check) {
          console.log(c.dim('  检查模式，未写入'))
        } else {
          if (!fromBackup) fs.writeFileSync(backupPath(pk), source, 'utf8')
          fs.writeFileSync(pk, JSON.stringify(pkg, null, '\t'), 'utf8')
          console.log(c.green('  ✓ 已写入' + (fromBackup ? '' : '（已备份原文件）')))
        }
      }
    }
  }

  if (process.exitCode) {
    console.log(c.red('\n有项目未通过校验，请检查上面的提示。'))
  } else if (opt.restore) {
    console.log(c.bold('\n已还原。') + ' 重新加载窗口后恢复英文。')
  } else if (opt.check) {
    console.log(c.bold('\n检查完成，未修改任何文件。'))
  } else {
    console.log(c.bold('\n完成。') + ' 重新加载窗口（Ctrl+Shift+P → Developer: Reload Window）后生效。')
  }
}

main()
