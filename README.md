# 停车查询网站（GitHub + Cloudflare Pages）

这是把原来的微信小程序改造成的 **可直接托管到 GitHub、并部署到 Cloudflare Pages 的网站版本**。

## 这版做了什么

- 把小程序页面改成了浏览器可用的网站
- 保留了原有核心能力：
  - 单车查询
  - 批量粘贴提取车牌并批量查询
  - 本地缓存
  - 统计面板
  - 标记处理时间 / 已处理
  - 手动刷新 + 整点自动刷新
- 新增 Cloudflare Pages Functions：
  - `GET /api/health`
  - `POST /api/query`
  - `POST /api/batch-query`
- 支持两种运行模式：
  1. **Upstream 模式**：转发到你现有的停车查询后端
  2. **Demo 模式**：没有真实后端时，也能先把网站跑起来验证交互

## 重要说明

你原来的停车查询核心逻辑依赖 Python 脚本 `daily_query_v2`。**Cloudflare Pages / Workers 不能直接运行这个 Python 脚本**。

所以这版采用的是更适合 Cloudflare 的方案：

- 前端页面部署到 Cloudflare Pages
- Cloudflare Functions 提供 `/api/*`
- 如果你已经有一个可访问的 Python/Flask 后端，就由 Functions 转发过去
- 如果还没有，就先开 `DEMO_MODE=true`，网站照样能跑

也就是说：

- **网站本身可直接部署到 GitHub + Cloudflare**
- **真实停车查询能力** 仍需你提供一个 HTTP 可访问的查询源，或者后续把 Python 逻辑改写成 JS 并接入真实数据源

## 目录结构

```text
parking-query-webapp/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── .env.example
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── functions/
│   └── api/
│       ├── health.js
│       ├── query.js
│       └── batch-query.js
├── src/
│   └── parking.js
├── package.json
├── render.yaml
├── wrangler.toml
└── .dev.vars.example
```

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .dev.vars.example .dev.vars
```

### 3. 启动

```bash
npm run dev
```

本地地址通常是：

```text
http://127.0.0.1:8788
```

## 环境变量

### `PARKING_UPSTREAM_URL`

你已有的停车查询后端地址，例如：

```text
https://parking-api.example.com
```

Cloudflare Functions 会把：

- `POST /api/query`
- `POST /api/batch-query`
- `GET /api/health`

转发到这个上游地址的同名路径。

### Render 后端环境变量

`backend/app.py` 会直接请求猫酷停车接口，Render 至少需要这些环境变量：

- `PARKING_TOKEN`：必填，真实查询 token
- `PARKING_MALL_ID`：默认 `11192`
- `PARKING_PARK_ID`：默认 `625`
- `PARKING_INSECURE_SSL`：建议先设为 `true`
- `PARKING_OWNER_MAP_JSON`：可选，JSON 字符串格式的车牌-车主映射

例如：

```json
{"沪GAJ226":"xiner","沪A32Q90":"demo"}
```

### `PARKING_API_TOKEN`

若上游服务需要认证，可以配置 token。

### `PARKING_API_TOKEN_HEADER`

默认值：

```text
Authorization
```

如果你的上游不是 `Authorization`，比如 `X-API-Key`，就改成对应头名。

### `DEMO_MODE`

- `true`：没有上游时返回内置演示数据
- `false`：必须配置上游，否则接口报错

## 部署到 GitHub

1. 新建仓库
2. 把本项目全部 push 上去

```bash
git init
git add .
git commit -m "init parking query webapp"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

## 部署到 Cloudflare Pages

### 方案一：从 GitHub 直接连 Cloudflare（推荐）

1. 打开 Cloudflare Dashboard
2. 进入 **Workers & Pages**
3. 选择 **Create application** → **Pages** → **Connect to Git**
4. 选择你的 GitHub 仓库
5. 构建设置填写：

- Build command：留空
- Build output directory：`public`

6. 添加环境变量：

- `PARKING_UPSTREAM_URL`
- `PARKING_API_TOKEN`（可选）
- `PARKING_API_TOKEN_HEADER`（可选）
- `DEMO_MODE`

7. 点 Deploy

### 方案二：本地用 Wrangler 发布

```bash
npm run deploy
```

## 部署真实后端到 Render

仓库里已经准备好了 Render 所需文件：

- `backend/app.py`
- `backend/requirements.txt`
- `render.yaml`

推荐流程：

1. 把整个仓库 push 到 GitHub
2. 登录 Render
3. 选择 **New +** → **Blueprint**
4. 选择这个 GitHub 仓库
5. Render 会读取根目录下的 `render.yaml`
6. 在 Render 中补齐环境变量：
   - `PARKING_TOKEN`
   - `PARKING_OWNER_MAP_JSON`（可选）
7. 部署成功后，拿到类似：

```text
https://parking-query-api.onrender.com
```

8. 回到 Cloudflare Pages，把：

```text
PARKING_UPSTREAM_URL=https://parking-query-api.onrender.com
DEMO_MODE=false
```

保存后重新部署

如果 Render 首次冷启动较慢，Cloudflare 前几次查询可能会稍慢，这是正常现象。

## 上游接口约定

推荐与你原来的 Flask 服务保持一致：

### 查询单个车牌

```http
POST /api/query
Content-Type: application/json
```

请求：

```json
{
  "plate": "沪GAJ226"
}
```

响应：

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "plate": "沪GAJ226",
    "status": "success",
    "owner": "xiner",
    "entry": "2026-03-20 08:53",
    "need_pay": 30,
    "today_hours": 1.3,
    "total_hours": 24.5
  }
}
```

### 批量查询

```http
POST /api/batch-query
Content-Type: application/json
```

请求：

```json
{
  "plates": ["沪GAJ226", "沪A32Q90"]
}
```

## 这个网站保留的交互特性

- 浏览器 LocalStorage 持久化
- 数据版本控制，避免旧缓存结构污染
- 统计自动更新
- 自动提取车牌并去重
- 只刷新在场车辆，避免把“未在场”记录刷掉
- 整点自动刷新 timer 完整清理

## 后续你还可以怎么做

### 方案 A：继续保留 Python 核心逻辑

最省事：

- 把你现有 Flask 服务部署到 Railway / Render / ECS / VPS
- Cloudflare Pages Functions 负责转发
- 前端仍然由 Cloudflare 提供静态托管

### 方案 B：把查询核心逻辑改写成 JavaScript

如果未来真实查询逻辑只依赖 HTTP 抓取/解析，而不依赖 CPython 生态，可以继续改成纯 JS，再直接放进 Worker。

目前这份代码已经先把 **“网站层 + Cloudflare 部署层”** 搭好了。
