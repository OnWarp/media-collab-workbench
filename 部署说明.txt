自媒体协作工作台 —— 部署说明
================================

一、环境要求
  - 安装 Node.js 16 及以上版本（推荐 18+）
    下载：https://nodejs.org （选 LTS 版本）
  - 验证：终端执行  node -v  能看到版本号即可

二、启动方式（任选其一）
  方式 A（最简单）：
    1. 把整个 media-collab-workbench 文件夹拷到目标机器
    2. 双击 start.bat（Windows）或在文件夹内执行 ./start.sh（macOS/Linux）
    3. 看到“已启动”提示后，浏览器打开 http://localhost:3000
  方式 B（通用）：
    终端进入该文件夹，执行：
      node server.js
    或：
      npm start

  注意：本项目纯 Node.js 内置模块，无需 npm install 安装任何依赖。

三、访问地址
  - 本机：      http://localhost:3000
  - 同局域网手机/其他电脑：把 localhost 换成运行电脑的局域网 IP
                  例：http://192.168.1.9:3000
                  （Windows 用 ipconfig，macOS/Linux 用 ifconfig 查 IP）
  - 更换端口：启动时指定环境变量，例如
      PORT=8080 node server.js   （然后访问 http://localhost:8080）

四、默认账号（首次启动自动创建）
  管理员： admin    / admin123
  成员：   xiaoming / member123
  ⚠ 安全提醒：上线前请在「成员管理」里修改默认密码，或让成员自行注册。

五、数据说明
  - 所有数据存于 data/db.json（首次启动自动生成）
  - 上传的图片/视频存于 public/uploads/（首次启动自动生成，请勿删除）
  - 备份时只需复制 data/ 与 public/uploads/ 两个目录
  - 如需完全清空重置：删除 data/ 与 public/uploads/ 后重启即可

六、后台常驻（让服务一直开着）
  Linux / macOS：
    nohup node server.js > server.log 2>&1 &
  或安装进程守护（推荐）：
    npm install -g pm2
    pm2 start server.js --name media-workbench

七、目录结构
  media-collab-workbench/
  ├── server.js          # 后端服务（零依赖，开箱即跑）
  ├── package.json
  ├── public/            # 前端页面（无需构建）
  │   ├── index.html
  │   ├── app.js
  │   └── styles.css
  ├── start.sh           # macOS/Linux 一键启动
  ├── start.bat          # Windows 一键启动
  └── .gitignore

八、功能速览
  - 公告看板 / 选题接单 / 我的工作台
  - 管理员审核（看文案+视频）、审核页内直接结算
  - 视频流量（抖音/快手/小红书三平台）
  - 消息提醒（红点、已读1小时自动清理、消息回收站）
  - 数据统计、回收站、成员管理
