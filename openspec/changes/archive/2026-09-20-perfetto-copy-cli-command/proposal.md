## Why

Perfetto 面板目前只能通过 `record_android_trace` + 完整 txtpb 配置抓取 trace，无法快速生成一条可直接粘贴运行的 on-device perfetto 短命令。开发者在外部终端临时快速抓 trace 时，需要手动拼命令，既繁琐又易错。新增「复制快捷命令」能力，把面板当前选择实时翻译成一条可粘贴的短命令，降低快速抓 trace 的门槛。

## What Changes

- 新增 `composeCliCommand()` 辅助函数（`store/perfetto.ts`），把面板当前选择翻译成 on-device perfetto 短命令字符串
- 命令保真度档位：**含 `-b`，不含设备 serial**；不加 `--background`/`--txt`/`noOpen`/`autoOpenBrowser`
- app 过滤用实测有效写法：全部 app `'-a*'`（短标志 + 单引号包裹通配符）、具体 app `--app '...'`（长标志 + 单引号）
- 新增独立持久化字段 `cliOutputPath`（设备端路径，默认 `/data/misc/perfetto-traces/trace_file.perfetto-trace`），与现有宿主机 `outputPath` 区分；不暴露编辑入口
- 在现有 exportRow 追加「复制命令」按钮，点击复制命令到剪贴板（不常驻展示预览面板）
- 复制采用 `licia/copy` + `notify`，复用现有交互模式
- 导出配置/开机配置成功后，把开发者使用命令（push + perfetto --txt 抓取 / setprop + getprop）追加到 Perfetto traceLog 区，文件名取实际保存的 basename
- 新增 i18n 键 `copyCommand`（en-US + zh-CN；其余 locale 经 en-US 回退，对齐 perfetto 面板既有本地化约定）

## Capabilities

### New Capabilities
<!-- 无新增能力，全部为对现有 perfetto-trace-capture 能力的扩展 -->

### Modified Capabilities
- `perfetto-trace-capture`: 新增「复制快捷命令」「设备端输出路径」「导出命令显示」需求，以及命令翻译的字段映射规则与应用过滤映射

## Impact

- `src/renderer/main/store/perfetto.ts`：新增 `composeCliCommand`、`cliOutputPath` 字段及持久化
- `src/renderer/main/components/perfetto/Perfetto.tsx`：新增「复制命令」按钮、导出成功后向 traceLog 追加开发者命令
- `src/renderer/main/components/perfetto/Perfetto.module.scss`：exportRow 加 flex-wrap 适配三按钮（无新增预览框样式）
- `src/common/langs/{en-US,zh-CN}.json`：新增 `copyCommand` 键
- 无新 IPC，无主进程改动，不涉及 `record_android_trace` 抓取主路径或其 txtpb 生成
