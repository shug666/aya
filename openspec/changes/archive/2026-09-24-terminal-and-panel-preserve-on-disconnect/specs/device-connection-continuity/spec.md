## ADDED Requirements

### Requirement: activeDevice 连续性原语
系统 SHALL 在 main store 维护一个 observable `activeDevice`，其值取 `device ?? lastDevice`，其中 `lastDevice` 在 `device` 为非空时更新为当前 `device`。`store.device` SHALL 保持既有语义（null 表示当前未连接），不被本机制改变。`activeDevice` SHALL 表达「UI 连续性目标」：在同一设备短暂断开（blip）期间保持为该设备，仅在真正切换到另一台设备时才改变。

#### Scenario: blip 期间 activeDevice 恒定
- **WHEN** 设备 A 断开后重新连上（A → null → A）
- **THEN** `activeDevice` SHALL 全程保持为 A，断开期间不变为 null

#### Scenario: 真切换时 activeDevice 随之改变
- **WHEN** 当前设备为 A，用户切换到设备 B
- **THEN** `activeDevice` SHALL 由 A 变为 B

#### Scenario: 真断开时保留 lastDevice
- **WHEN** 设备 A 断开且不再回来
- **THEN** `activeDevice` SHALL 保持为 A（取 `lastDevice`），不变为 null

#### Scenario: device 语义不变
- **WHEN** 设备 A 断开
- **THEN** `store.device` SHALL 变为 null，既有读 `device` 判断「已连接」的消费者 SHALL 行为不变

---

### Requirement: activeDevice 同步点
系统 SHALL 在所有设置 `device` 的路径（`selectDevice` 的字符串分支与直接赋值分支、`refreshDevices` 经 `selectDevice` 的调用）上同步更新 `lastDevice` 与 `activeDevice`，确保 `activeDevice` 永远等于 `device ?? lastDevice`，不存在不一致窗口。

#### Scenario: selectDevice 字符串分支同步
- **WHEN** `selectDevice` 收到一个设备 id 字符串并解析到对应设备 d
- **THEN** `lastDevice` SHALL 更新为 d，`activeDevice` SHALL 更新为 d

#### Scenario: selectDevice 直接赋值 null 同步
- **WHEN** `selectDevice(null)` 被调用
- **THEN** `device` SHALL 置 null，`activeDevice` SHALL 取 `lastDevice`（保留上一次非空设备）
