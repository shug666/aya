## 1. Store 层：activeDevice 原语

- [x] 1.1 在 `src/renderer/main/store/index.ts` 新增 observable `activeDevice`（`IDevice | null`）与私有 `lastDevice`（`IDevice | null`）
- [x] 1.2 将 `activeDevice` 加入 `makeObservable` 声明
- [x] 1.3 新增私有同步函数 `syncActiveDevice()`：device 非空时 `lastDevice = device`；置 `activeDevice = device ?? lastDevice`
- [x] 1.4 在 `selectDevice` 设置 `this.device` 后调用 `syncActiveDevice()`（isStr 分支与直接赋值分支共用）
- [x] 1.5 `init()` 中持久化 device 恢复改经 `selectDevice` 而非直接赋值，使 lastDevice/activeDevice 同步初始化（不依赖后续 refreshDevices 必触发 selectDevice）；`refreshDevices` 已全部经 `selectDevice`，无需改动
- [x] 1.6 验证（代码审查）：blip（A→null→A）时 `activeDevice` 全程恒为 A；真切换（A→B）时由 A 变 B；真断开时保持 A

## 2. App.tsx：面板容器 key 不随设备变（主修复）

- [x] 2.1 将 `<div className={Style.panels} key={store.activeDevice ? store.activeDevice.id : ''}>` 改为移除 key（恒定）：blip 与切设备都不卸载面板子树，终端 scrollback 跨设备保留
- [x] 2.2 验证（代码审查）：blip 与切设备期间 key 不变 → 面板子树不卸载

## 3. 终端：断开提示 + 重连不清屏

> key 修复使 `Term.tsx` 在 blip 期间不卸载，重连链路本已就绪。验证中发现重连后主进程注入的 `clear`（`\x1b[2J\x1b[H`）清掉可见屏，违背「保留命令」目标，故新增断开可见提示与「重连跳过 clear」。

- [x] 3.1 确认 `Term.tsx` 重连链路无需改设备引用：挂载时 `deviceIdRef = device.id` 锁定设备；`onShellClosed`→`scheduleReconnect`→`createShell(deviceIdRef.current)` 本已就绪；key 修复使 blip 期间 `Term` 不卸载 → xterm 实例与 scrollback 存活、重连始终瞄准原设备。曾试改 activeDevice，已评估为多余且引入 reset-during-blip 未捕获拒绝风险，回退保持原状
- [x] 3.2 `Term.tsx` `onShellClosed`：置空 sessionId 前先 `term.write` 一行灰色断开提示（`\r\n\x1b[90m${t('shellDisconnected')}\x1b[0m\r\n`），让用户知道设备已断开、正在重连，而非静默卡死；提示写入 scrollback 与历史一并保留
- [x] 3.3 `Term.tsx` `reconnect()`：调用 `main.createShell(deviceIdRef.current, true)` 传 `isReconnect=true`
- [x] 3.4 `common/types.ts`：`IpcCreateShell` 加 `isReconnect?: boolean` 参数
- [x] 3.5 `main/lib/adb/shell.ts` `createShell`：接收 `isReconnect`；init 命令首次创建含 `clear`、重连（isReconnect）跳过 `clear` 仅设 TERM+PS1，使新 prompt 续在断开提示之后、保留可见历史
- [x] 3.6 i18n：`src/common/langs/{en-US,zh-CN}.json` 新增 `shellDisconnected`（"Device disconnected, reconnecting…" / "设备已断开，等待重连…"）
- [x] 3.7 验证：blip 期间终端 scrollback（命令+输出）保留、视图不滚顶；断开显示提示；设备回来后新 prompt 续接在提示下方、可继续输入（重连不发 clear）
- [x] 3.8 `Term.tsx` 跨设备切换：新增 `switchToDeviceRef` + `[device?.id]` effect——`device.id` 变为不同于 `deviceIdRef` 的新设备时，停退避重连、kill 旧会话、`createShell(newId, true)` 重开（不清屏不 dispose）；blip（同设备 A→null→A）与挂载首跑跳过（id 一致）
- [x] 3.9 验证：拔 A 插 B——终端历史跨设备保留，B 的 prompt 续在历史之后、可接着输入；同一台 A 断开重连仍走退避重连（不误触发切换）

## 4. 面板：key 恒定后补设备刷新依赖

> key 不随设备变后，挂载-only `[]` 的 Overview/File 在切设备时不重取会显示 A 旧数据。补 `[activeDevice?.id]` 依赖，使切设备重取、blip 不重取。其余面板（Layout/Application/Process/Logcat）已有 `[device]` 依赖，无需改。

- [x] 4.0 `Overview.tsx`：`useEffect(refresh,[])` 改 `[activeDevice?.id]`——切设备重取、blip 不重取
- [x] 4.1 `Overview.tsx`：渲染守卫 `if (!device)` 与显示字段、`refresh()` 守卫与取数目标用 `activeDevice`（唯一渲染空状态翻转面板）；按钮 `disabled={!device}`、`root()` 写操作保留读 `device`
- [x] 4.2 `File.tsx`：`useEffect(go('/'),[])` 改 `[activeDevice?.id]`——切设备重置到根读新设备目录、blip 保留当前目录树
- [x] 4.3 `Logcat.tsx`：将原 `useEffect(openLogcat+监听, [])` 拆为——挂载-only `[]` 注册 `logcatEntry` 监听（靠 `logcatIdRef` 过滤，跨重连复用）；新增 `[device]` 为键 effect：`if(!device) return`→`openLogcat`、cleanup `closeLogcat+logcatIdRef=''`，使 blip 后流自动重连；`entriesRef` 不在重连路径清零
- [x] 4.4 `Layout.tsx` / `Application.tsx` / `Process.tsx`：**不改**。已有 `[device]` 依赖 + `if(!device)` early-return：断开瞬间保留、切设备自动重取最新数据
- [x] 4.5 `Screenshot/Performance/Webview/Gnirehtet/Perfetto`：**不改**。无渲染空状态、无 destructive blip/switch effect
- [x] 4.6 全面板确认：按钮 `disabled={!device}`、`canExecute={!!device && ...}`、写操作守卫**保留读 `device`**（断开时正确禁用）

## 5. 验证

- [x] 5.1 `npx tsc --noEmit` 通过（无类型错误）
- [x] 5.2 `npx eslint` 改动文件通过（store / App / Overview / File / Logcat / Term / shell.ts）
- [x] 5.3 手动验证：blip（`adb reconnect` / 设备重启）——终端输入若干命令后断开再恢复，命令与输出仍在、视图未滚顶、断开显示提示、重连后可继续输入（验证 Pass）
- [x] 5.4 手动验证：blip 期间 Overview 不翻「设备未连接」、保留断开前内容；Layout/Application/Process 恢复后自动刷新为最新
- [x] 5.5 手动验证：blip 期间命令抽屉执行按钮、各面板写操作按钮正确禁用（读 `device`）
- [x] 5.6 手动验证：切设备（拔 A 插 B）——终端跨设备保留历史、B 的 prompt 续在其后；Overview/File/Layout/Application/Process/Logcat 切到 B 数据
- [x] 5.7 手动验证：Logcat 重连/切设备后新日志续接到既有缓冲之后，不丢失历史条目
- [x] 5.8 手动验证：真断开（拔设备不回）——终端持续退避重连、面板保留上次内容、写操作禁用
