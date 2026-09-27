## ADDED Requirements

### Requirement: 面板容器 key 不随设备变化
系统 SHALL 使面板容器（`App.tsx` 的 `Style.panels` 节点）的 React key 不随设备变化（恒定），使设备断开（blip）与切换设备（拔 A 插 B / 下拉切设备）都不卸载面板子树。终端 scrollback 跨设备保留；各面板按各自 `device`/`activeDevice` 依赖决定是否重取数据。

#### Scenario: blip 不卸载面板子树
- **WHEN** 设备 A 断开后重新连上
- **THEN** 面板容器 key SHALL 不变，React SHALL NOT 卸载并重建面板子树

#### Scenario: 切设备不卸载面板子树
- **WHEN** 用户从设备 A 切换到设备 B
- **THEN** 面板容器 key SHALL 不变，React SHALL NOT 卸载并重建面板子树

---

### Requirement: 终端 scrollback 在 blip 期间保留
系统 SHALL 在设备短暂断开期间保持终端 xterm 实例存活（不被卸载，靠面板容器 key 贯穿 blip），保留用户已输入命令及其输出的可见 scrollback，并在设备恢复后续接新 prompt 于旧输出之下。终端底层退避重连 SHALL 在 blip 期间始终瞄准原设备（挂载时锁定的 `deviceIdRef`，随组件存活）， SHALL NOT 因 `device` 为 null 而中止重连。

#### Scenario: 断开后命令与输出保留
- **WHEN** 用户在终端输入若干命令后设备短暂断开再恢复
- **THEN** 终端 SHALL 保留断开前的命令及其输出，视图 SHALL NOT 滚到顶部

#### Scenario: 恢复后续接新 prompt
- **WHEN** 设备恢复连接
- **THEN** 新的 shell prompt SHALL 出现在既有 scrollback 之下，历史内容 SHALL NOT 被清除

#### Scenario: blip 期间重连瞄准原设备
- **WHEN** 设备 A 断开
- **THEN** 终端底层退避重连 SHALL 以 A 为 `createShell` 目标， SHALL NOT 因 `device` 为 null 而中止重连

---

### Requirement: 设备断开可见提示
系统 SHALL 在终端会话非预期死亡（设备断开）时，向终端写入一行可见的断开提示（灰色），告知用户设备已断开、正在自动重连，而非静默卡死。提示 SHALL 写入 scrollback 与历史命令一并保留。

#### Scenario: 断开时显示提示
- **WHEN** 终端会话因设备断开而死亡（`shellClosed` 事件，且为当前会话）
- **THEN** 终端 SHALL 写入一行灰色断开提示文本，提示设备已断开、等待重连

#### Scenario: 提示与历史一并保留
- **WHEN** 设备恢复连接后
- **THEN** 断开提示 SHALL 保留在 scrollback 中， SHALL NOT 被清除

---

### Requirement: 重连不清屏
系统 SHALL 区分 shell 的「首次创建」与「断开重连」：首次创建时注入的 init 命令包含 `clear`（清掉 init 回显残留）；断开重连时 SHALL 跳过 `clear`，仅重设 TERM 与 PS1，使新 prompt 续在断开提示之后、保留断开前的可见历史命令与输出。重连 SHALL 通过 `createShell` 的 `isReconnect` 标志区分两类场景。

#### Scenario: 首次创建发 clear
- **WHEN** 系统首次为设备创建 shell（`isReconnect` 为假）
- **THEN** 注入的 init 命令 SHALL 包含 `clear`

#### Scenario: 断开重连跳过 clear
- **WHEN** 终端退避重连调用 `createShell`（`isReconnect` 为 true）
- **THEN** 注入的 init 命令 SHALL NOT 包含 `clear`， SHALL 仅重设 TERM 与 PS1

#### Scenario: 重连后历史保留并可继续输入
- **WHEN** 设备断开后恢复，重连成功
- **THEN** 断开前的可见命令与输出 SHALL 保留，新 prompt SHALL 续在其后，用户 SHALL 可接着输入命令

---

### Requirement: 终端跨设备切换保留历史
系统 SHALL 在切换设备（拔 A 插 B / 下拉选另一台设备）时不卸载终端、不清屏，保留既有 scrollback，并将 shell 会话切换到新设备——新设备的 prompt 续在历史之后。切换 SHALL 通过感知 `device.id` 变化实现：当 `device.id` 变为不同于当前绑定设备（`deviceIdRef`）的新设备 id 时，停掉旧退避重连、kill 旧会话、以新设备为 `createShell` 目标重开（`isReconnect=true`，不发 clear）。blip（同设备 A→null→A）SHALL NOT 触发切换——退避重连链路自处理。

#### Scenario: 切设备不卸载终端
- **WHEN** 用户从设备 A 切换到设备 B
- **THEN** 终端 SHALL NOT 卸载、SHALL NOT 清屏，既有命令与输出 SHALL 保留

#### Scenario: 切设备切换 shell 目标到新设备
- **WHEN** `device.id` 变为设备 B（不同于当前 deviceIdRef 的 A）
- **THEN** 终端 SHALL kill 旧 A 会话、以 B 为目标 `createShell(B, true)` 重开，B 的 prompt SHALL 续在历史之后，用户 SHALL 可接着输入

#### Scenario: blip 不误触发切换
- **WHEN** 同一设备 A 断开后恢复（device.id 经历 A→null→A）
- **THEN** 切换 SHALL NOT 触发（A === deviceIdRef），退避重连链路 SHALL 负责恢复

#### Scenario: 挂载首跑不重复建会话
- **WHEN** 终端首次挂载且设备已连接
- **THEN** 挂载 effect SHALL 创建会话，切换 effect SHALL 因 `device.id === deviceIdRef` 跳过，SHALL NOT 重复 `createShell`

---

### Requirement: 面板已显示内容在 blip 期间保留
系统 SHALL 使各数据面板在设备短暂断开期间保留断开前已显示的内容，不翻成「设备未连接」空状态。主要机制是面板容器 key 贯穿 blip（组件不卸载、局部 state 不丢）。对于渲染层存在「设备未连接」空状态翻转的面板（Overview），其渲染守卫与显示字段 SHALL 读 `activeDevice`，使 blip 期间不翻空。对于取数依赖 `[device]` 的被动数据面板（Layout、Application、Process 等），其取数函数内的 `if (!device)` early-return 守卫 SHALL 保留读 `device`，使断开瞬间不清空已显示内容，且恢复连接后自动重取最新数据。

#### Scenario: 渲染空状态面板不翻空
- **WHEN** 设备 A 短暂断开
- **THEN** Overview SHALL 继续显示断开前的内容， SHALL NOT 渲染「设备未连接」空状态

#### Scenario: 被动面板断开瞬间不清空
- **WHEN** 设备 A 短暂断开（`device` 变 null）
- **THEN** Layout/Application/Process/File 等面板取数函数 SHALL early-return， SHALL NOT 清空已显示内容

#### Scenario: 被动面板恢复后自动重取最新数据
- **WHEN** 设备 A 恢复连接（`device` 重新为 A）
- **THEN** Layout/Application/Process 等以 `[device]` 为依赖的面板 SHALL 自动重新取数并显示最新数据

#### Scenario: 真切换重取数据
- **WHEN** 用户从设备 A 切换到设备 B
- **THEN** 面板 SHALL NOT 依赖重建重取，而 SHALL 通过 `[device?.id]` 或 `[activeDevice?.id]` 依赖感知切换并重新取数显示新设备数据（挂载-only `[]` 的 Overview/File SHALL 加设备依赖）

#### Scenario: Logcat 历史条目不丢失
- **WHEN** 设备短暂断开后恢复
- **THEN** Logcat SHALL 保留断开前的日志条目，新日志 SHALL 续接到既有缓冲之后， SHALL NOT 清空历史

---

### Requirement: Logcat 流在 blip 后重连
系统 SHALL 以真实连接状态 `device` 为键管理 Logcat 流生命周期：设备连接时 `openLogcat`，断开时 `closeLogcat`，使短暂断开后流自动重开。`entriesRef` 日志缓冲 SHALL 不在重连路径清零。日志条目监听 SHALL 挂载一次并跨重连复用（靠 `logcatIdRef` 过滤当前流），不随重连重绑。

#### Scenario: 断开后恢复重开流
- **WHEN** 设备 A 短暂断开后恢复
- **THEN** Logcat SHALL 关闭断开前的旧流并重开新流，新日志 SHALL 续接到既有缓冲之后

#### Scenario: 监听跨重连复用
- **WHEN** 设备短暂断开后恢复
- **THEN** 日志条目监听 SHALL NOT 重新注册， SHALL 通过 `logcatIdRef` 过滤自动路由到新流

---

### Requirement: 真实连接状态仍可用于按钮启停
系统 SHALL 保留 `store.device`（null 表示当前未连接）作为按钮启停与写操作可用性判断的依据。命令抽屉 `canExecute`、各面板 `disabled={!device}` 等真实状态判断 SHALL 继续读 `device`，使设备断开时写操作按钮正确禁用，不受 `activeDevice` 保留内容的影响。

#### Scenario: 断开时写操作禁用
- **WHEN** 设备 A 断开（`device` 为 null，`activeDevice` 保持 A）
- **THEN** 命令抽屉执行按钮 SHALL 处于禁用状态，各面板写操作按钮 SHALL 禁用

#### Scenario: 恢复后写操作重新启用
- **WHEN** 设备 A 恢复连接（`device` 重新为 A）
- **THEN** 写操作按钮 SHALL 重新启用
