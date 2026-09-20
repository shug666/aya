## Context

Perfetto 面板当前的抓取路径是：UI 组装 `IPerfettoTraceConfig` → IPC 调用 `record_android_trace` → 写临时 txtpb → `python3 record_android_trace -o <host> -s <id> -c <txtpb>`。这条路径产物完整（含 `linux.process_stats`、`android.packages_list`、`RING_BUFFER`），但「重」——必须经 app 发起、经宿主机 Python 脚本中转。

本变更引入一条并行的「轻路径」：把面板当前选择**就地翻译**成一条可直接粘贴到任意终端的 on-device `perfetto` 短命令。这条命令不在 app 内执行，仅作字符串输出供用户复制。两条路径**产物不等价**——短命令走的是 tracebox 自动配置，不含 process_stats 等，定位为「快速手抓的便利命令」而非复刻主抓取。

命令语法的参考来源是 Perfetto 官方维护的 `record_android_trace` 脚本（`resources/record_android_trace`），但**最终以设备实测为准**——脚本内部拼出的 on-device 命令形态曾在 app 过滤一项被实测推翻（见 D2）。脚本可用作参考与默认值来源，不可作为唯一权威。关键参考点：
- line 601-603：`cmd += ['-t', args.time, '-b', args.buffer]`，具体 app 用长形式 `cmd += ['--app', "'" + app + "'"]`
- line 520：设备端目录写死 `/data/misc/perfetto-traces/`
- argparse 帮助（line 428）：`-a*` 的 bash 通配符陷阱警告（无空格、单引号包裹可避坑）

> 注：D2 的 app 过滤形式以用户设备实测为准，而非脚本内部行为——脚本自身的 `-a*` 经其 argparse 解析后传给设备的是 `--app '*'`，但在实测设备上无效，说明脚本路径（带 `--background`/`--txt` 且经 Python 中转）与裸命令路径行为不同。

## Goals / Non-Goals

**Goals:**
- 把面板选择翻译成可粘贴的 on-device perfetto 短命令，经「复制命令」按钮一键复制（不常驻展示）
- 命令保真度 = C 档：含 `-b`，不含设备 serial，不含程序化标志
- app 过滤用实测有效写法（全部 app `'-a*'`、具体 app `--app '...'`）
- 设备端输出路径与宿主机输出路径分离，避免套用 host 路径导致设备上写失败
- 纯渲染端 + store 实现，无新 IPC，无主进程改动
- 导出配置/开机配置时，把开发者使用命令显示在 Perfetto traceLog 区（不写进生成的文件，避免污染抓取路径的 txtpb）

**Non-Goals:**
- 不在 app 内执行该短命令（仅生成字符串供复制）
- 不做 `adb pull` 回拉（保持「简单命令」定位）
- 不改 `record_android_trace` 抓取主路径或其 txtpb 生成
- 不加设备 serial（多设备时用户自行补 `-s`）
- 不追求短命令产物与主路径 txtpb 产物等价

## Decisions

### D1: 命令保真度档位 = C（含 -b，不含 -s）

**选择**：`adb shell perfetto -o <device> -t <N>s -b <N>mb [--app 'x'] <events...>`

**理由**：`-b` 来自面板现成的 `bufferValue`，对高频抓 20s trace 的丢帧防护有实际价值，翻译成本低；`-s` 需引入设备选择概念到纯字符串生成，且用户多设备时可一行补上，收益小于复杂度。

**备选**：A 档（含 `-b` 和 `-s`）被否——serial 让命令绑定特定设备、可粘贴性下降；B 档（不含 `-b`）被否——浪费面板已配置的 buffer 字段。

### D2: app 过滤——全部 app 用 `'-a*'`，具体 app 用 `--app 'name'`

**选择**：`traceAllApps=true` 时生成 `'-a*'`（短标志 + 附加通配符，整体单引号包裹）；指定具体 app 时加 `--app 'com.example'`（长标志 + 单引号）；`traceAllApps=false` 且 app 为空时省略。

**理由**：以设备实测为准。实测确认：`-a*` 能抓到所有应用 trace，`--app 'com.example.app'` 能抓到指定应用 trace，而 `--app '*'` 抓不到——on-device perfetto 二进制只对短标志 `-a` 的附加值形式接受通配符，对长标志 `--app` 的 `'*'` 值不接受。整体用单引号包裹 `'-a*'` 抑制宿主 bash 对 `*` 的 glob 展开，同时保持「标志与值无空格」（`record_android_trace` 帮助 line 428 所强调的要点），从而粘贴即正确执行。

**备选**：`--app '*'` 被否——实测无效。裸 `-a*`（无引号）被否——宿主 bash 粘贴时 `*` 易被 glob 展开。省略全部 app 标志被否——命令无法体现面板 app 过滤状态。

### D3: 设备端输出路径独立持久化（`cliOutputPath`）

**选择**：新增独立字段 `cliOutputPath`，默认 `/data/misc/perfetto-traces/trace_file.perfetto-trace`，单独走 `perfetto_cliOutputPath` 持久化，不复用 `outputPath`。

**理由**：`outputPath` 是宿主机路径（`~/traces/...`），套用到 `-o` 会让设备端写入不存在的目录而失败。`record_android_trace` line 520 证实设备端目录是 `/data/misc/perfetto-traces/`，以此作为默认值。

**备选**：复用 `outputPath` 被否——路径语义不同，套用必错。`cliOutputPath` 不暴露独立编辑入口，仅用默认值并持久化（曾考虑提供可编辑输入框，已否——见 D7 收敛决策，保持面板精简）。

### D4: composeCliCommand 放在 store，与 composeTime/composeBuffer 并列

**选择**：在 `store/perfetto.ts` 新增纯函数 `composeCliCommand(perfetto)`，集中所有字段映射，UI 只负责渲染与复制。

**理由**：与现有 `composeTime`/`composeBuffer` 同构，集中翻译逻辑便于测试与复用，避免在组件内散落字符串拼接。

### D5: events 拼接不区分 atrace / ftrace

**选择**：`selectedEvents + additionalEvents` 全部作为位置参数直接 join。

**理由**：短选项模式下 on-device `perfetto` 自动区分 atrace 类别（无 `/`）与 ftrace 事件（带 `/`），无需像 txtpb 路径那样显式分流。这与 `record_android_trace` line 603 的 `cmd += args.events` 一致。

### D6: 复制交互复用现有模式

**选择**：复制用 `licia/copy` + `notify(t('copied'))`（同 `Copyable.tsx`）；exportRow 追加「复制命令」按钮，点击即将命令写入剪贴板并提示。

### D7: UI 收敛——不展示预览面板

**选择**：不提供只读预览 textarea，也不提供 `cliOutputPath` 的可编辑输入框，仅保留 exportRow 里的「复制命令」按钮。

**理由**：用户明确要求不展示命令预览面板。命令仍可一键复制（按钮点击），但不再常驻显示；`cliOutputPath` 因此也不需要编辑入口，仅保留默认值与持久化。面板更精简。

**备选**：保留只读预览框 + 设备端路径输入框被否——用户不希望常驻展示。完全移除命令生成逻辑被否——按钮仍需 `composeCliCommand`。

### D8: 导出命令显示位置——traceLog 区，而非生成脚本

**选择**：导出配置/开机配置成功后，把开发者使用命令（push + perfetto --txt 抓取 / setprop + getprop）写入 Perfetto 面板底部的 traceLog 区（`perfetto.addLog`），文件名取实际保存的 basename。

**理由**：曾考虑把这些命令作为 `#` 注释写进 `buildTraceConfigText`/`buildBoottraceConfigText` 生成的 txtpb，但无法确证 perfetto text-format parser 是否接受 `#` 注释（本地无 perfetto 二进制、在线权威源被网络拦截），而这两个生成器同时被抓取路径（`record_android_trace -c`）复用——若 `#` 注释不被接受会破坏实际抓取。故改用零风险的 traceLog 显示：命令只写进面板日志，不进任何生成的文件，抓取路径 txtpb 完全不受影响。

**备选**：在生成 txtpb 顶部加 `#` 注释被否——注释能否被 perfetto `--txt` 解析未经验证，且波及抓取路径，风险不可接受。

## Risks / Trade-offs

- **[命令产物不等价于主抓取]** → 短命令走 tracebox 自动配置、不含 process_stats 等，定位为「快速手抓」；用户点复制按钮即得，不再有预览文案可作提示，靠按钮文案「复制命令」与文档说明即可。
- **[cliOutputPath 默认目录旧设备不存在]** → `/data/misc/perfetto-traces/` 在较老设备上可能不存在（脚本 line 523 提及 fallback `/data/local/tmp`）。默认值保持 `/data/misc/perfetto-traces/`（对齐示例与现代设备），不自动探测、不暴露编辑入口，保持「简单命令」定位。
- **[cliOutputPath 不可改]** → 不提供编辑入口，用户若需改设备端路径无法在面板内操作；属刻意取舍（D7），换取面板精简。
- **[导出命令用 basename]** → 日志里的 push 命令取 `result.filePath` 的 basename，用户存成任何名/路径都对得上，复制即可跑。
