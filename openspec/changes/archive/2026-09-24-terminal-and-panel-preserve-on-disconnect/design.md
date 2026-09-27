## Context

设备断开时内容丢失是两套机制叠加：

```
设备拔掉
   │
   ├─机制①  App.tsx  key={store.device.id}  "A" → ""
   │        React 卸载重建整个面板子树
   │        → xterm dispose() 销毁 scrollback；各 panel 局部 state 丢失
   │
   └─机制②  store.device = null
            各面板 if(!device) return <空状态>
            → Overview 显示 deviceNotConnected，File/Process/Logcat 直接 return
```

`Term.tsx` 本已内置弹性（`onShellClosed`→`scheduleReconnect` 退避重试 + `sessionIdRef` 零重绑），设计意图就是 blip 期间保持 xterm 存活、设备回来后在新 prompt 上方续接旧 scrollback。但机制①先卸载了它，重连逻辑从未运行。

根因：`store.device` 把「同一设备 A 暂时不可达（blip）」与「没有设备 / 真换设备」都表达成 `null`，UI 无法区分。

## Goals / Non-Goals

**Goals:**
- blip（A→null→A）期间：终端 scrollback（命令+输出）保留；各面板已显示内容保留、不翻空；底层自动重连
- 真切换（A→B）：终端与面板在新设备上重新开始（重建）
- 真断开（A 拔掉不回来）：保留上次内容（终端持续退避重连、面板显示上次数据），与 blip 同处理
- 真实连接状态仍可被按钮启停等逻辑读取（断开时禁用写操作）
- store + 渲染端改动为主；主进程 `shell.ts` `createShell` 增 `isReconnect` 参（既有 channel，无新 IPC channel），用于重连跳过 `clear`

**Non-Goals:**
- 不恢复底层 Android shell 的运行时状态（cwd / env / alias）——ADB transport 死后新 shell 从新 prompt 开始，这是物理限制；保留的仅是**可见 scrollback**（命令文本+输出）
- 不做「每台设备各保留一份面板状态、切回还原」的分片缓存（选项 ii）——显著更大工程，当前诉求 blip 保留已由 activeDevice 覆盖
- 不改 ADB tracker 的 2s 延迟 / 重连时序

## Decisions

### D1: 引入 `activeDevice = device ?? lastDevice`，不改动 `device` 语义

**选择**：新增 observable `activeDevice`，`lastDevice` 在 `device` 非空时更新为 `device`；`activeDevice` 始终取 `device ?? lastDevice`。`store.device` 语义不变（null = 当前未连接）。

**理由**：两个概念必须分离——`device` 表达「真实连接状态」（按钮启停、写操作禁用需要它），`activeDevice` 表达「UI 连续性目标」（key / 空状态守卫 / 终端重连目标）。混淆二者会让「断开时禁用按钮」与「保留内容」互相打架。用 `??` 合成而非改 `device`，把影响面限制在主动读 `activeDevice` 的组件，`device` 的既有消费者零改动。

**blip / 切设备行为表**（最终：key 恒定）：

| 场景 | device | lastDevice | activeDevice | key | 组件 | 终端 scrollback | 面板内容 |
|---|---|---|---|---|---|---|---|
| blip A→null→A | A→null→A | A | A（恒定） | 恒定 | 不卸载 | 保留(重连) | 保留(Overview 不重取) |
| 切设备 A→B | A→null→B | A→B | A→B | 恒定 | 不卸载 | **保留**(切 shell 到 B) | 各面板按依赖重取 |
| 真断开 A 不回 | A→null | A | A | 恒定 | 不卸载 | 保留(持续重连) | 保留 |

**备选**：直接改 `device` 不置 null 被否——会破坏所有读 `device` 做「已连接」判断的按钮启停逻辑。

### D2: key 恒定（不随设备变化）

**选择**：`App.tsx` 面板容器移除 `key`（恒定）。blip 与切设备都不卸载面板子树。

**演进**：初版用 `key={store.activeDevice?.id}`——blip 不变（保留），但切设备 A→B 时 key 变→重建→终端 scrollback 清空。用户明确要求**切设备也保留终端历史（跨设备保留）**，故改为 key 恒定。key 恒定后，挂载-only `[]` 取数的 Overview/File 在切设备时不重取会显示 A 旧数据——补 `[activeDevice?.id]` 依赖修正（切设备重取、blip 不重取，两全）。已有 `[device]` 依赖的 Layout/Application/Process/Logcat 无需改。

**为何不「仅对终端豁免 key」**：需把终端移出 key 容器、改动大且破坏面板子树结构。key 恒定 + 各面板按依赖重取，是更统一、改动更小的方案。

**备选**：`key={activeDevice.id}`（初版）被否——切设备重建清空终端历史，违背跨设备保留。`key={device.id}`（原版）被否——blip 清空。仅对终端豁免被否——见上。

### D3: 终端重连链路已就绪，新增断开提示与重连不清屏

**选择**：`Term.tsx` 的设备引用不改（`onShellClosed`→`scheduleReconnect`→`createShell(deviceIdRef.current)` 退避重连链路本已就绪，key 修复使 blip 期间 `Term` 不卸载即满足 scrollback 保留 + 重连瞄准原设备）。在此基础上新增两项：
1. **断开可见提示**：`onShellClosed` 置空 sessionId 前先 `term.write` 一行灰色「设备已断开，等待重连…」，避免断开时静默卡死、用户无从判断是断开还是卡住。
2. **重连跳过 clear**：`reconnect()` 传 `isReconnect=true`，主进程 `createShell` 在重连时仅设 TERM+PS1、不发 `clear`，使新 prompt 续在断开提示之后、保留可见历史。

**为何这两项是验证暴露的**：初版只做 key 修复，验证时发现重连后历史被清空——根因是主进程 `createShell` 注入的 `clear`（Android toybox `clear` = `\x1b[2J\x1b[H`）清掉可见屏。代码审查确认 2J 不清 xterm scrollback，但**可见屏上的命令被清空**（reset 成空行、未入 scrollback），用户看到"记录清空"。故把 `clear` 限定为首次创建（清 init 回显残留），重连跳过。

**备选**：在 `Term` 里把设备引用改 activeDevice 被否——多余且引入 reset-during-blip 未捕获拒绝风险。重连后保留 clear 被否——清掉可见历史，违背目标。仅靠 2J 不清 scrollback 而不改 clear 被否——可见屏仍被清，用户体感为"记录丢失"。

### D6: 终端跨设备切换——感知 device.id 变化重开 shell，不清屏

**选择**：key 恒定后终端切设备不卸载，但 `deviceIdRef` 在挂载时锁定、不会自动换设备。新增 `useEffect(...,[device?.id])` 切换 effect + `switchToDeviceRef`（把切设备能力从挂载 effect 内部暴露）：当 `device.id` 变为**不同于 `deviceIdRef`** 的新设备 id 时，停退避重连、kill 旧会话、`deviceIdRef = newId`、`createShell(newId, true)` 重开（不清屏不 dispose），新设备 prompt 续在历史之后。`switchToDeviceRef` 桥接两个 effect（挂载 effect 定义 `switchToDevice`，切换 effect 调用），避免把重连内部函数提到组件级。

**为何用 `device?.id` 而非 `activeDevice?.id`**：切设备要换真实 shell 目标，必须感知真实连接的 `device`（activeDevice 在 blip 不变，无法驱动切换）。blip 时 `device.id` 经历 A→null→A：null 瞬间 effect 跳过（无 id）；回 A 时 `A === deviceIdRef` 跳过——退避重连自处理，不误触发切换。挂载首跑 `A === deviceIdRef`（挂载 effect 先跑设了 deviceIdRef）跳过，不重复 createShell。

**竞态安全**：切设备时先 `clearTimeout` 退避轮询、kill 旧会话；旧 A 会话在途的 `shellClosed` 由 `onShellClosed` 的 `sessionIdRef !== id` 守卫过滤（切到 B 后 sessionId 是 B 的新 id）。`switchToDevice` 的 createShell 失败（B transport 未就绪）回落 `scheduleReconnect` 退避恢复。

**备选**：把终端移出 key 容器、终端单独用 `key=恒定` 其余面板用 `key=activeDevice.id` 被否——破坏面板子树结构、改动大。切设备时 dispose 旧 term 重建被否——清空 scrollback，违背跨设备保留。靠 `activeDevice` 驱动切换被否——blip 不变无法触发。

### D4: 面板审计——key 修复为主，仅 Overview 与 Logcat 需额外处理

**实现时发现的关键事实**：全仓仅 `Overview` 存在**渲染层** `if (!device)` → `deviceNotConnected` 空状态翻转；其余所有面板的 `if (!device)` 守卫都位于**取数函数 / 事件处理器**内（不在渲染路径），断开瞬间走 early-return，不清空已显示内容。因此 **key 修复（D2）本身即可保留绝大多数面板的内容**——组件不卸载、局部 state 不丢、渲染路径不翻空。原先设想「逐面板把取数依赖与守卫改读 activeDevice」是过度设计，实现中已否决。

**逐面板审计结论**：

| 面板 | 渲染层空状态? | 取数依赖 | 实际处理 |
|---|---|---|---|
| Overview | **是**（`if(!device)`→deviceNotConnected） | `useEffect(refresh,[])` 仅挂载 | 渲染守卫 + 显示字段改 `activeDevice`（唯一需要改的面板） |
| Layout | 否（render 恒显 toolbar+图） | `[device]` | 不改：blip null 瞬间 `if(!device)` early-return 保留图，恢复后自动重取最新截图（优于 activeDevice 的「保留陈旧图」） |
| Application | 否（render 恒显 grid，`isEmpty(packageInfos)` 仅 loading 态且非空时不覆盖） | `[device]` | 不改：同上，恢复后自动重取最新应用列表 |
| File | 否（render 恒显 fileList） | `useEffect(go('/'),[])` 仅挂载 | 不改：挂载-only，blip 不重取，目录树保留；`if(device) readDir` early-return 保留 |
| Process | 否（render 恒显 grid） | 轮询 `useEffect(...,[])` | 不改：`if(device)` early-return 保留进程表、轮询不停，恢复后下一轮自动刷新 |
| Screenshot/Performance/Webview/Gnirehtet/Perfetto | 否 | — | 不改：无渲染空状态，无 destructive blip effect，key 修复即保留 |
| Logcat | 否（render 恒显日志视图） | `useEffect(openLogcat,[])` 仅挂载 | **需新增重连**：见 D5 |

**理由**：被动数据面板（Layout/Application/Process）在 `[device]` 依赖 + `if(!device)` early-return 下，blip 期间内容保留，且**恢复连接后自动重取最新数据**——这比「activeDevice 不重取」更优（无陈旧数据）。只有渲染层会翻空的 Overview 必须改 activeDevice；只有实时流会死且无重开的 Logcat 必须加重连（D5）。

**备选**：把所有面板取数依赖改 activeDevice 被否——会丢失「恢复后自动刷新」的良性副作用，且对无渲染空状态的面板纯属多余改动、徒增回归面。

### D5: Logcat 拆分 effect，以 `device` 为键重连

**选择**：将原 `useEffect(openLogcat + onLogcatEntry, [])` 拆为两个 effect：
1. **挂载-only `[]`**：注册 `logcatEntry` 监听（靠 `logcatIdRef` 过滤当前流，跨重连复用，同 Term 的 `sessionIdRef` 零重绑模式）。
2. **`[device]` 为键**：`if(!device) return`；`openLogcat(device.id).then(id => logcatIdRef=id)`；cleanup `closeLogcat + logcatIdRef=''`。`entriesRef` 永不在重连路径清零。

**为何用 `device` 而非 `activeDevice`**：logcat 流随设备断开死亡，且主进程**不发 close 事件**（`src/main/lib/adb/logcat.ts` 无 close emit）。必须以真实连接状态 `device` 为键才能在 blip 的 null 瞬间关闭死流、恢复后重开新流；用 `activeDevice`（blip 不变）则永远不会重连、日志冻结。这与被动面板相反——Logcat 需要「主动重连」而非「被动保留」。

**blip 行为**：A→null（cleanup 关闭旧流、`logcatIdRef=''`，body return）→ null→A（重开新流，`logcatIdRef=id2`）。`entriesRef` 保留，LunaLogcat 视图不卸载（key 修复）保留历史条目，新日志经挂载监听续接到既有缓冲之后。`openLogcat` 的 `clear:true` 仅清设备端缓冲，不重复旧条目；断开期间（设备关机）的日志无法捕获，属物理限制。

**备选**：加主进程 `logcatClosed` 事件驱动重连被否——需新增主进程事件，且 `device` 真实状态已是更直接的重连触发源。用 activeDevice 被否——blip 不变导致日志冻结。

## Risks / Trade-offs

- **[blip 后被动面板数据自动刷新]** → Layout/Application/Process 在恢复连接后自动重取最新数据（非陈旧），属良性副作用；重取瞬间 Application 有极短 loading（`isEmpty(packageInfos)` 非空时不覆盖，故无空闪）。这比「保留陈旧数据」更优，故未按原 spec 强制「blip 不重取」。
- **[真断开（A 不回）面板保留 A 的旧数据]** → 与 blip 同处理，activeDevice 恒为 A。终端退避重连无限重试（既有行为，封顶 2s）。属可接受——用户拔掉设备即代表不再使用，保留旧数据好过翻空；重新插上或切换设备即恢复。
- **[底层 shell 运行时状态不恢复]** → 新 shell 从新 prompt 开始，cwd/env/alias 丢失。物理限制（ADB transport 已死），保留的仅是可见 scrollback。已在 Non-Goals 明确边界。
- **[Logcat 断开瞬间极短孤儿流]** → 若设备在 `openLogcat` resolve 前断开，cleanup 时 `logcatIdRef` 仍为 '' 导致不关闭、主进程残留一个轻量 reader。极罕见（断开恰好落在初次 open 的毫秒窗口），且设备断开本身会拆掉 reader，可接受。
- **[activeDevice 引入第二份设备引用]** → 增加一个 observable，但 `??` 合成 + `lastDevice` 单点更新使一致性成本极低；读 `device` 的既有逻辑零改动，回归面小。
