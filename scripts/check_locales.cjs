#!/usr/bin/env node

/**
 * 翻译文件 Key 一致性检查脚本
 * 用于检测不同语言翻译文件之间的 key 差异
 */

const fs = require('fs');
const path = require('path');

// 配置
const LOCALES_DIR = path.join(__dirname, '../src/locales');
const BASELINE_FILE = 'en-US.json'; // 基准文件

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 递归获取所有的 key 路径
 * @param {Object} obj - JSON 对象
 * @param {string} prefix - 当前路径前缀
 * @returns {Set<string>} - 所有 key 的集合
 */
function getAllKeys(obj, prefix = '') {
  const keys = new Set();
  
  if (!obj || typeof obj !== 'object') {
    return keys;
  }
  
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.add(fullKey);
    
    if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      const nestedKeys = getAllKeys(obj[key], fullKey);
      nestedKeys.forEach(k => keys.add(k));
    }
  }
  
  return keys;
}

/**
 * 读取并解析 JSON 文件
 * @param {string} filePath - 文件路径
 * @returns {Object|null} - 解析后的 JSON 对象
 */
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    log(`错误: 无法读取文件 ${filePath}: ${error.message}`, 'red');
    return null;
  }
}

/**
 * 获取所有 locale 文件
 * @returns {Array<string>} - 文件名数组
 */
function getLocaleFiles() {
  try {
    const files = fs.readdirSync(LOCALES_DIR);
    return files.filter(file => file.endsWith('.json'));
  } catch (error) {
    log(`错误: 无法读取目录 ${LOCALES_DIR}: ${error.message}`, 'red');
    return [];
  }
}

/**
 * 主函数
 */
function main() {
  log('\n========================================', 'cyan');
  log('  翻译文件 Key 一致性检查', 'bright');
  log('========================================\n', 'cyan');
  
  // 获取所有 locale 文件
  const files = getLocaleFiles();
  if (files.length === 0) {
    log('没有找到任何翻译文件！', 'red');
    return;
  }
  
  log(`📁 找到 ${files.length} 个翻译文件:\n`, 'blue');
  files.forEach(file => log(`   - ${file}`, 'blue'));
  log('');
  
  // 读取并解析所有文件的 keys
  const localeKeys = new Map();
  const localeData = new Map();
  
  for (const file of files) {
    const filePath = path.join(LOCALES_DIR, file);
    const data = readJsonFile(filePath);
    
    if (data) {
      const keys = getAllKeys(data);
      localeKeys.set(file, keys);
      localeData.set(file, data);
    }
  }
  
  // 统计信息
  log('========================================', 'cyan');
  log('📊 统计信息', 'bright');
  log('========================================\n', 'cyan');
  
  const stats = [];
  for (const [file, keys] of localeKeys.entries()) {
    stats.push({ file, count: keys.size });
  }
  
  // 按 key 数量排序
  stats.sort((a, b) => b.count - a.count);
  
  // 显示统计
  const maxCount = Math.max(...stats.map(s => s.count));
  const minCount = Math.min(...stats.map(s => s.count));
  
  for (const { file, count } of stats) {
    const color = count === maxCount ? 'green' : count === minCount ? 'yellow' : 'reset';
    const badge = count === maxCount ? ' [最多]' : count === minCount ? ' [最少]' : '';
    log(`${file.padEnd(20)} ${count.toString().padStart(5)} keys${badge}`, color);
  }
  
  log('');
  
  // 找到基准文件
  if (!localeKeys.has(BASELINE_FILE)) {
    log(`警告: 未找到基准文件 ${BASELINE_FILE}，使用 key 最多的文件作为基准`, 'yellow');
  }
  
  const baselineFile = localeKeys.has(BASELINE_FILE) ? BASELINE_FILE : stats[0].file;
  const baselineKeys = localeKeys.get(baselineFile);
  
  log(`📌 使用 ${baselineFile} 作为基准 (${baselineKeys.size} keys)\n`, 'cyan');
  
  // 比较差异
  log('========================================', 'cyan');
  log('🔍 差异分析', 'bright');
  log('========================================\n', 'cyan');
  
  const differences = new Map();
  
  for (const [file, keys] of localeKeys.entries()) {
    if (file === baselineFile) continue;
    
    const missing = [...baselineKeys].filter(k => !keys.has(k));
    const extra = [...keys].filter(k => !baselineKeys.has(k));
    
    if (missing.length > 0 || extra.length > 0) {
      differences.set(file, { missing, extra });
    }
  }
  
  if (differences.size === 0) {
    log('✅ 所有文件的 key 都与基准文件一致！', 'green');
  } else {
    log(`⚠️  发现 ${differences.size} 个文件存在差异:\n`, 'yellow');
    
    for (const [file, { missing, extra }] of differences.entries()) {
      log(`📄 ${file}`, 'bright');
      
      if (missing.length > 0) {
        log(`   ❌ 缺少 ${missing.length} 个 key (相比 ${baselineFile}):`, 'red');
        missing.slice(0, 10).forEach(key => log(`      - ${key}`, 'red'));
        if (missing.length > 10) {
          log(`      ... 还有 ${missing.length - 10} 个`, 'red');
        }
      }
      
      if (extra.length > 0) {
        log(`   ➕ 多出 ${extra.length} 个 key (相比 ${baselineFile}):`, 'yellow');
        extra.slice(0, 10).forEach(key => log(`      + ${key}`, 'yellow'));
        if (extra.length > 10) {
          log(`      ... 还有 ${extra.length - 10} 个`, 'yellow');
        }
      }
      
      log('');
    }
  }
  
  // 生成详细报告
  log('========================================', 'cyan');
  log('📝 生成详细报告', 'bright');
  log('========================================\n', 'cyan');
  
  const reportPath = path.join(__dirname, '../locale-check-report.md');
  generateReport(reportPath, baselineFile, baselineKeys, localeKeys, differences, stats);
  
  log(`✅ 详细报告已生成: ${reportPath}\n`, 'green');
}

/**
 * 生成 Markdown 报告
 */
function generateReport(reportPath, baselineFile, baselineKeys, localeKeys, differences, stats) {
  let report = '';
  
  report += '# 翻译文件 Key 一致性检查报告\n\n';
  report += `> 生成时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;
  report += `> 基准文件: \`${baselineFile}\` (${baselineKeys.size} keys)\n\n`;
  
  // 统计表格
  report += '## 📊 统计概览\n\n';
  report += '| 文件 | Key 数量 | 相比基准 | 状态 |\n';
  report += '|------|---------|---------|------|\n';
  
  for (const { file, count } of stats) {
    const diff = count - baselineKeys.size;
    const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '0';
    const status = diff === 0 ? '✅ 一致' : diff < 0 ? '❌ 缺失' : '➕ 多余';
    const badge = file === baselineFile ? ' **[基准]**' : '';
    report += `| ${file}${badge} | ${count} | ${diffStr} | ${status} |\n`;
  }
  
  report += '\n';
  
  // 差异详情
  if (differences.size > 0) {
    report += '## 🔍 差异详情\n\n';
    
    for (const [file, { missing, extra }] of differences.entries()) {
      report += `### ${file}\n\n`;
      
      if (missing.length > 0) {
        report += `#### ❌ 缺少的 Key (${missing.length} 个)\n\n`;
        report += '<details>\n<summary>点击展开</summary>\n\n';
        report += '```\n';
        missing.forEach(key => report += `${key}\n`);
        report += '```\n\n';
        report += '</details>\n\n';
      }
      
      if (extra.length > 0) {
        report += `#### ➕ 多余的 Key (${extra.length} 个)\n\n`;
        report += '<details>\n<summary>点击展开</summary>\n\n';
        report += '```\n';
        extra.forEach(key => report += `${key}\n`);
        report += '```\n\n';
        report += '</details>\n\n';
      }
    }
  } else {
    report += '## ✅ 完美!\n\n';
    report += '所有翻译文件的 key 都与基准文件保持一致。\n\n';
  }
  
  // 所有 key 列表
  report += '## 📋 基准文件所有 Key\n\n';
  report += '<details>\n<summary>点击展开查看所有 key</summary>\n\n';
  report += '```\n';
  [...baselineKeys].sort().forEach(key => report += `${key}\n`);
  report += '```\n\n';
  report += '</details>\n';
  
  fs.writeFileSync(reportPath, report, 'utf8');
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { getAllKeys, readJsonFile };
