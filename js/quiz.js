// 刷题系统 · 共享核心逻辑
// 功能：专题选择、顺序/随机刷题、错题本、答题统计、进度保存
// 数据源：配置了 Supabase 且数据库有已发布题目时，从数据库读取（答案留在服务端判题）；
//        否则回退到本地 QUIZ_DATA 静态题库。

(function () {
  "use strict";

  var client = window.supabaseClient || null;

  // 视图状态
  var state = {
    view: "home",
    topicId: null,
    questions: [],
    current: 0,
    answers: {},       // {qid: [optionId, ...]}  optionId 静态为下标数字，DB 为 uuid
    showAnswer: {},
    mode: "sequential",
    startTime: 0,
    wrongIds: [],
    fromWrong: false,
    attemptId: null,   // DB 模式下的练习记录 id
    dbTopicId: null,   // DB 模式下的专题 uuid
    _dbWrong: null     // DB 模式的错题列表（覆盖静态错题本）
  };

  var STORAGE_KEY = "gwy_quiz_progress_v1";
  var WRONG_KEY = "gwy_quiz_wrong_v1";
  var HISTORY_KEY = "gwy_quiz_history_v1";

  function addHistoryRecord(record) {
    try {
      var h = localStorage.getItem(HISTORY_KEY);
      h = h ? JSON.parse(h) : [];
      h.push(record);
      if (h.length > 2000) h = h.slice(-2000);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    } catch (e) {}
  }
  if (!window.QuizHistory) {
    window.QuizHistory = { add: addHistoryRecord };
  }

  // ---------- 数据持久化（静态模式用） ----------
  function loadStorage(key, def) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : def; } catch (e) { return def; }
  }
  function saveStorage(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function getWrongBook() { return loadStorage(WRONG_KEY, {}); }
  function addToWrongBook(topicId, qid) {
    var wb = getWrongBook();
    if (!wb[topicId]) wb[topicId] = [];
    if (wb[topicId].indexOf(qid) < 0) wb[topicId].push(qid);
    saveStorage(WRONG_KEY, wb);
  }
  function removeFromWrongBook(topicId, qid) {
    var wb = getWrongBook();
    if (wb[topicId]) {
      wb[topicId] = wb[topicId].filter(function (x) { return x !== qid; });
      saveStorage(WRONG_KEY, wb);
    }
  }
  function getWrongCount() {
    var wb = getWrongBook(); var total = 0;
    Object.keys(wb).forEach(function (k) { total += wb[k].length; });
    return total;
  }
  function getTopicProgress(topicId) {
    return loadStorage(STORAGE_KEY + "_" + topicId, { total: 0, correct: 0, wrong: 0 });
  }
  function updateTopicProgress(topicId, correct, wrong) {
    var p = getTopicProgress(topicId);
    p.total += correct + wrong; p.correct += correct; p.wrong += wrong;
    saveStorage(STORAGE_KEY + "_" + topicId, p);
  }
  function getAllProgress() {
    var topics = (window.TOPIC_LIST || []); var result = {};
    topics.forEach(function (t) { result[t.id] = getTopicProgress(t.id); });
    return result;
  }

  // ---------- 静态题库 ----------
  function getStaticQuestions(topicId) {
    if (typeof QUIZ_DATA !== "undefined" && QUIZ_DATA[topicId]) return QUIZ_DATA[topicId];
    return [];
  }
  function getTopicName(topicId) {
    var list = window.TOPIC_LIST || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === topicId) return list[i].name;
    }
    return topicId;
  }
  // 把静态题目规范成统一结构 {options:[{id,text}], ...}
  function normalizeStatic(list) {
    return (list || []).map(function (q) {
      return {
        id: q.id,
        _source: "static",
        type: q.type === "multi" ? "multi" : "choice",
        stem: q.stem,
        options: (q.options || []).map(function (opt, i) { return { id: i, text: opt }; }),
        answer: q.answer,
        explain: q.explain,
        images: []
      };
    });
  }

  // ---------- Supabase 读取 ----------
  var _topicMap = null;
  async function topicDbId(topicId) {
    if (!client) return null;
    if (!_topicMap) {
      var names = (window.TOPIC_LIST || []).map(function (t) { return t.name; });
      var res = await client.from("topics").select("id,name").in("name", names);
      _topicMap = {};
      (res.data || []).forEach(function (t) { _topicMap[t.name] = t.id; });
    }
    var st = (window.TOPIC_LIST || []).find(function (t) { return t.id === topicId; });
    return st ? _topicMap[st.name] || null : null;
  }

  async function signedImageUrl(path) {
    if (!client || !path) return null;
    try {
      var r = await client.storage.from("question-images").createSignedUrl(path, 3600);
      return r.data && r.data.signedUrl ? r.data.signedUrl : null;
    } catch (e) { return null; }
  }

  async function mapDbQuestions(rows, topicId) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i];
      var opts = (q.question_options || [])
        .slice().sort(function (a, b) { return a.sort_order - b.sort_order; })
        .map(function (o) { return { id: o.id, text: o.content }; });
      var imgs = (q.question_images || [])
        .slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
      var imgUrls = await Promise.all(imgs.map(async function (im) {
        return { url: await signedImageUrl(im.storage_path), alt: im.alt_text || "" };
      }));
      out.push({
        id: q.id,
        _source: "db",
        type: q.question_type === "multiple" ? "multi" : "choice",
        stem: q.stem,
        options: opts,
        explain: q.explanation || "",
        images: imgUrls.filter(function (x) { return x.url; }),
        answer: null,
        correctIds: null
      });
    }
    return out;
  }

  async function loadDbQuestions(topicId, idsOnly) {
    if (!client) return [];
    var tid = await topicDbId(topicId);
    if (!tid) return [];
    state.dbTopicId = tid;
    var query = client.from("questions")
      .select("id, stem, question_type, explanation, question_options(id, content, sort_order), question_images(storage_path, alt_text, sort_order)")
      .eq("topic_id", tid).eq("status", "published");
    if (idsOnly && idsOnly.length) query = query.in("id", idsOnly);
    query = query.order("created_at", { ascending: true });
    var res = await query;
    if (res.error || !res.data || !res.data.length) return [];
    return await mapDbQuestions(res.data, topicId);
  }

  async function loadDbWrong(topicId) {
    if (!client) return [];
    var sess = await client.auth.getSession();
    if (!sess.data.session) return []; // 未登录无服务端错题本
    var uid = sess.data.session.user.id;
    var tid = await topicDbId(topicId);
    if (!tid) return [];
    var wres = await client.from("attempt_answers")
      .select("question_id")
      .eq("is_correct", false)
      .in("attempt_id", client.from("attempts").select("id").eq("user_id", uid));
    if (wres.error) return [];
    var ids = [];
    (wres.data || []).forEach(function (w) { if (ids.indexOf(w.question_id) < 0) ids.push(w.question_id); });
    if (!ids.length) return [];
    return await loadDbQuestions(topicId, ids);
  }

  async function ensureAttempt(topicId) {
    if (!client) return;
    var sess = await client.auth.getSession();
    if (!sess.data.session) return; // 匿名练习不记录
    var uid = sess.data.session.user.id;
    var tid = state.dbTopicId || await topicDbId(topicId);
    if (!tid) return;
    var res = await client.from("attempts")
      .insert({ user_id: uid, topic_id: tid })
      .select("id").single();
    if (res.data) state.attemptId = res.data.id;
  }

  async function judgeDb(q, selectedIds) {
    var sess = await client.auth.getSession();
    var uid = (sess.data.session) ? sess.data.session.user.id : null;
    var res = await client.rpc("judge_answer", {
      p_question_id: q.id,
      p_selected: selectedIds,
      p_user_id: uid,
      p_attempt_id: state.attemptId || null
    });
    if (res.error) {
      console.error("judge_error", res.error);
      return { is_correct: false, correct_ids: [] };
    }
    return { is_correct: !!res.data.is_correct, correct_ids: res.data.correct_ids || [] };
  }

  // 统一取题：DB 优先，空/失败回退静态
  async function loadQuestions(topicId, fromWrong) {
    if (client) {
      try {
        var db = fromWrong ? await loadDbWrong(topicId) : await loadDbQuestions(topicId);
        if (db && db.length) return db;
      } catch (e) { console.warn("DB load failed, fallback to static", e); }
    }
    return normalizeStatic(getStaticQuestions(topicId));
  }

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function letterOf(q, id) {
    for (var i = 0; i < q.options.length; i++) {
      if (String(q.options[i].id) === String(id)) return String.fromCharCode(65 + i);
    }
    return "?";
  }
  function correctLetters(q) {
    if (q._correctLetters) return q._correctLetters;
    if (q._source === "db" && q.correctIds) {
      return q.correctIds.map(function (id) { return letterOf(q, id); }).join(", ");
    }
    var ans = Array.isArray(q.answer) ? q.answer : [q.answer];
    return ans.map(function (i) { return String.fromCharCode(65 + i); }).join(", ");
  }
  // 静态题本地判题（下标比较）；DB 题用服务端结果（见 submitAnswer）
  function isCorrectStatic(q, selectedIds) {
    var ans = selectedIds.slice().sort();
    var key = (Array.isArray(q.answer) ? q.answer : [q.answer]).slice().sort();
    return ans.length === key.length && ans.every(function (v, i) { return v === key[i]; });
  }
  function imagesHtml(q) {
    if (!q.images || !q.images.length) return "";
    var inner = q.images.map(function (im) {
      return '<img class="q-img" src="' + escapeHtml(im.url || "") + '" alt="' + escapeHtml(im.alt || "") + '">';
    }).join("");
    return '<div class="q-images">' + inner + "</div>";
  }

  // ---------- 渲染：首页 ----------
  function renderHome() {
    var list = window.TOPIC_LIST || [];
    var totalWrong = getWrongCount();

    var html =
      '<div class="quiz-home">' +
      '<div class="quiz-header">' +
      '<a class="home-link" href="../index.html">← 返回首页</a>' +
      '<h1>行测刷题 · 海量练习</h1>' +
      '<p>选择专题开始刷题 · 错题自动收藏 · 支持顺序/随机模式</p>' +
      '<div class="quiz-stats">' +
      '<div class="stat-card"><div class="stat-num">' + totalWrong + '</div><div class="stat-label">错题本</div></div>' +
      '<div class="stat-card"><div class="stat-num">' + list.length + '</div><div class="stat-label">个专题</div></div>' +
      '<div class="stat-card"><div class="stat-num">' + getTotalAnswered() + '</div><div class="stat-label">已答题数</div></div>' +
      '</div>' +
      '<div style="margin-top:14px;"><a href="records.html" style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#e0584b);color:#fff;padding:8px 22px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;">📊 刷题记录 & 智能组卷</a></div>' +
      '</div>' +
      '<div class="quiz-grid">';

    list.forEach(function (t) {
      var qs = getStaticQuestions(t.id);
      var wCount = getWrongBook()[t.id] ? getWrongBook()[t.id].length : 0;
      var prog = getTopicProgress(t.id);
      var total = prog.correct + prog.wrong;
      var rate = total > 0 ? Math.round(prog.correct / total * 100) : 0;

      html +=
        '<div class="quiz-card" data-topic="' + t.id + '">' +
        '<div class="q-icon">' + t.icon + '</div>' +
        '<div class="q-info">' +
        '<h3>' + escapeHtml(t.name) + '</h3>' +
        '<p class="q-desc">' + escapeHtml(t.desc) + '</p>' +
        '<div class="q-meta">' +
        '<span>📝 ' + qs.length + '题</span>' +
        '<span class="rate">✅ 正确率 ' + rate + '%</span>' +
        (wCount > 0 ? '<span class="wrong-badge">📕 ' + wCount + '错题</span>' : '') +
        '</div>' +
        '</div>' +
        '<div class="q-actions">' +
        '<button class="btn primary q-btn-start" data-mode="sequential">顺序练习</button>' +
        '<button class="btn ghost q-btn-start" data-mode="random">随机练习</button>' +
        (wCount > 0 ? '<button class="btn ghost q-btn-wrong" data-topic="' + t.id + '">错题本</button>' : '') +
        '</div>' +
        '</div>';
    });

    html += '</div></div>';
    document.getElementById("app").innerHTML = html;

    document.querySelectorAll(".q-btn-start").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.topicId = btn.closest(".quiz-card").dataset.topic;
        state.mode = btn.dataset.mode;
        startQuiz(false);
      });
    });
    document.querySelectorAll(".q-btn-wrong").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.topicId = btn.dataset.topic;
        startQuiz(true);
      });
    });
  }

  function getTotalAnswered() {
    var list = window.TOPIC_LIST || []; var total = 0;
    list.forEach(function (t) { var p = getTopicProgress(t.id); total += p.correct + p.wrong; });
    return total;
  }

  // ---------- 取题 + 开始 ----------
  async function startQuiz(fromWrong) {
    state.fromWrong = !!fromWrong;
    state.answers = {}; state.showAnswer = {}; state.wrongIds = [];
    state.current = 0; state.startTime = Date.now();
    state.attemptId = null; state.dbTopicId = null; state._dbWrong = null;

    var questions = await loadQuestions(state.topicId, fromWrong);
    if (!questions || questions.length === 0) {
      alert(fromWrong ? "该专题暂无错题" : "该专题暂无题目");
      if (fromWrong) renderWrongbook(); else renderHome();
      return;
    }

    state.questions = questions;
    if (questions[0] && questions[0]._source === "db") {
      await ensureAttempt(state.topicId);
    }
    if (fromWrong && questions[0] && questions[0]._source === "db") {
      state._dbWrong = questions;
    }

    if (state.mode === "random" && !fromWrong) {
      state.questions = shuffle(state.questions);
    }

    renderQuiz();
  }

  function renderQuiz() {
    var q = state.questions[state.current];
    if (!q) return;
    var isMulti = q.type === "multi";
    var selected = state.answers[q.id] || [];
    var showExplain = !!state.showAnswer[q.id];
    var total = state.questions.length;
    var progress = Math.round((state.current + 1) / total * 100);

    var html =
      '<div class="quiz-play">' +
      '<div class="quiz-top-bar">' +
      '<a class="home-link" href="#" id="quiz-exit">← 退出</a>' +
      '<div class="quiz-progress">' +
      '<div class="qp-bar"><div class="qp-fill" style="width:' + progress + '%"></div></div>' +
      '<span class="qp-text">第 ' + (state.current + 1) + ' / ' + total + ' 题</span>' +
      '</div>' +
      '<div class="quiz-timer" id="quiz-timer">00:00</div>' +
      '</div>' +

      '<div class="quiz-question">' +
      '<div class="q-num">' + (state.current + 1) + '</div>' +
      '<div class="q-stem">' + escapeHtml(q.stem) + (isMulti ? ' <span class="q-tag">多选</span>' : '') + '</div>' +
      imagesHtml(q) +
      '<div class="q-options">';

    q.options.forEach(function (opt, oi) {
      var checked = selected.indexOf(opt.id) >= 0;
      html +=
        '<label class="q-opt' + (checked ? " selected" : "") + '">' +
        '<span class="q-opt-label">' + String.fromCharCode(65 + oi) + '</span>' +
        '<span class="q-opt-text">' + escapeHtml(opt.text) + '</span>' +
        '<input type="' + (isMulti ? "checkbox" : "radio") + '" name="q_' + q.id + '" value="' + escapeHtml(opt.id) + '"' + (checked ? " checked" : "") + '>' +
        '</label>';
    });

    html += '</div>';

    if (showExplain) {
      var correct = (q._source === "db") ? !!q._serverCorrect : isCorrectStatic(q, selected);
      html +=
        '<div class="q-explain ' + (correct ? "ok" : "err") + '">' +
        '<div class="q-exp-head">' + (correct ? '✅ 回答正确' : '❌ 回答错误') + '</div>' +
        '<div class="q-exp-body"><strong>解析：</strong>' + escapeHtml(q.explain || "") + '</div>' +
        '<div class="q-exp-body"><strong>正确答案：</strong>' + correctLetters(q) + '</div>' +
        '</div>';
    }

    html += '</div>' +

      '<div class="quiz-actions">' +
      '<button class="btn ghost" id="prev-btn"' + (state.current === 0 ? " disabled" : "") + '>← 上一题</button>' +
      (!showExplain
        ? '<button class="btn primary" id="submit-btn">提交作答</button>'
        : '<button class="btn primary" id="next-btn">' + (state.current === total - 1 ? "查看结果 →" : "下一题 →") + '</button>') +
      '<button class="btn ghost" id="skip-btn">跳过</button>' +
      '</div>' +
      '</div>';

    document.getElementById("app").innerHTML = html;

    document.querySelectorAll(".q-opt input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var raw = inp.value;
        var val = /^[0-9]+$/.test(raw) ? parseInt(raw, 10) : raw; // 静态题为数字下标，DB 题为 uuid
        if (inp.type === "radio") {
          state.answers[q.id] = [val];
        } else {
          var arr = state.answers[q.id] || [];
          if (inp.checked) { if (arr.indexOf(val) < 0) arr = arr.concat(val); }
          else arr = arr.filter(function (x) { return x !== val; });
          state.answers[q.id] = arr;
        }
        document.querySelectorAll(".q-opt").forEach(function (o) { o.classList.remove("selected"); });
        document.querySelectorAll(".q-opt input:checked").forEach(function (c) {
          c.closest(".q-opt").classList.add("selected");
        });
      });
    });

    document.getElementById("prev-btn").addEventListener("click", function () {
      if (state.current > 0) { state.current--; renderQuiz(); }
    });
    document.getElementById("submit-btn").addEventListener("click", function () { submitAnswer(q); });
    document.getElementById("next-btn").addEventListener("click", function () {
      if (state.current < state.questions.length - 1) { state.current++; renderQuiz(); }
      else { showResult(); }
    });
    document.getElementById("skip-btn").addEventListener("click", function () {
      if (state.current < state.questions.length - 1) { state.current++; renderQuiz(); }
      else { showResult(); }
    });
    document.getElementById("quiz-exit").addEventListener("click", function (e) {
      e.preventDefault();
      if (confirm("确定退出当前练习？已作答内容将不保存为错题。")) renderHome();
    });

    startTimer();
  }

  async function submitAnswer(q) {
    var selected = state.answers[q.id] || [];
    if (selected.length === 0) { alert("请先选择一个选项"); return; }

    var correct;
    if (q._source === "db") {
      var r = await judgeDb(q, selected);
      correct = r.is_correct;
      q.correctIds = r.correct_ids;
      q._serverCorrect = r.is_correct;
      q._correctLetters = q.correctIds.map(function (id) { return letterOf(q, id); }).join(", ");
    } else {
      correct = isCorrectStatic(q, selected);
      q._serverCorrect = correct;
      q._correctLetters = correctLetters(q);
    }
    state.showAnswer[q.id] = true;

    if (window.QuizHistory) {
      window.QuizHistory.add({
        topicId: state.topicId,
        qid: q.id,
        timestamp: Date.now(),
        correct: correct,
        timeSpent: Math.round((Date.now() - state.startTime) / 1000)
      });
    }

    if (!correct && !state.fromWrong) {
      addToWrongBook(state.topicId, q.id);
      state.wrongIds.push(q.id);
    }
    if (correct && state.fromWrong) {
      removeFromWrongBook(state.topicId, q.id);
    }

    renderQuiz();
  }

  // ---------- 渲染：结果页 ----------
  function showResult() {
    var total = state.questions.length;
    var correctCount = 0, wrongCount = 0, skippedCount = 0;
    var questionResults = [];

    state.questions.forEach(function (q) {
      var sel = state.answers[q.id] || [];
      var answered = sel.length > 0;
      var ok = answered && ((q._source === "db") ? !!q._serverCorrect : isCorrectStatic(q, sel));
      if (!answered) skippedCount++;
      else if (ok) correctCount++;
      else wrongCount++;

      questionResults.push({ q: q, selected: sel, correct: ok, answered: answered });
    });

    updateTopicProgress(state.topicId, correctCount, wrongCount);

    if (state.fromWrong) {
      questionResults.forEach(function (r) {
        if (r.correct) removeFromWrongBook(state.topicId, r.q.id);
      });
    }

    var elapsed = Math.round((Date.now() - state.startTime) / 1000);
    var accuracy = total > 0 ? Math.round(correctCount / total * 100) : 0;

    var html =
      '<div class="quiz-result">' +
      '<div class="result-summary">' +
      '<h2>' + getTopicName(state.topicId) + ' · 练习结果</h2>' +
      '<div class="result-ring">' +
      '<svg viewBox="0 0 120 120">' +
      '<circle class="ring-bg" cx="60" cy="60" r="52"/>' +
      '<circle class="ring-fg" cx="60" cy="60" r="52" stroke-dasharray="' + (2 * Math.PI * 52) + '" stroke-dashoffset="' + (2 * Math.PI * 52 * (1 - accuracy / 100)) + '"/>' +
      '<text class="ring-text" x="60" y="55" text-anchor="middle">' + accuracy + '%</text>' +
      '<text class="ring-label" x="60" y="75" text-anchor="middle">正确率</text>' +
      '</svg>' +
      '</div>' +
      '<div class="result-stats">' +
      '<div class="rs-item total"><b>' + total + '</b><span>总题数</span></div>' +
      '<div class="rs-item ok"><b>' + correctCount + '</b><span>答对</span></div>' +
      '<div class="rs-item err"><b>' + wrongCount + '</b><span>答错</span></div>' +
      (skippedCount > 0 ? '<div class="rs-item skip"><b>' + skippedCount + '</b><span>跳过</span></div>' : '') +
      '<div class="rs-item time"><b>' + formatTime(elapsed) + '</b><span>用时</span></div>' +
      '</div>' +
      '</div>' +

      '<div class="result-detail">' +
      '<h3>题目详情</h3>' +
      '<div class="result-list">';

    questionResults.forEach(function (r, i) {
      var icon = r.correct ? '<span class="ri ok">✓</span>' : (r.answered ? '<span class="ri err">✗</span>' : '<span class="ri skip">○</span>');
      var yourAns = r.answered
        ? r.selected.map(function (id) { return letterOf(r.q, id); }).join(", ")
        : "未作答";
      html +=
        '<div class="result-item" data-idx="' + i + '">' +
        '<div class="ri-row">' + icon +
        '<span class="ri-num">第' + (i + 1) + '题</span>' +
        '<span class="ri-stem">' + escapeHtml(r.q.stem.substring(0, 60)) + (r.q.stem.length > 60 ? '…' : '') + '</span>' +
        '<span class="ri-toggle">展开 ▾</span>' +
        '</div>' +
        '<div class="ri-detail" style="display:none">' +
        imagesHtml(r.q) +
        '<div class="rd-stem">' + escapeHtml(r.q.stem) + '</div>' +
        '<div class="rd-answer">你的答案：' + yourAns + ' | 正确答案：' + correctLetters(r.q) + '</div>' +
        '<div class="rd-explain"><strong>解析：</strong>' + escapeHtml(r.q.explain || "") + '</div>' +
        '</div>' +
        '</div>';
    });

    html += '</div></div>' +
      '<div class="result-actions">' +
      '<button class="btn primary" id="retry-btn">再练一轮</button>' +
      '<button class="btn ghost" id="wrongbook-btn">查看错题本</button>' +
      '<button class="btn ghost" id="records-btn">刷题记录</button>' +
      '<button class="btn ghost" id="back-home">返回首页</button>' +
      '</div>' +
      '</div>';

    document.getElementById("app").innerHTML = html;

    document.querySelectorAll(".ri-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var detail = row.parentElement.querySelector(".ri-detail");
        var toggle = row.querySelector(".ri-toggle");
        if (detail.style.display === "none") { detail.style.display = "block"; toggle.textContent = "收起 ▴"; }
        else { detail.style.display = "none"; toggle.textContent = "展开 ▾"; }
      });
    });

    document.getElementById("retry-btn").addEventListener("click", function () {
      if (state.fromWrong) renderWrongbook(); else startQuiz(false);
    });
    document.getElementById("wrongbook-btn").addEventListener("click", function () {
      state.view = "wrongbook"; renderWrongbook();
    });
    document.getElementById("back-home").addEventListener("click", renderHome);
    document.getElementById("records-btn").addEventListener("click", function () {
      window.location.href = "records.html";
    });
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ---------- 渲染：错题本 ----------
  function renderWrongbook() {
    if (state._dbWrong) { renderWrongbookList(state._dbWrong, true); return; }

    var wb = getWrongBook();
    var topics = window.TOPIC_LIST || [];
    var html =
      '<div class="quiz-wrongbook">' +
      '<div class="wb-header">' +
      '<a class="home-link" href="#" id="wb-back">← 返回首页</a>' +
      '<h1>📕 错题本</h1>' +
      '<p>共收藏 ' + getWrongCount() + ' 道错题</p>' +
      '</div>';

    topics.forEach(function (t) {
      var ids = wb[t.id] || [];
      if (ids.length === 0) return;
      var qs = normalizeStatic(getStaticQuestions(t.id)).filter(function (q) { return ids.indexOf(q.id) >= 0; });
      html += wrongbookSection(t, qs, false);
    });

    html += '</div>';
    document.getElementById("app").innerHTML = html;
    bindWrongbook(false);
  }

  function wrongbookSection(t, qs, isDb) {
    if (!qs.length) return "";
    var html =
      '<div class="wb-section">' +
      '<h2>' + escapeHtml(t.icon + ' ' + t.name) + ' <span class="wb-count">' + qs.length + '题</span></h2>' +
      '<div class="wb-list">';
    qs.forEach(function (q) {
      html +=
        '<div class="wb-item" data-qid="' + escapeHtml(q.id) + '">' +
        imagesHtml(q) +
        '<div class="wb-stem">' + escapeHtml(q.stem) + '</div>' +
        '<div class="wb-answer">正确答案：' + correctLetters(q) + '</div>' +
        '<div class="wb-explain"><strong>解析：</strong>' + escapeHtml(q.explain || "") + '</div>' +
        '<div class="wb-actions">' +
        '<button class="btn primary small wb-practice" data-qid="' + escapeHtml(q.id) + '">练习此题</button>' +
        (isDb ? '' : '<button class="btn ghost small wb-remove" data-qid="' + escapeHtml(q.id) + '">移除</button>') +
        '</div>' +
        '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function renderWrongbookList(qs, isDb) {
    var html =
      '<div class="quiz-wrongbook">' +
      '<div class="wb-header">' +
      '<a class="home-link" href="#" id="wb-back">← 返回首页</a>' +
      '<h1>📕 错题本</h1>' +
      '<p>服务端共 ' + qs.length + ' 道错题（已登录账号）</p>' +
      '</div>' +
      '<div class="wb-section"><h2>待巩固 <span class="wb-count">' + qs.length + '题</span></h2><div class="wb-list">';
    qs.forEach(function (q) {
      html +=
        '<div class="wb-item" data-qid="' + escapeHtml(q.id) + '">' +
        imagesHtml(q) +
        '<div class="wb-stem">' + escapeHtml(q.stem) + '</div>' +
        '<div class="wb-actions">' +
        '<button class="btn primary small wb-practice" data-qid="' + escapeHtml(q.id) + '">练习此题</button>' +
        '</div></div>';
    });
    html += '</div></div></div>';
    document.getElementById("app").innerHTML = html;

    document.getElementById("wb-back").addEventListener("click", function (e) { e.preventDefault(); renderHome(); });
    document.querySelectorAll(".wb-practice").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var q = qs.find(function (x) { return String(x.id) === String(btn.dataset.qid); });
        if (q) { state.questions = [q]; state.current = 0; state.fromWrong = true; renderQuiz(); }
      });
    });
  }

  function bindWrongbook(isDb) {
    document.getElementById("wb-back").addEventListener("click", function (e) { e.preventDefault(); renderHome(); });
    document.querySelectorAll(".wb-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        removeFromWrongBook(state.topicId, btn.dataset.qid);
        renderWrongbook();
      });
    });
    document.querySelectorAll(".wb-practice").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var qs = state._dbWrong || normalizeStatic(getStaticQuestions(state.topicId))
          .filter(function (q) { return (getWrongBook()[state.topicId] || []).indexOf(q.id) >= 0; });
        var q = qs.find(function (x) { return String(x.id) === String(btn.dataset.qid); });
        if (q) { state.questions = [q]; state.current = 0; state.fromWrong = true; renderQuiz(); }
      });
    });
  }

  // ---------- 计时器 ----------
  var timerInterval = null;
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    var startTime = Date.now();
    timerInterval = setInterval(function () {
      var el = document.getElementById("quiz-timer");
      if (el) el.textContent = formatTime(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  // ---------- 初始化 ----------
  document.addEventListener("DOMContentLoaded", function () {
    document.addEventListener("click", function (e) {
      if (e.target.classList.contains("home-link")) {
        e.preventDefault();
        stopTimer();
        renderHome();
      }
    });
    renderHome();
  });

  window.QuizApp = { renderHome: renderHome, renderWrongbook: renderWrongbook, getWrongCount: getWrongCount };
})();
