// 管理员题库导入页逻辑
// 仅 admin 角色可写题库（RLS 在 supabase/03_admin_rls.sql 控制）。
// 不暴露 service_role key；前端用 anon key，但只有 admin 用户能通过 RLS 写入。

(function () {
  "use strict";

  var sb = window.supabaseClient;
  var gate = document.getElementById("admin-gate");
  var panel = document.getElementById("admin-panel");
  var logEl = document.getElementById("log");

  function log(msg) {
    if (logEl) logEl.textContent += msg + "\n";
    console.log("[admin]", msg);
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  if (!sb) {
    gate.innerHTML = '<p style="color:#b42318">前端未连接到 Supabase：请确认 <code>js/supabase-config.js</code> 已配置 url 与 publishableKey。</p>';
    return;
  }

  // ---------- 权限校验 ----------
  async function checkAdmin(session) {
    if (!session || !session.user) {
      gate.style.display = "block";
      panel.style.display = "none";
      gate.innerHTML = '<p>请先点击右上角「登录 / 注册」登录后再使用本页。</p>';
      return;
    }
    var { data: p, error } = await sb
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (error || !p || p.role !== "admin") {
      gate.style.display = "block";
      panel.style.display = "none";
      gate.innerHTML =
        '<p style="color:#b42318">无权访问：当前账号不是管理员。</p>' +
        '<p>若你是仓库所有者，请在 Supabase SQL Editor 执行：</p>' +
        '<pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;">' +
        "update public.profiles set role = 'admin'\n" +
        "where id = (select id from auth.users where email = '" +
        escapeHtml(session.user.email || "你的邮箱") + "');</pre>";
      return;
    }
    gate.style.display = "none";
    panel.style.display = "block";
    log("管理员已登录：" + (session.user.email || ""));
    await buildMapping();
  }

  // ---------- 知识点映射 UI ----------
  async function buildMapping() {
    var wrap = document.getElementById("topic-mapping");
    if (!wrap) return;
    var { data: topics } = await sb.from("topics").select("id,name").order("sort_order");
    var { data: kps } = await sb.from("knowledge_points").select("id,name,topic_id").order("sort_order");
    if (!topics) { wrap.innerHTML = "<p>读取专题失败（确认已执行 01 建表 SQL）。</p>"; return; }
    var html = "";
    topics.forEach(function (t) {
      var opts = '<option value="">（不绑定知识点）</option>';
      (kps || []).forEach(function (k) {
        if (k.topic_id === t.id) opts += '<option value="' + k.id + '">' + escapeHtml(k.name) + "</option>";
      });
      html +=
        '<div style="display:flex;gap:12px;align-items:center;margin:8px 0;">' +
        '<span style="width:160px;color:var(--muted);font-size:13px;">' + escapeHtml(t.name) + "</span>" +
        '<select class="kp-select" data-topic="' + t.id + '" data-topicname="' + escapeHtml(t.name) + '" style="flex:1;padding:8px;border:1px solid var(--line);border-radius:8px;">' + opts + "</select>" +
        "</div>";
    });
    wrap.innerHTML = html;
  }

  function getMapping() {
    var map = {};
    document.querySelectorAll("#topic-mapping .kp-select").forEach(function (sel) {
      map[sel.dataset.topicname] = sel.value || null; // 专题名 -> knowledge_point_id
    });
    return map;
  }

  // ---------- 写入单题 ----------
  async function resolveTopicId(topicName) {
    var { data, error } = await sb.from("topics").select("id").eq("name", topicName).single();
    if (error || !data) throw new Error("找不到专题「" + topicName + "」（请确认名称与数据库一致）");
    return data.id;
  }

  async function insertOne(topicId, knowledgeId, q, status) {
    var { data: qr, error: qe } = await sb.from("questions").insert({
      topic_id: topicId,
      knowledge_point_id: knowledgeId,
      stem: q.stem,
      question_type: q.type === "multi" ? "multiple" : "single",
      explanation: q.explain || "",
      difficulty: q.difficulty || 2,
      status: status || "published"
    }).select("id").single();
    if (qe) throw new Error("题目写入失败：" + (qe.message || ""));
    var qid = qr.id;

    var opts = (q.options || []).map(function (c, i) {
      return { question_id: qid, content: c, sort_order: i };
    });
    var { data: ods, error: oe } = await sb.from("question_options").insert(opts).select("id, sort_order");
    if (oe) throw new Error("选项写入失败：" + (oe.message || ""));

    var ansIdx = Array.isArray(q.answer) ? q.answer : [q.answer];
    var correct = (ods || []).filter(function (o) { return ansIdx.indexOf(o.sort_order) >= 0; })
      .map(function (o) { return o.id; });
    var { error: ae } = await sb.from("question_answers").insert({
      question_id: qid, correct_option_ids: correct
    });
    if (ae) throw new Error("答案写入失败：" + (ae.message || ""));
    return qid;
  }

  // ---------- 导入：现有静态题库 ----------
  async function importQuizData() {
    if (!window.QUIZ_DATA) { alert("未找到 js/quiz-data.js 的题库数据"); return; }
    var map = getMapping();
    var topicList = window.TOPIC_LIST || [];
    var total = 0, ok = 0, fail = 0;
    log("开始导入现有静态题库…");
    for (var i = 0; i < topicList.length; i++) {
      var t = topicList[i];
      var questions = window.QUIZ_DATA[t.id];
      if (!questions || !questions.length) continue;
      var topicId, kId = map[t.name] || null;
      try { topicId = await resolveTopicId(t.name); }
      catch (e) { log("跳过「" + t.name + "」：" + e.message); continue; }
      for (var j = 0; j < questions.length; j++) {
        total++;
        try {
          await insertOne(topicId, kId, questions[j], "published");
          ok++;
        } catch (e) {
          fail++;
          log("✗ " + t.name + " 第" + (j + 1) + "题：" + e.message);
        }
      }
      log("「" + t.name + "」完成，已导入 " + questions.length + " 题");
    }
    log("导入结束：共 " + total + " 题，成功 " + ok + "，失败 " + fail);
    alert("导入结束：成功 " + ok + " / 失败 " + fail);
  }

  // ---------- 导入：粘贴 JSON ----------
  async function importJson() {
    var raw = document.getElementById("json-input").value.trim();
    if (!raw) { alert("请先粘贴 JSON"); return; }
    var payload;
    try { payload = JSON.parse(raw); }
    catch (e) { alert("JSON 解析失败：" + e.message); return; }

    var topicName = payload.topic, knowledgeName = payload.knowledge;
    var status = payload.status || "published";
    var questions = payload.questions || [];
    if (!topicName || !questions.length) { alert("JSON 需含 topic 与 questions 字段"); return; }

    var topicId, knowledgeId = null;
    try {
      topicId = await resolveTopicId(topicName);
      if (knowledgeName) {
        var { data: k } = await sb.from("knowledge_points").select("id")
          .eq("name", knowledgeName).eq("topic_id", topicId).single();
        if (k) knowledgeId = k.id;
      }
    } catch (e) { alert(e.message); return; }

    log("开始导入「" + topicName + "」" + questions.length + " 题…");
    var ok = 0, fail = 0;
    for (var i = 0; i < questions.length; i++) {
      try { await insertOne(topicId, knowledgeId, questions[i], status); ok++; }
      catch (e) { fail++; log("✗ 第" + (i + 1) + "题：" + e.message); }
    }
    log("导入结束：成功 " + ok + " / 失败 " + fail);
    alert("导入结束：成功 " + ok + " / 失败 " + fail);
  }

  // ---------- 事件绑定 ----------
  document.addEventListener("DOMContentLoaded", function () {
    var btn1 = document.getElementById("import-quizdata");
    var btn2 = document.getElementById("import-json");
    var btn3 = document.getElementById("load-sample");
    if (btn1) btn1.addEventListener("click", importQuizData);
    if (btn2) btn2.addEventListener("click", importJson);
    if (btn3) btn3.addEventListener("click", function () {
      document.getElementById("json-input").value = JSON.stringify({
        topic: "政治理论", knowledge: "党史与时事政治", status: "published",
        questions: [
          { type: "choice", stem: "示例题干？", options: ["A", "B", "C", "D"], answer: 1, explain: "示例解析", difficulty: 2 }
        ]
      }, null, 2);
    });

    sb.auth.getSession().then(function (r) { checkAdmin(r.data.session); });
    sb.auth.onAuthStateChange(function (_e, session) { checkAdmin(session); });
  });
})();
