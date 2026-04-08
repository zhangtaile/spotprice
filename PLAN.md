# Cloudflare Worker SpotPrice 项目开发计划 (详细版)

本项目利用 Cloudflare 的免费额度，每 12 小时自动抓取 DRAMeXchange 的内存和闪存现货价格，并存储在 D1 数据库中，最后通过一个 Dashboard 进行可视化展示。

---

## 1. 技术栈
- **运行环境**: Cloudflare Workers (TypeScript)
- **数据库**: Cloudflare D1 (SQLite)
- **定时任务**: Cloudflare Cron Triggers
- **前端展示**: HTML5 + Vanilla CSS + ECharts (由 Worker 路由直接返回)
- **部署工具**: Wrangler CLI + GitHub Actions / Cloudflare Git Integration

---

## 2. 目标抓取项 (Data Points)
根据 `dramexchange.com` 的数据结构，抓取以下 4 个核心项目：
1. **DDR5 16Gb (2Gx8) 4800/5600** (DRAM 表格)
2. **DDR4 16Gb (2Gx8) 3200** (DRAM 表格)
3. **DDR4 8Gb (1Gx8) 3200** (DRAM 表格)
4. **512Gb TLC** (Wafer Spot Price 表格)

---

## 3. 开发阶段规划

### 阶段 1：基础设施与数据库 (已完成 ✅)
- [x] **初始化项目**: 使用 `npm init cloudflare@latest` 创建 TypeScript Worker 环境。
- [x] **创建 D1 数据库**: 执行 `npx wrangler d1 create spotprice-db` 获取 `database_id`。
- [x] **绑定配置**: 在 `wrangler.jsonc` 中添加 `d1_databases` 绑定，使代码中可通过 `env.DB` 访问。
- [x] **设计 Schema**: 编写 `schema.sql`，定义 `spot_prices` 表：
    - `item_name`: 产品名称。
    - `session_average`: 平均价 (REAL)。
    - `session_high/low`: 最高/最低价 (REAL)。
    - `ref_time`: 网页原始更新时间 (TEXT)，作为数据新鲜度的唯一标识。
- [x] **部署 Schema**: 执行 `npx wrangler d1 execute spotprice-db --remote --file=schema.sql`。
- [x] **版本控制**: 将配置和 SQL 提交至 GitHub。

### 阶段 2：编写抓取逻辑 (Scraper)
- **目标**: 能够可靠地从静态或动态 HTML 中提取 4 个目标项的数据。
- **细节步骤**:
    - [ ] **网页探测**: 编写 `fetch(https://www.dramexchange.com/)` 并打印源码，确认数据是否在初始 HTML 中（若是 JS 动态加载，则需寻找内部 API）。
    - [ ] **解析策略**:
        - 使用 **正则表达式** (Regex) 定位包含目标字符串的 `<tr>` 或 `<td>` 标签。
        - 提取 `Session Average`, `Session High`, `Session Low` 和 `Session Change`。
    - [ ] **时间处理**: 提取网页顶部的 `Last Update: XXX` 字符串，并将其标准化（如 `2026-04-03 18:10`）。
    - [ ] **接口验证**: 
        - 在 `src/index.ts` 中增加 `GET /test-scrape` 路由。
        - 访问该 URL，返回抓取到的 4 个 JSON 对象。
    - [ ] **错误处理**: 若抓取失败（如网站改版），记录错误日志并返回友好提示。

### 阶段 3：数据持久化与定时任务 (Cron)
- **目标**: 实现每 6 小时自动比对并存储，确保不存入重复数据。
- **细节步骤**:
    - [ ] **核心逻辑编写**:
        - 调用阶段 2 的 Scraper 获取数据。
        - 遍历抓取结果，对每一条数据执行：
          `INSERT OR IGNORE INTO spot_prices (item_name, ..., ref_time) VALUES (...)`。
        - 利用 D1 的唯一索引 `idx_item_time` 自动过滤已存在的记录。
    - [ ] **触发器配置**:
        - 修改 `wrangler.jsonc`，添加 `[[triggers]] crons = ["0 */6 * * *"]`。
    - [ ] **Scheduled 事件处理**:
        - 在 `src/index.ts` 中实现 `export default { scheduled(event, env, ctx) { ... } }`。
    - [ ] **本地测试**: 使用 `npx wrangler dev --remote --dry-run` 模拟 Cron 触发，观察控制台输出。
    - [ ] **部署**: `git push` 触发 Cloudflare 自动部署。

### 阶段 4：后端 API 开发
- **目标**: 为前端 Dashboard 提供清洗后的历史数据。
- **细节步骤**:
    - [ ] **路由设计**:
        - `GET /api/latest`: 获取每个产品的最新一条报价。
        - `GET /api/history?item=NAME&days=30`: 获取指定产品过去 30 天的价格曲线。
    - [ ] **SQL 查询**:
        - 使用 `ORDER BY ref_time DESC` 进行排序。
        - 格式化日期字符串，方便前端直接用于横坐标。
    - [ ] **CORS 设置**: 虽然同域，但仍配置基础 Header 确保兼容性。

### 阶段 5：Dashboard 可视化界面
- **目标**: 一个既好看又实用的单页应用。
- **细节步骤**:
    - [ ] **HTML 模板**:
        - 在 Worker 内部定义一个 `renderDashboard()` 函数，返回字符串形式的 HTML。
        - 路由：`GET /dashboard` 或根路径 `GET /`。
    - [ ] **UI 设计**:
        - 引入现代化的 CSS 框架（如微型框架 Skeleton 或纯 CSS 变量）。
        - 采用暗色模式 (Dark Mode) 适配 DRAMeXchange 原生风格。
    - [ ] **交互逻辑**:
        - 页面加载时请求 `/api/latest` 渲染当前价格卡片。
        - 异步请求 `/api/history`。
    - [ ] **图表集成**:
        - 引入 `ECharts` CDN。
        - 配置 4 条折线图，展示 DDR5/DDR4/NAND 的价格走势。
    - [ ] **最终发布**: 确认生产环境 URL 访问正常。

---

## 4. 关键里程碑
1. **M1 (Scraper OK)**: `/test-scrape` 能稳定返回当前价格。
2. **M2 (Automation OK)**: 数据库中开始累积每 6 小时一条的记录。
3. **M3 (Visualization OK)**: 能够在手机/电脑上通过 URL 看到漂亮的价格曲线。
