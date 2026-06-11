# 淋淋的实盘数据迁移说明

## 数据存放

主数据保存在 SQLite 数据库：

```text
data/linlin-trading.sqlite
```

数据库内包含：

- `account_snapshots`：完整账户快照
- `trades`：成交流水
- `positions`：当前持仓
- `history_points`：账户历史曲线
- `metadata`：版本、校验和、最近保存时间

自动备份保存在：

```text
data/backups/
```

## 换电脑恢复

推荐方式：

1. 在原电脑点击页面里的 `导出迁移包`。
2. 在新电脑解压迁移包。
3. 进入解压后的项目目录。
4. 运行：

```bash
python3 server.py
```

5. 打开：

```text
http://127.0.0.1:5174/
```

只要 `data/linlin-trading.sqlite` 存在，页面会自动读取原来的资金、成交、持仓和历史数据。

## Docker 运行

```bash
docker compose up -d --build
```

数据会通过 volume 挂载到当前目录：

```text
./data:/app/data
```

后续升级代码时，不要删除 `data/` 目录。

## 手动备份

页面点击 `备份数据库` 后，会在 `data/backups/` 生成一份 `.sqlite` 备份。

页面点击 `恢复最近备份` 后，会把最近的 `.sqlite` 备份恢复为当前数据库。
