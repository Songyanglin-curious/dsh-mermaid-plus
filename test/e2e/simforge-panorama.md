# SimForge_当前系统架构与数据流转全景 · Mermaid 图集

从 `D:\SimForge_当前系统架构与数据流转全景.md` 逐块提炼的 9 张 Mermaid 图，供 `test/e2e/simforge.html` 用出货的 `client.js` 渲染验证。

> 本文件由 `node tools/extract-mermaid.mjs` 生成，重新提炼时整份覆盖，不要手改图源。

> 图块内容与原文逐字一致；每块下方标注原文标题与行号（1-based，行号指 ```mermaid 围栏所在行）。

---

## 1. 3.3 系统整体架构图（flowchart）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 112 行（小节标题在第 110 行）

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


## 2. 4.1.5 领域关系图（erDiagram）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 278 行（小节标题在第 276 行）

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


## 3. 4.3.3 运行时对象关系图（flowchart）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 441 行（小节标题在第 439 行）

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


## 4. 流程 D：一次完整的仿真批次（重点）（sequenceDiagram）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 544 行（小节标题在第 540 行）

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


## 5. 流程 E：上报报文与前端日志（sequenceDiagram）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 599 行（小节标题在第 597 行）

```mermaid
sequenceDiagram
    autonumber
    participant GX as GenerateDataExecutor
    participant DC as DataCenter
    participant RPT as ReportExecutor
    participant RQ as 内部队列 ReportWorkItem
    participant ASM as DeviceMessageAssembler
    participant OUT as SimulationOutput
    participant FE as 前端事件日志
    GX->>DC: CommitBatch 提交成功（已提交状态）
    RPT->>DC: ReadDeviceSnapshot（屏障内复制断面）
    RPT->>RPT: 冻结 ReportIdentity{DeviceId,Name,ProductKey,ModelId,Seq}
    RPT->>RQ: TryWrite(ReportWorkItem{身份, 断面, ReportTime=batchTime})
    Note over RPT: 上报任务到此视为"可靠接收"完成（批次 Completed 不等待组装）
    RQ->>ASM: ProcessLoop 逐条取出
    ASM->>ASM: Assemble：全量已初始化测点入 _p（未初始化不入，不伪造）；<br/>_id=Seq；_tm=ReportTime；测点 _tm=各自 GeneratedAt；<br/>Topic=persistent://public/default/sys|{modelId}|thing|event|property|post
    alt 组装成功
        ASM->>OUT: PublishOutputEvent(deviceId, snapshot, message)
        OUT->>FE: SSE data: {type:output, topic, message{_id,_m,_tm,_ver,_p,_prd,_dev,_mt}, points}
        FE->>FE: 一条"周期上报"日志行（可展开/复制 JSON）
    else 组装失败
        ASM-->>OUT: PublishEngineLog("output-error")（不伪装成功、不阻塞后续）
    end
```


## 6. 流程 G：设备停止、重启与异常停机（sequenceDiagram）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 646 行（小节标题在第 644 行）

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
        Note over FE,GX: 单设备停止
        FE->>API: POST /api/simulation/stop { deviceId }
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


## 7. 引擎状态（stateDiagram-v2）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 760 行（小节标题在第 758 行）

```mermaid
stateDiagram-v2
    [*] --> Running: 进程启动（新引擎）
    Running --> Error: 批次同步阶段失败 / 批次队列满<br/>（EnterError：冻结时钟+停止产批次+记录原因）
    Running --> Stopped: 进程退出（Dispose）
    Error --> Stopped: 进程退出（Dispose）
    Stopped --> [*]
```


## 8. 设备状态（stateDiagram-v2）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 771 行（小节标题在第 769 行）

```mermaid
stateDiagram-v2
    [*] --> Idle: 无运行实例（注册表无键）
    Idle --> Running: Start（创建实例，测点版本归零）
    Running --> Running: 再次 Start（已运行拒绝）
    Running --> Stopped: Stop（置 Stopped + 注销调度；实例保留）
    Stopped --> Running: 再次 Start（新实例，按新启用时刻对齐网格）
    Stopped --> [*]: 进程退出（内存释放）
    note right of Running: SimRunStatus.Error 枚举存在但<br/>无代码路径进入（引擎 Error 不级联设备）
```


## 9. 批次状态（stateDiagram-v2）
来源：`D:\SimForge_当前系统架构与数据流转全景.md` 第 784 行（小节标题在第 782 行）

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

