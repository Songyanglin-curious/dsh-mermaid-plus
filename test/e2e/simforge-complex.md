# SimForge 复杂 Mermaid 集成测试集

从 `D:\code\SimForge\docs` 抽取的 8 张复杂图，用于在本地验证 dsh-mermaid-plus 的渲染、主题适配、缩放与全屏查看器。每张图下方标注了原始出处：其中 6 张出自《SimForge_当前系统架构与数据流转全景.md》的新版（`docs/design/current/`），2 张出自 `docs/guide/资源归属.md` 与 `docs/articles/drafts/01-从Mock数据到设备仿真.md`。

> **这份不是逐字提炼**：图块统一重排了缩进；流程 D 的 `Note` 里原文是半角分号（`GenerateData[A:p1,p2; B:p3]`），Mermaid 会把它当语句分隔符而解析失败，这里用的是全角 `；`。原文已于 2026-11-15 改成全角，逐字版本见 [`simforge-panorama.md`](simforge-panorama.md)（9 张，现已全部渲染通过）。

> 用途：`node test/serve-e2e.mjs` 后在浏览器打开 `http://127.0.0.1:8732/simforge.html`
> 也能作为普通 Markdown 在 DSH 的文档预览里直接查看（插件会装饰任何 `<pre>` 里的 Mermaid）。


---

## SimForge 系统架构全景（flowchart + 4 subgraph，20 节点）

来源：`docs/design/current/SimForge_当前系统架构与数据流转全景.md` 第 114 行

```mermaid
flowchart TB
subgraph 浏览器["浏览器（系统默认浏览器，仅本机）"]
FE["Vue3 + Naive UI 前端<br/>hash 路由：台账/运行/设置"]
end

FE -->|"HTTP /api/*<br/>X-Auth-Token + Origin 校验"| API
FE -->|"EventSource 替代方案：fetch + ReadableStream<br/>GET /api/simulation/stream"| SSE

subgraph SimForge.exe["SimForge.exe（.NET 9 + Kestrel，127.0.0.1:{port}）"]
API["Minimal API 端点<br/>ThingModel/Device/Storage/Simulation/Sample"]
AUTH["令牌+Origin 认证中间件<br/>（仅 /api）"]
STATIC["静态资源服务<br/>Debug=物理 wwwroot / Release=嵌入资源"]

subgraph 台账层["台账层（持久化）"]
TS["ThingModelStore"] --> DB["DatabaseService"]
DS["DeviceStore"] --> DB
SS["SettingsStore<br/>settings.json（仿真参数/数据目录）"]
DB --> SQLITE[("SQLite simulator.db<br/>7 张表，schema v1")]
end

subgraph 仿真引擎["仿真引擎（SimulationEngine 单例）"]
CLK["SimulationClock<br/>虚拟时间/倍率/冻结"]
ES["EventScheduler<br/>全局相位网格 → 时刻批次"]
BQ["BatchQueue<br/>Channel 容量 512"]
TC["TaskCoordinator<br/>批次严格串行"]
GX["GenerateDataExecutor<br/>工作副本并行计算"]
RPT["ReportExecutor<br/>固定断面 + 异步组装"]
DC["DataCenter<br/>统一提交屏障"]
OC["OverloadController<br/>队列占用率 → 提醒/降倍率/告警"]
REG["RuntimeRegistry<br/>deviceId → DeviceRuntime"]
end

OUT["SimulationOutput<br/>SSE 订阅广播"]
end

API --> TS
API --> DS
API --> SS
API --> 仿真引擎
仿真引擎 --> OUT
CLK --> ES
ES --> BQ
BQ --> TC
TC --> GX
TC --> RPT
GX --> DC
RPT --> DC
OC --> CLK
REG --> ES
OUT --> SSE
SSE --> FE
STATIC --> FE
```


---

## SQLite 7 表实体关系（erDiagram，11 实体）

来源：`docs/design/current/SimForge_当前系统架构与数据流转全景.md` 第 280 行

```mermaid
erDiagram
import_archive ||--o{ thing_model : "import_archive_id (ON DELETE SET NULL)"
import_archive ||--o{ device : "import_archive_id (ON DELETE SET NULL)"
thing_model ||--o{ thing_model_property : "model_id (RESTRICT)"
thing_model ||--o{ thing_model_event : "model_id (RESTRICT)"
thing_model ||--o{ thing_model_service : "model_id (RESTRICT)"
thing_model ||--o{ device : "model_id (RESTRICT)"
device ||--o{ device_point_config : "device_id+model_id (CASCADE)"
thing_model_property ||--o{ device_point_config : "model_id+property_id (RESTRICT)"

thing_model {
TEXT id PK
TEXT productKey
TEXT version
TEXT name
TEXT schema
TEXT import_archive_id FK
}
thing_model_property {
TEXT id PK
TEXT model_id FK
TEXT identifier
TEXT type
TEXT specs "JSON"
}
thing_model_event {
TEXT id PK
TEXT model_id FK
TEXT identifier
TEXT outputData "JSON array"
}
thing_model_service {
TEXT id PK
TEXT model_id FK
TEXT identifier
TEXT inputData "JSON array"
TEXT outputData "JSON array"
}
device {
TEXT id PK
TEXT deviceId UK
TEXT productKey
TEXT thgModelVer
TEXT model_id FK
TEXT import_archive_id FK
}
device_point_config {
TEXT id PK
TEXT device_id FK
TEXT model_id FK
TEXT property_id FK
REAL scanPeriod
REAL reportPeriod
REAL threshold
REAL scale
TEXT source_extra_json "JSON"
TEXT simulation_json "JSON, 预留"
}
import_archive {
TEXT id PK
TEXT import_type
TEXT original_filename
TEXT relative_path
TEXT sha256
}
```


---

## 仿真 tick 批次链路（sequenceDiagram，8 参与者，loop/alt/Note）

来源：`docs/design/current/SimForge_当前系统架构与数据流转全景.md` 第 548 行

```mermaid
sequenceDiagram
autonumber
participant CLK as SimulationClock
participant ES as EventScheduler
participant BQ as BatchQueue(512)
participant TC as TaskCoordinator
participant GX as GenerateDataExecutor
participant DC as DataCenter
participant RPT as ReportExecutor
participant OUT as SimulationOutput/SSE

loop 每 100ms 现实 tick
CLK->>ES: SchedulerTickOnce(clock.Now)
ES->>ES: CollectDueBatches：全局最小网格点 M ≤ now
Note over ES: 同刻跨设备合并：<br/>GenerateData[A:p1,p2；B:p3] + ReportData[A,B]<br/>（GenerateData 恒在 ReportData 前）
ES->>BQ: TryWrite(Batch{ BatchTime=M })
Note over BQ: 队列满 → EnterError（时钟冻结、停止产批次）
end
BQ->>TC: 串行取批次（前一批次未完成则下一批次不开始）
TC->>GX: Execute(BatchTime=M, GenerateData任务)
GX->>GX: 逐设备生命周期校验（null / Status!=Running / StartedAt>M → 跳过）
GX->>GX: 设备锁内 CloneForCompute 全部测点 → 工作副本
GX->>GX: 设备并行计算（只算 PointIds 到期测点；生成时间戳=batchTime）
alt 任一设备计算失败
GX-->>TC: Fail(阶段=计算) → 整批零落库 → EnterError
else 全部成功
GX->>DC: CommitBatch（提交屏障 lock）
DC->>DC: 锁内逐设备 Apply（写回正式测点状态）
GX-->>TC: Ok(ExecutedCount)
GX->>OUT: PublishScanEvent（屏障外读已提交状态 → runtime 事件）
end
TC->>RPT: Execute(BatchTime=M, ReportData任务)
RPT->>DC: ReadDeviceSnapshot（提交屏障内复制已提交断面）
RPT->>RPT: 设备锁内冻结 ReportIdentity（含 MessageSeq+1）
RPT->>RPT: TryWrite(ReportWorkItem) 内部队列（满→批次失败）
RPT-->>TC: Ok（不等待异步组装）
TC->>TC: 批次 Completed（StartedAt/CompletedAt=虚拟时间）
Note over RPT,OUT: 异步 ProcessLoop：组装报文 → PublishOutputEvent → SSE → 前端日志
```


---

## 仿真引擎对象图（flowchart，19 条边、含 HTML 实体 &lt; &gt;）

来源：`docs/design/current/SimForge_当前系统架构与数据流转全景.md` 第 443 行

```mermaid
flowchart TB
ENGINE["SimulationEngine（单例）"]
ENGINE --> REG["RuntimeRegistry<br/>ConcurrentDictionary&lt;deviceId, DeviceRuntime&gt;"]
ENGINE --> CLK["SimulationClock<br/>（唯一时间源）"]
ENGINE --> ES["EventScheduler"]
ES --> DSD["DeviceSchedule（设备上报序列 ticks）"]
ES --> PSD["PointSchedule（测点扫描序列 ticks）"]
ENGINE --> BQ["Channel&lt;Batch&gt;（512）"]
BQ --> TC["TaskCoordinator（串行）"]
TC --> GX["GenerateDataExecutor"]
GX -->|"工作副本 CloneForCompute<br/>并行计算"| PT["PointRuntime（副本）"]
GX --> DC["DataCenter（提交屏障）"]
DC -->|"CommitBatch: 锁内 Apply"| RT["DeviceRuntime.Points（正式状态）"]
TC --> RPT["ReportExecutor"]
RPT -->|"屏障内读已提交断面"| DC
RPT --> RQ["Channel&lt;ReportWorkItem&gt;（512）"]
RQ --> ASM["DeviceMessageAssembler"]
ASM --> OUT["SimulationOutput → SSE"]
REG --> RT["DeviceRuntime"]
RT -->|"Sync 锁保护"| PTS["PointRuntime[]"]
ENGINE --> OC["OverloadController（采样队列占用）"]
```


---

## 启停与异常停机时序（sequenceDiagram，rect 分组）

来源：`docs/design/current/SimForge_当前系统架构与数据流转全景.md` 第 650 行

```mermaid
sequenceDiagram
autonumber
participant FE as 前端
participant API as /api/simulation/*
participant E as SimulationEngine
participant ES as EventScheduler
participant TC as TaskCoordinator
participant GX as GenerateDataExecutor
participant CLK as SimulationClock

rect rgb(240,248,255)
Note over FE,GX: 单设备停止（2026-11-06 起无 HTTP 入口）
API->>E: Stop(deviceId)
E->>E: 设备锁内 Status=Stopped
E->>ES: OnDeviceStopped（注销调度序列，不再产新批次）
E->>FE: PublishRuntimeEvent(kind='stopped')
Note over GX: 已入队旧批次：Status!=Running 或 StartedAt>batchTime → 跳过该设备<br/>（同批次其他设备继续，不触发 Error）
end

rect rgb(255,248,240)
Note over FE,CLK: 异常停机（批次失败 / 队列满）
TC->>TC: 同步阶段失败 → Fail(batch, FailStage) → EnterError(reason)
E->>E: EngineState=Error（幂等）+ _clock.Halt()（冻结虚拟时间）+ engine-error 日志
Note over TC: 队列中剩余批次 → Cancelled（EngineState!=Running）
Note over E: Error 为终态：Start 拒绝新设备；无恢复 API（需重启进程）
end

rect rgb(240,255,240)
Note over FE,CLK: 进程退出与重启
E->>E: Dispose → Stopped + 队列 Complete + CTS Cancel
Note over CLK: 重启 = 新引擎：从 settings.json 恢复 startTime/rate；<br/>运行时状态（测点值/状态/序号）全部不恢复；设备需重新启动
end
```


---

## 全局共享资源与方案资源归属（flowchart + subgraph 跨图连线）

来源：`docs/guide/资源归属.md` 第 11 行

```mermaid
flowchart TB
subgraph GLOBAL["全局共享资源"]
MODEL["物模型：属性、类型、单位、枚举定义"]
DEVICE["设备与测点台账"]
BUS["消息连接：地址与认证"]
DEVICE -->|关联属性定义| MODEL
end
subgraph SCHEME["每个方案独立拥有"]
MEMBERS["参与设备清单"]
GEN["测点初值、生成规则、执行条件、启用状态"]
PERIOD["扫描与上报周期：模型默认、设备覆盖"]
TIME["起始时间、默认倍率、生成 Tick"]
SEND["发送设置：连接引用、Topic、Key 规则"]
end
MEMBERS -->|引用，不复制| DEVICE
GEN -->|配置指定设备测点| DEVICE
PERIOD -->|配置属性或设备测点| DEVICE
SEND -->|引用| BUS
SCHEME -->|启动时加载| SESSION["内存运行会话：当前值、采集值、时钟进度、执行状态"]
```


---

## 物模型与设备 JSON 关联（flowchart，虚线带标签 + direction TB）

来源：`docs/articles/drafts/01-从Mock数据到设备仿真.md` 第 93 行

```mermaid
flowchart TB
subgraph M["物模型 JSON"]
direction TB
M1["profile<br/>productKey: 34jRPwAgDiS<br/>version: 1.0"]
M2["properties[]<br/>ESS_A_phsA<br/>float / A / 只读"]
M1 --> M2
end

subgraph D["设备 JSON"]
direction TB
D1["id: 3BMeh1ZUCCs<br/>productKey: 34jRPwAgDiS<br/>thgModelVer: 1.0"]
D2["topos[]<br/>ESS_A_phsA<br/>扫描 5 / 上报 60 / 阈值 2"]
D1 --> D2
end

D1 -. "关联物模型" .-> M1
D2 -. "通过 identifier 匹配" .-> M2
```


---

## 批次状态机（stateDiagram-v2）

来源：`docs/design/current/SimForge_当前系统架构与数据流转全景.md` 第 786 行

```mermaid
stateDiagram-v2
[*] --> Pending: EventScheduler 入队
Pending --> Running: TaskCoordinator 取出
Running --> Completed: 全部任务成功（AddCompletedBatch）
Running --> Failed: 同步任务失败（记录 FailStage + EnterError）
Pending --> Cancelled: 引擎非 Running（Error/Stopped）时协调层读取
Running --> Cancelled: 批次失败触发 Error 后，队列剩余批次
Failed --> [*]
Completed --> [*]
Cancelled --> [*]
```
