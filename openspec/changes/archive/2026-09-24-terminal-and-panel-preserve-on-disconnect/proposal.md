## Why

设备断开（拔线 / 重启 / ADB transport 抖动）时，终端标签页里之前输入的命令及其输出全部丢失、视图滚到顶部，其它面板（Overview / File / Process / Layout / Logcat 等）也翻成「设备未连接」空白。原因是两套机制叠加：

1. **`App.tsx` 用 `key={store.device?.id}`** —— 设备断开时 `store.device` 置 null，key 由 `"A"` 变 `""`，React 卸载并重建整个面板子树。终端 xterm 实例被 `dispose()`，scrollback（命令 + 输出）随之销毁；各面板的局部 state（已取数据）一并丢失。
2. **各面板内部 `if (!device)` 空状态守卫** —— 即便组件不卸载，`store.device` 变 null 后，Overview/File/Process/Logcat/Layout 各自走 `if (!device) return <空状态>`，照样翻空。

而 `Term.tsx` 本已内置弹性设计：`onShellClosed` → `scheduleReconnect()`（300ms→1s→2s 退避无限重试），靠 `sessionIdRef` 零重绑实现「设备回来后在新 prompt 上方续接旧 scrollback」。但 `App.tsx` 的 device-id key 先把它整个卸载了，这套重连逻辑从未有机会运行。

根因是代码把「同一台设备 A 暂时不可达（blip）」和「没有设备 / 真正换了设备」都表达成 `store.device = null`，UI 无法区分。

## What Changes

- 在 `store/index.ts` 新增 observable `activeDevice = device ?? lastDevice`：`lastDevice` 在 `device` 非空时更新，blip（A→null→A）期间 `activeDevice` 始终为 A，真切换（A→B）时 `activeDevice` 随之变 B。
- `App.tsx` 面板容器 key 由 `store.device?.id` 改为**移除 key（恒定）**：**这是主修复**——blip 与切设备都不卸载整个面板子树（终端 xterm 实例 + 各面板局部 state），终端 scrollback 跨设备保留；各面板改靠 `device`/`activeDevice` 依赖决定是否重取数据。
- 终端 `Term.tsx`：重连链路本已就绪，新增**断开可见提示**——`onShellClosed` 写入一行灰色「设备已断开，等待重连…」，避免静默卡死；`reconnect()` 传 `isReconnect=true`。新增**跨设备切换**：`[device?.id]` effect 感知设备 id 变化，切到新设备时重开 shell（不清屏），B 的 prompt 续在历史之后，实现终端跨设备保留。
- `IpcCreateShell` / 主进程 `shell.ts`：加 `isReconnect` 标志，**重连跳过 `clear`**（首次创建仍发 clear 清 init 回显），使新 prompt 续在断开提示之后、保留可见历史命令与输出。
- `Overview.tsx` / `File.tsx`：挂载-only `[]` 取数依赖改 `[activeDevice?.id]`，使 key 恒定后切设备仍重取新设备数据、blip 不重取。
- `IpcCreateShell` / 主进程 `shell.ts`：加 `isReconnect` 标志，**重连跳过 `clear`**（首次创建仍发 clear 清 init 回显），使新 prompt 续在断开提示之后、保留可见历史命令与输出。
- `Overview.tsx`：渲染层 `if (!device)`→deviceNotConnected 空状态与显示字段改读 `activeDevice`（全仓唯一渲染空状态翻转的面板，key 修复不够——需 activeDevice 阻止翻空）。
- `Logcat.tsx`：拆分 effect——挂载-only 注册 `logcatEntry` 监听（跨重连复用），新增 `[device]` 为键的 open/close effect，使 logcat 流在 blip 后自动重连（主进程不发 close 事件，必须以真实 `device` 状态驱动重连；`entriesRef` 不清零保留历史）。
- 其余面板（Layout/Application/Process/Logcat）：**无需改动**。已有 `[device]` 依赖 + `if(!device)` early-return，断开瞬间保留内容、切设备自动重取最新数据。Screenshot/Performance/Webview/Gnirehtet/Perfetto 无渲染空状态、无需改。
- 保留 `store.device` 表达「真实连接状态」：按钮启停（命令抽屉 `canExecute`、各面板 `disabled={!device}`、写操作守卫）继续读 `device`，断开时正确禁用。

## Capabilities

### New Capabilities
- `device-connection-continuity`：store 层 `activeDevice` 原语与 blip / 真切换语义
- `panel-content-continuity`：终端 scrollback 与各面板已显示内容在 blip 期间保留

### Modified Capabilities
<!-- 无既有能力被修改（终端 / 面板此前无 spec） -->

## Impact

- `src/renderer/main/store/index.ts`：新增 `activeDevice` observable 与 `lastDevice` 维护、`syncActiveDevice()` 单点同步；`selectDevice` 与 `init()` device 恢复路径经同步
- `src/renderer/main/App.tsx`：面板容器 key 改用 `activeDevice`
- `src/renderer/main/components/overview/Overview.tsx`：渲染空状态守卫、显示字段、`refresh()` 改读 `activeDevice`；按钮与 `root()` 保留 `device`
- `src/renderer/main/components/logcat/Logcat.tsx`：拆分 effect，新增 `[device]` 为键的 open/close 重连 effect
- `src/renderer/main/components/shell/Term.tsx`：`onShellClosed` 写断开提示，`reconnect()` 传 `isReconnect`
- `src/main/lib/adb/shell.ts`：`createShell` 接收 `isReconnect`，重连跳过 `clear`
- `src/common/types.ts`：`IpcCreateShell` 加 `isReconnect?`
- `src/common/langs/{en-US,zh-CN}.json`：新增 `shellDisconnected`
- 主进程有改动（shell.ts），IPC 形态变更（createShell 增参，仍走既有 createShell channel，无新 channel）
