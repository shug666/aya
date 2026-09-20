# Perfetto Trace Capture

## Requirements

### Requirement: 短命令字段翻译规则
系统 SHALL 按固定规则把面板字段翻译为 on-device perfetto 短命令的各部分：时长取 `timeValue` 拼接 `s` 单位、缓冲取 `bufferValue` 拼接 `mb` 单位、事件取 `selectedEvents` 与 `additionalEvents` 合并后全部作为位置参数、输出路径取独立的设备端 `cliOutputPath`。命令 SHALL 包含 `-b`（缓冲），且 SHALL NOT 包含设备 serial（`-s`）、`--background`、`--txt`、`-n` 或任何浏览器/导出相关标志。

#### Scenario: 含缓冲参数
- **WHEN** 生成短命令
- **THEN** 命令 SHALL 包含 `-b <bufferValue>mb` 形式的缓冲参数

#### Scenario: 不含设备 serial
- **WHEN** 生成短命令
- **THEN** 命令 SHALL 以裸 `adb shell perfetto` 开头，不含 `-s <serial>`

#### Scenario: 事件作为位置参数
- **WHEN** selectedEvents 为 `['sched','gfx']` 且 additionalEvents 解析出 `['power/cpu_frequency']`
- **THEN** 命令 SHALL 在所有标志之后追加 `sched gfx power/cpu_frequency` 作为位置参数，不区分 atrace 类别与 ftrace 事件

#### Scenario: 时长与缓冲来自面板
- **WHEN** 面板 timeValue 为 20、bufferValue 为 128
- **THEN** 命令 SHALL 包含 `-t 20s -b 128mb`

---

### Requirement: 应用过滤的命令映射
系统 SHALL 在指定具体应用时以 `--app '<app>'`（长标志 + 单引号包裹）形式写入命令，在追踪全部应用（`traceAllApps` 为 true）时以 `'-a*'`（短标志 + 附加通配符值，整体单引号包裹）形式写入命令，在 `traceAllApps` 为 false 且应用名为空时 SHALL 省略 app 标志。

#### Scenario: 指定具体应用
- **WHEN** traceAllApps 为 false 且 app 为 `com.example.app`
- **THEN** 命令 SHALL 包含 `--app 'com.example.app'` 段，置于事件位置参数之前

#### Scenario: 追踪全部应用
- **WHEN** traceAllApps 为 true
- **THEN** 命令 SHALL 包含 `'-a*'` 段（短标志附加通配符，整体用单引号包裹以抑制 shell 的 glob 展开），置于事件位置参数之前

#### Scenario: 应用名为空时省略
- **WHEN** traceAllApps 为 false 但 app 为空字符串
- **THEN** 命令 SHALL NOT 包含任何 app 标志

---

### Requirement: 设备端输出路径默认值与持久化
系统 SHALL 维护一个独立于宿主机 `outputPath` 的设备端输出路径 `cliOutputPath`，用于短命令的 `-o` 参数，默认值为 `/data/misc/perfetto-traces/trace_file.perfetto-trace`，并 SHALL 持久化该值。该路径不暴露独立编辑入口，采用默认值。

#### Scenario: 默认设备端路径
- **WHEN** 无持久化值
- **THEN** 系统 SHALL 使用默认值 `/data/misc/perfetto-traces/trace_file.perfetto-trace`

#### Scenario: 与宿主机路径分离
- **WHEN** 生成短命令
- **THEN** 命令的 `-o` 参数 SHALL 取 `cliOutputPath`，且 SHALL NOT 使用宿主机 `outputPath`

---

### Requirement: 复制快捷命令
系统 SHALL 在 Perfetto 配置面板的导出操作行提供复制按钮，点击后将当前面板选择翻译出的短命令字符串写入系统剪贴板，并通过通知提示复制成功。

#### Scenario: 成功复制
- **WHEN** 用户点击复制按钮且生成的短命令非空
- **THEN** 系统 SHALL 将短命令字符串写入剪贴板，并显示复制成功通知

#### Scenario: 空命令时禁用
- **WHEN** 生成的短命令为空字符串（如未选任何事件）
- **THEN** 复制按钮 SHALL 处于禁用状态

#### Scenario: 抓取中禁用
- **WHEN** 抓取状态为 recording 或 pulling
- **THEN** 复制按钮 SHALL 处于禁用状态

---

### Requirement: 导出配置显示开发者使用命令
系统 SHALL 在导出配置成功后，向 Perfetto 面板底部 traceLog 区追加设备端使用命令，且 SHALL NOT 将这些命令写入导出的 txtpb 文件（避免污染抓取路径复用的生成内容）。命令中的文件名 SHALL 取实际保存文件名的 basename。

#### Scenario: 导出配置成功显示命令
- **WHEN** 用户成功导出普通配置至 `config.txtpb`
- **THEN** traceLog SHALL 追加 `adb push config.txtpb /data/misc/perfetto-configs/config.txtpb` 与 `adb shell perfetto --txt -c /data/misc/perfetto-configs/config.txtpb -o /data/misc/perfetto-traces/trace.perfetto-trace`

#### Scenario: 导出配置不写入文件
- **WHEN** 用户导出普通配置
- **THEN** 导出的 txtpb 文件 SHALL NOT 包含任何 `#` 注释或开发者使用命令

---

### Requirement: 导出开机配置显示开发者使用命令
系统 SHALL 在导出开机配置成功后，向 Perfetto 面板底部 traceLog 区追加 push + setprop + getprop 三条命令，且 SHALL NOT 将这些命令写入导出的 pbtxt 文件。命令中的文件名 SHALL 取实际保存文件名的 basename。

#### Scenario: 导出开机配置成功显示命令
- **WHEN** 用户成功导出开机配置至 `boottrace.pbtxt`
- **THEN** traceLog SHALL 追加 `adb push boottrace.pbtxt /data/misc/perfetto-configs/boottrace.pbtxt`、`adb shell setprop persist.debug.perfetto.boottrace 1`、`adb shell getprop persist.debug.perfetto.boottrace`

#### Scenario: 导出开机配置不写入文件
- **WHEN** 用户导出开机配置
- **THEN** 导出的 pbtxt 文件 SHALL NOT 包含任何 `#` 注释或开发者使用命令
