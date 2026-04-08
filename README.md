# SpotPrice Dashboard 📊

基于 Cloudflare Workers + D1 数据库实现的内存/闪存现货价格监控系统。

## 功能特点
- **自动化**: 每 12 小时自动抓取一次 DRAMeXchange 最新报价。
- **持久化**: 数据存储在 Cloudflare D1 数据库，支持历史查询。
- **可视化**: 内置现代化的 Dashboard，支持卡片展示及 ECharts 价格走势图。
- **零成本**: 完全运行在 Cloudflare 免费额度内。

## 监控项目
1. DDR5 16Gb (2Gx8) 4800/5600
2. DDR4 16Gb (2Gx8) 3200
3. DDR4 8Gb (1Gx8) 3200
4. 512Gb TLC (Wafer)

## 快速开始
1. 复制项目代码。
2. 运行 `npm install` 安装依赖。
3. 使用 `npx wrangler d1 create spotprice-db` 创建数据库并同步 `schema.sql`。
4. 如需本地调试抓取路由，在项目根目录创建 `.dev.vars` 并设置 `ENABLE_ADMIN_ROUTES=true`。
5. 运行 `npm run deploy` 部署至 Cloudflare。

## 架构设计
项目采用模块化设计，代码结构清晰：
- `src/index.ts`: Worker 入口及路由控制。
- `src/scraper.ts`: 核心爬虫逻辑，支持正则表达式动态匹配。
- `src/db.ts`: D1 数据库交互层。
- `src/dashboard.ts`: 前端可视化界面渲染。
- `src/types.ts`: 全局类型定义。

## 路由说明
- `/` : Dashboard 可视化界面
- `/api/dashboard` : **(推荐)** 一次性获取所有最新报价及历史走势 JSON
- `/api/latest` : 获取各产品最新报价
- `/debug-html`、`/test-scrape`、`/scrape-and-save` : 管理员工具路由（受 `ENABLE_ADMIN_ROUTES` 控制）
