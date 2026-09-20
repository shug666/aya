## 1. Store 层：命令翻译与持久化

- [x] 1.1 在 `src/renderer/main/store/perfetto.ts` 新增 `cliOutputPath` observable 字段，默认值 `/data/misc/perfetto-traces/trace_file.perfetto-trace`
- [x] 1.2 将 `cliOutputPath` 加入 `makeObservable` 声明
- [x] 1.3 将 `cliOutputPath` 加入 `init()` 的 `names` 数组，使其通过 `perfetto_cliOutputPath` 键持久化与恢复
- [x] 1.4 新增纯函数 `composeCliCommand(perfetto)`：返回 `adb shell perfetto -o <cliOutputPath> -t <time>s -b <buffer>mb <app段> <events...>`，复用 `composeTime`/`composeBuffer`，events 取 `selectedEvents` + 解析后的 `additionalEvents`；app 段按实测：traceAllApps=true 时 `'-a*'`、traceAllApps=false 且 app 非空时 `--app '<app>'`、否则省略；events 全为空时返回空字符串
- [x] 1.5 导出 `composeCliCommand` 供组件使用

## 2. UI 层：复制按钮

- [x] 2.1 在 `Perfetto.tsx` import `composeCliCommand` 与 `licia/copy`、`notify`
- [x] 2.2 在导出操作行（exportRow）追加「复制命令」按钮，点击调用 `copy(composeCliCommand(perfetto))` 并 `notify(t('copied'))`
- [x] 2.3 命令为空或抓取中时复制按钮置 disabled
- [x] 2.4 移除只读预览 textarea 与设备端路径输入框（不展示面板，仅保留一键复制）

## 3. 样式

- [x] 3.1 exportRow 在追加按钮后窄屏不溢出（flex wrap + min-width）
- [x] 3.2 移除不再使用的 `.cliPreview` 样式

## 4. i18n

- [x] 4.1 在 `src/common/langs/en-US.json` 与 `zh-CN.json` 新增 `copyCommand`（`copied` 经 share 回退已全局可用）
- [x] 4.2 其余 7 个 locale 无 perfetto 本地化键，`copyCommand` 经 en-US 回退生效（对齐既有约定）
- [x] 4.3 share langs 仅含通用键，perfetto 键专属 common/langs，无需同步

## 5. 导出命令显示

- [x] 5.1 在 `handleExportConfig` 成功分支，向 traceLog 追加 push 命令与 `perfetto --txt` 抓取命令（文件名取保存 basename）
- [x] 5.2 在 `handleExportBoottrace` 成功分支，向 traceLog 追加 push + setprop + getprop 三条命令
- [x] 5.3 确认 `perfettoConfig.ts` 生成器不写入任何 `#` 注释，抓取路径 txtpb 不受影响

## 6. 验证

- [x] 6.1 默认状态复制得到的命令符合 spec 默认全 app 场景的预期字符串
- [x] 6.2 切换模板/勾选类别/改时长缓冲/指定 app 后，命令字段映射正确
- [x] 6.3 traceAllApps=true 时命令含 `'-a*'`；指定 app 时含 `--app '...'`；app 空时无 app 标志
- [x] 6.4 点击复制后剪贴板内容与生成命令一致，出现复制成功通知
- [x] 6.5 重启应用后 cliOutputPath 持久化值被恢复
- [x] 6.6 导出配置/开机配置后 traceLog 出现开发者命令，且导出文件内无 `#` 注释
