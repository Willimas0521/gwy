# 考公行测 · 解锁式刷题

学一个、练一个、过一关，才能解锁下一关的纯静态刷题网站。

## 特性
- **门控进度**：知识点按顺序排列，必须答对当前关习题才能解锁下一关（`locked → learning → practicing → completed`）
- **题型**：单选 / 多选，过关门槛可配（`passRule` 的 `needCorrect` 与 `minAccuracy`）
- **错题解析**：连错 2 次自动展示解析
- **进度持久化**：学习进度存浏览器 `localStorage`，刷新不丢
- **零依赖**：纯 HTML + CSS + JS，可直接托管到 GitHub Pages

## 本地预览
```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```
或直接用浏览器打开 `index.html`。

## 目录结构
```
index.html        入口页面（侧边栏进度 + 主区讲解/练习）
css/style.css     样式
js/data.js        题库（增删知识点/习题只改这里）
js/app.js         门控状态机 + 进度持久化
```

## 如何加题
编辑 `js/data.js` 里的 `COURSE.nodes`，每个节点结构：
```js
{
  id: "kp1",
  title: "知识点标题",
  lesson: "讲解内容（\n 换行）",
  passRule: { needCorrect: 1, minAccuracy: 1.0 }, // 需答对题数 / 最低正确率
  exercises: [
    {
      id: "q1",
      type: "choice",            // choice 单选 | multi 多选
      stem: "题干",
      options: ["A","B","C","D"],
      answer: 1,                 // 单选：正确项下标；多选：下标数组如 [0,1,2]
      explain: "解析"
    }
  ]
}
```

## 部署（GitHub Pages）
推到 `main` 分支后，在仓库 Settings → Pages 选择 `main` 分支 `/` 根目录即可。
