# Linlin Trading Platform

淋淋的 A 股本地交易记录与分析平台，用于记录实盘/模拟盘资金、买卖流水、持仓、账户曲线，并结合实时行情、盘面情绪和 AI 交易规则生成候选、复盘与日报。

![风险提醒：模型仍需优化，交易有风险，请不要盲目使用](docs/risk-warning.svg)

![网站效果图](docs/screenshot.png)

## 核心功能

- 本地账户管理：初始资金、现金、持仓、市值、仓位、收益率、账户曲线。
- 交易记录：买入、卖出、手续费、印花税、过户费、经手费、证管费、单笔盈亏。
- A 股交易时间控制：非交易时段不执行真实买卖记录，只保留分析结果。
- 实时行情刷新：持仓和候选股价格、涨跌幅、成交额、换手率等。
- 市场情绪：指数、涨跌家数、涨停/跌停、热门板块、成交额前排。
- AI 自动交易逻辑：先看持仓止损/止盈，再按 bafeite 候选池筛选买入机会。
- 候选池分析：主板过滤、价格过滤、题材、评分、触发条件、风险检查。
- 盘后分析：收盘后分析国内政策、海外市场、商品、板块和次日计划。
- K 线数据：支持日线、周线、月线、分钟级别兜底快照。
- 数据备份恢复：SQLite 本地数据库、自动备份、最近备份恢复。
- 迁移包导出：一键导出可迁移项目包，方便换电脑或服务器部署。
- Docker 部署：支持 `docker compose up -d --build` 部署，数据目录持久化。

## 数据来源与接口

平台后端在 `server.py` 中聚合多个公开行情源，并按可用性自动 fallback。

### 行情接口

| 数据类型 | 来源 | 用途 |
|---|---|---|
| 实时个股行情 | 智兔 API `ZHITU_TOKEN` 可选 | 优先实时行情源，未配置时自动跳过 |
| 实时个股行情 | 腾讯行情接口 | 个股价格、涨跌幅、成交额、换手、市值等 |
| 实时个股行情 | 东方财富 Push2 API | 个股行情、指数、板块、涨跌排行 |
| 实时个股行情 | 新浪行情接口 | 备用个股行情 |
| 实时个股行情 | 网易财经接口 | 备用个股行情 |
| 实时个股行情 | 同花顺 THSDK 可选 | 本地安装 `thsdk` 时作为备用行情 |
| K 线数据 | 东方财富 K 线接口 | 日线、周线、月线、分钟线 |
| K 线数据 | 新浪 K 线接口 | 东方财富不可用时备用 |
| 全球市场 | Yahoo Finance | 美股指数、商品等海外/商品参考 |
| 市场情绪 | 东方财富/腾讯/新浪组合 | 指数均值、涨跌家数、涨停、热门板块 |

### 本地 API

浏览器前端通过本地 HTTP API 与 `server.py` 通信：

| API | 方法 | 说明 |
|---|---|---|
| `/api/account` | `GET` | 读取当前账户快照 |
| `/api/account` | `POST` | 保存账户快照，可选择创建备份 |
| `/api/account` | `DELETE` | 清空当前账户数据 |
| `/api/storage` | `GET` | 查看 SQLite、备份目录、保存状态 |
| `/api/quotes?codes=000063,600498` | `GET` | 获取个股实时行情 |
| `/api/kline?code=000063&period=daily` | `GET` | 获取 K 线数据 |
| `/api/mood` | `GET` | 获取市场情绪 |
| `/api/market` | `GET` | 获取指数、热门概念、行业、成交额前排 |
| `/api/after-close` | `GET` | 生成盘后分析 |
| `/api/backup` | `POST` | 创建数据库备份 |
| `/api/import-backup` | `POST` | 导入备份 |
| `/api/restore-latest` | `POST` | 恢复最近一次备份 |
| `/api/download-db` | `GET` | 下载当前 SQLite 数据库 |
| `/api/export-portable` | `GET` | 导出迁移包 |

## 数据存储

默认数据目录：

```text
data/
```

主要数据库：

```text
data/linlin-trading.sqlite
```

数据库表：

| 表 | 说明 |
|---|---|
| `account_snapshots` | 完整账户快照 |
| `trades` | 买入、卖出、费用、盈亏流水 |
| `positions` | 当前持仓 |
| `history_points` | 账户历史曲线 |
| `metadata` | 数据库版本、最近保存时间、校验值 |

自动备份目录：

```text
data/backups/
```

迁移或升级时不要删除 `data/` 目录。

## 配套技能

本项目可搭配 Codex 技能使用，用于盘中选股、持仓复盘、盘后分析和行情数据获取。

| 技能 | 作用 |
|---|---|
| `bafeite` | 盘中 A 股市场分析，筛选 3-5 只主板候选股，结合题材、资金、MACD、筹码和公告风险 |
| `yhl-hole` | 当前持仓复盘，输出加仓、持有、止盈、减仓、卖出计划 |
| `a-share-after-close-outlook` | 收盘后生成次日市场环境、消息面、热门板块和主板观察股 |
| `a-stock-data` | A 股数据工具包，覆盖行情、研报、公告、资金、新闻、财务、龙虎榜等数据源 |
| `stock-analysis` | 股票/加密资产分析、组合管理、提醒和评分 |
| `fetch-a-share-news` | 获取 A 股和国内市场新闻摘要 |

这些技能不是运行网站的必需依赖；网站本身可以独立运行。技能用于增强分析、复盘和候选生成。

## 本地运行

环境要求：

- Python 3.10+
- 可访问公开行情接口的网络环境

启动：

```bash
python3 server.py
```

浏览器打开：

```text
http://127.0.0.1:5174/
```

可选环境变量：

```bash
HOST=127.0.0.1
PORT=5174
LINLIN_DATA_DIR=./data
ZHITU_TOKEN=你的智兔Token
```

示例：

```bash
HOST=0.0.0.0 PORT=5174 LINLIN_DATA_DIR=./data python3 server.py
```

## Docker 部署

详细步骤见 [DOCKER部署指南.md](DOCKER部署指南.md)。

快速启动：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

访问：

```text
http://127.0.0.1:5174/
```

`docker-compose.yml` 会将本地 `./data` 挂载到容器 `/app/data`，容器重建不会丢失数据库。

## 备份、恢复与迁移

推荐迁移方式：

1. 在原机器页面点击 `导出迁移包`。
2. 在新机器解压迁移包。
3. 进入项目目录。
4. 运行：

```bash
python3 server.py
```

5. 打开：

```text
http://127.0.0.1:5174/
```

手动迁移时，保留整个 `data/` 目录即可。更多说明见 [README-迁移说明.md](README-迁移说明.md)。

## 项目结构

```text
.
├── index.html              # 页面结构
├── app.js                  # 前端账户、交易、行情、AI 逻辑
├── styles.css              # 页面样式
├── server.py               # 本地 HTTP 服务、SQLite、行情接口聚合
├── Dockerfile              # Docker 镜像配置
├── docker-compose.yml      # Docker Compose 部署配置
├── DOCKER部署指南.md        # Docker 完整部署说明
├── README-迁移说明.md       # 数据迁移说明
└── docs/
    └── screenshot.png      # 效果图
```

## 风险说明

- ![风险提醒：模型仍需优化，交易有风险，请不要盲目使用](docs/risk-warning.svg)
- 交易有风险，入市需谨慎。本项目不构成投资建议，也不承诺任何收益。
- 模型、评分、候选股、AI 自动交易逻辑仍需持续优化，请不要盲目使用，不要直接依据模型输出进行实盘交易。
- 公开行情接口可能存在延迟、限流、字段变化或不可用，系统会自动 fallback，但仍需人工确认关键数据。
- 自动交易逻辑只记录本地账户数据，不会连接券商真实下单接口；如用户手动参考其结果进行交易，需自行承担全部风险。
- 历史收益、候选评分、板块热度、技术指标和新闻解读都不代表未来表现。
