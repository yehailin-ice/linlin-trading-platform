# 淋淋的实盘 Docker 完整部署指南

本文档用于把网站部署到当前电脑、另一台电脑或个人服务器，并完整迁移数据库、程序、脚本和 Docker 配置。

当前项目绝对路径：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
```

当前数据库绝对路径：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/data/linlin-trading.sqlite
```

当前数据库备份目录绝对路径：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/data/backups
```

## 1. 项目文件说明

项目根目录：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
```

必须保留的程序文件：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/index.html
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/app.js
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/styles.css
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/server.py
```

Docker 配置文件：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/Dockerfile
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/docker-compose.yml
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/.dockerignore
```

数据文件：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/data/linlin-trading.sqlite
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/data/backups/
```

文档文件：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/README-迁移说明.md
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/DOCKER部署指南.md
```

## 2. 数据库说明

主数据库：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/data/linlin-trading.sqlite
```

数据库表：

```text
account_snapshots
trades
positions
history_points
metadata
```

含义：

```text
account_snapshots：完整账户快照
trades：买入、卖出、费用、盈亏流水
positions：当前持仓
history_points：账户历史曲线
metadata：数据库版本、保存时间、校验值
```

以后迁移网站时，最关键的是复制整个 `data` 目录。

## 3. 当前电脑直接运行

进入项目目录：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
```

直接运行：

```bash
python3 server.py
```

打开：

```text
http://127.0.0.1:5174/
```

## 4. 当前电脑 Docker 部署

进入项目目录：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
```

构建并启动：

```bash
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

打开：

```text
http://127.0.0.1:5174/
```

## 5. docker-compose.yml 完整配置

当前配置文件绝对路径：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/docker-compose.yml
```

完整内容：

```yaml
services:
  linlin-trading:
    build: .
    container_name: linlin-trading
    ports:
      - "5174:5174"
    environment:
      HOST: 0.0.0.0
      PORT: 5174
      LINLIN_DATA_DIR: /app/data
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

关键点：

```text
5174:5174
```

表示宿主机 `5174` 端口映射到容器 `5174` 端口。

```text
./data:/app/data
```

表示把当前项目下的数据库目录挂载到容器内。容器重建不会丢数据。

## 6. Dockerfile 完整配置

当前配置文件绝对路径：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/Dockerfile
```

完整内容：

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY index.html app.js styles.css server.py ./

ENV HOST=0.0.0.0
ENV PORT=5174
ENV LINLIN_DATA_DIR=/app/data

EXPOSE 5174

CMD ["python", "server.py"]
```

## 7. 打包迁移到其他机器

当前已经可以把完整项目打包到桌面。

桌面目标路径示例：

```text
/Users/yehailin/Desktop/linlin-trading-docker-package.zip
```

如果手动打包，在当前电脑执行：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
zip -r /Users/yehailin/Desktop/linlin-trading-docker-package.zip \
  index.html \
  app.js \
  styles.css \
  server.py \
  Dockerfile \
  docker-compose.yml \
  .dockerignore \
  README-迁移说明.md \
  DOCKER部署指南.md \
  data
```

## 8. 在新机器部署

假设新机器项目目录是：

```text
/Users/你的用户名/linlin-trading
```

或 Linux 服务器目录是：

```text
/opt/linlin-trading
```

### macOS 新机器

复制压缩包到桌面后执行：

```bash
mkdir -p /Users/你的用户名/linlin-trading
cd /Users/你的用户名/linlin-trading
unzip /Users/你的用户名/Desktop/linlin-trading-docker-package.zip
docker compose up -d --build
```

打开：

```text
http://127.0.0.1:5174/
```

### Linux 服务器

复制压缩包到服务器：

```bash
scp /Users/yehailin/Desktop/linlin-trading-docker-package.zip user@服务器IP:/opt/
```

登录服务器：

```bash
ssh user@服务器IP
```

解压并启动：

```bash
sudo mkdir -p /opt/linlin-trading
sudo chown -R $USER:$USER /opt/linlin-trading
cd /opt/linlin-trading
unzip /opt/linlin-trading-docker-package.zip
docker compose up -d --build
```

访问：

```text
http://服务器IP:5174/
```

## 9. 新机器安装 Docker

### macOS

下载并安装 Docker Desktop：

```text
https://www.docker.com/products/docker-desktop/
```

安装后打开 Docker Desktop，确认 Docker 已启动。

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin unzip
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

执行 `usermod` 后，退出服务器重新登录。

确认安装：

```bash
docker --version
docker compose version
```

## 10. 数据备份

网页备份：

```text
点击页面里的“备份数据库”
```

备份文件会生成到：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/data/backups
```

手动备份：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
cp data/linlin-trading.sqlite data/backups/manual-$(date +%Y%m%d-%H%M%S).sqlite
```

## 11. 数据恢复

网页恢复：

```text
点击页面里的“恢复最近备份”
```

手动恢复：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
docker compose down
cp data/backups/你的备份文件.sqlite data/linlin-trading.sqlite
docker compose up -d
```

## 12. 升级代码但保留数据

升级前先备份：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
cp data/linlin-trading.sqlite data/backups/before-upgrade-$(date +%Y%m%d-%H%M%S).sqlite
```

替换程序文件：

```text
index.html
app.js
styles.css
server.py
Dockerfile
docker-compose.yml
```

不要删除：

```text
data/linlin-trading.sqlite
data/backups/
```

重启：

```bash
docker compose up -d --build
```

## 13. 修改端口

如果 `5174` 被占用，修改：

```text
/Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/docker-compose.yml
```

把：

```yaml
ports:
  - "5174:5174"
```

改成：

```yaml
ports:
  - "8080:5174"
```

重启：

```bash
docker compose up -d --build
```

访问：

```text
http://127.0.0.1:8080/
```

或服务器：

```text
http://服务器IP:8080/
```

## 14. 防火墙建议

如果部署在个人服务器，不建议直接暴露给公网所有人。

推荐方式：

```text
只在本机或家庭局域网访问
使用 Tailscale、ZeroTier、WireGuard 等 VPN
服务器防火墙只允许自己的 IP 访问端口
```

Ubuntu 防火墙示例：

```bash
sudo ufw allow from 你的公网IP to any port 5174
sudo ufw enable
sudo ufw status
```

如果只是本机使用，不需要开放公网端口。

## 15. 常用维护命令

进入项目：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
```

启动：

```bash
docker compose up -d
```

停止：

```bash
docker compose down
```

重启：

```bash
docker compose restart
```

重新构建：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f
```

查看容器：

```bash
docker compose ps
```

进入容器：

```bash
docker exec -it linlin-trading bash
```

查看数据库：

```bash
ls -lh /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v/data/linlin-trading.sqlite
```

## 16. 部署后检查清单

执行：

```bash
cd /Users/yehailin/Documents/Codex/2026-05-22/9-71-easyup-opencl-https-v
docker compose ps
docker compose logs --tail=50
ls -lh data/linlin-trading.sqlite
```

网页确认：

```text
能打开网站
能看到当前持仓
能看到历史成交
页面显示“已写入本机数据库”
点击“备份数据库”后 data/backups 出现 .sqlite 文件
```

完成这些检查后，说明部署和数据迁移成功。
