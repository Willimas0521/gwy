// 刷题系统 · 共享核心逻辑
// 功能：专题选择、顺序/随机刷题、错题本、答题统计、进度保存

(function () {
  "use strict";

  // 视图状态
  var state = {
    view: "home",       // home | topic | quiz | result | wrongbook
    topicId: null,
    questions: [],
    current: 0,
    answers: {},       // {qid: selectedIndexOrArray}
    showAnswer: {},    // {qid: true} 已查看解析
    mode: "sequential", // sequential | random
    startTime: 0,
    wrongIds: [],      // 本次答错的题目ID
    fromWrong: false   // 是否来自错题本模式
  };

  var STORAGE_KEY = "gwy_quiz_progress_v1";
  var WRONG_KEY = "gwy_quiz_wrong_v1";

  // ---------- 数据持久化 ----------
  function loadStorage(key, def) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : def; } catch (e) { return def; }
  }
  function saveStorage(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function getWrongBook() {
    return loadStorage(WRONG_KEY, {}); // {topicId: [qid, ...]}
  }
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
    var wb = getWrongBook();
    var total = 0;
    Object.keys(wb).forEach(function (k) { total += wb[k].length; });
    return total;
  }

  function getTopicProgress(topicId) {
    var p = loadStorage(STORAGE_KEY + "_" + topicId, { total: 0, correct: 0, wrong: 0 });
    return p;
  }
  function updateTopicProgress(topicId, correct, wrong) {
    var p = getTopicProgress(topicId);
    p.total += correct + wrong;
    p.correct += correct;
    p.wrong += wrong;
    saveStorage(STORAGE_KEY + "_" + topicId, p);
  }
  function getAllProgress() {
    var topics = (window.TOPIC_LIST || []);
    var result = {};
    topics.forEach(function (t) { result[t.id] = getTopicProgress(t.id); });
    return result;
  }

  // ---------- 题库加载 ----------
  function getQuestions(topicId) {
    if (typeof QUIZ_DATA !== "undefined" && QUIZ_DATA[topicId]) {
      return QUIZ_DATA[topicId];
    }
    return [];
  }
  function getTopicName(topicId) {
    var list = window.TOPIC_LIST || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === topicId) return list[i].name;
    }
    return topicId;
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
  function isCorrect(q, selected) {
    var ans = Array.isArray(selected) ? selected.slice().sort() : [selected].slice().sort();
    var key = Array.isArray(q.answer) ? q.answer.slice().sort() : [q.answer].slice().sort();
    return ans.length === key.length && ans.every(function (v, i) { return v === key[i]; });
  }

  // ---------- 渲染：首页 ----------
  function renderHome() {
    var list = window.TOPIC_LIST || [];
    var wb = getWrongBook();
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
      '</div>' +
      '<div class="quiz-grid">';

    list.forEach(function (t) {
      var qs = getQuestions(t.id);
      var wCount = wb[t.id] ? wb[t.id].length : 0;
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

    // 绑定事件
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
    var list = window.TOPIC_LIST || [];
    var total = 0;
    list.forEach(function (t) {
      var p = getTopicProgress(t.id);
      total += p.correct + p.wrong;
    });
    return total;
  }

  // ---------- 渲染：答题页 ----------
  function startQuiz(fromWrong) {
    var allQ = getQuestions(state.topicId);
    if (allQ.length === 0) {
      alert("该专题暂无题目");
      return;
    }

    state.fromWrong = !!fromWrong;
    state.answers = {};
    state.showAnswer = {};
    state.wrongIds = [];
    state.current = 0;
    state.startTime = Date.now();

    if (fromWrong) {
      var wb = getWrongBook();
      var wIds = wb[state.topicId] || [];
      state.questions = allQ.filter(function (q) { return wIds.indexOf(q.id) >= 0; });
      if (state.questions.length === 0) {
        alert("该专题暂无错题");
        return;
      }
    } else {
      if (state.mode === "random") {
        state.questions = shuffle(allQ);
      } else {
        state.questions = allQ.slice();
      }
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
      '<div class="q-options">';

    q.options.forEach(function (opt, oi) {
      var checked = selected.indexOf(oi) >= 0;
      html +=
        '<label class="q-opt' + (checked ? " selected" : "") + '">' +
        '<span class="q-opt-label">' + String.fromCharCode(65 + oi) + '</span>' +
        '<span class="q-opt-text">' + escapeHtml(opt) + '</span>' +
        '<input type="' + (isMulti ? "checkbox" : "radio") + '" name="q_' + q.id + '" value="' + oi + '"' + (checked ? " checked" : "") + '>' +
        '</label>';
    });

    html += '</div>';

    if (showExplain) {
      var correct = isCorrect(q, selected);
      html +=
        '<div class="q-explain ' + (correct ? "ok" : "err") + '">' +
        '<div class="q-exp-head">' + (correct ? '✅ 回答正确' : '❌ 回答错误') + '</div>' +
        '<div class="q-exp-body"><strong>解析：</strong>' + escapeHtml(q.explain || "") + '</div>' +
        '<div class="q-exp-body"><strong>正确答案：</strong>' + formatAnswer(q) + '</div>' +
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

    // 绑定选项
    document.querySelectorAll(".q-opt input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var val = parseInt(inp.value, 10);
        if (inp.type === "radio") {
          state.answers[q.id] = [val];
        } else {
          var arr = state.answers[q.id] || [];
          if (inp.checked) arr = arr.concat(val);
          else arr = arr.filter(function (x) { return x !== val; });
          state.answers[q.id] = arr;
        }
        // 更新样式
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
      if (confirm("确定退出当前练习？已作答内容将不保存为错题。")) {
        renderHome();
      }
    });

    // 启动计时器
    startTimer();
  }

  function formatAnswer(q) {
    if (Array.isArray(q.answer)) {
      return q.answer.map(function (i) { return String.fromCharCode(65 + i); }).join(", ");
    }
    return String.fromCharCode(65 + q.answer);
  }

  function submitAnswer(q) {
    var selected = state.answers[q.id] || [];
    if (selected.length === 0) {
      alert("请先选择一个选项");
      return;
    }
    var correct = isCorrect(q, selected);
    state.showAnswer[q.id] = true;

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
    var correctCount = 0;
    var wrongCount = 0;
    var skippedCount = 0;
    var questionResults = [];

    state.questions.forEach(function (q) {
      var sel = state.answers[q.id] || [];
      var answered = sel.length > 0;
      var ok = answered && isCorrect(q, sel);
      if (!answered) { skippedCount++; }
      else if (ok) { correctCount++; }
      else { wrongCount++; }

      questionResults.push({
        q: q,
        selected: sel,
        correct: ok,
        answered: answered
      });
    });

    // 更新统计
    updateTopicProgress(state.topicId, correctCount, wrongCount);

    // 清除本次错题（如果是错题模式且答对的）
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
      html +=
        '<div class="result-item" data-idx="' + i + '">' +
        '<div class="ri-row">' + icon +
        '<span class="ri-num">第' + (i + 1) + '题</span>' +
        '<span class="ri-stem">' + escapeHtml(r.q.stem.substring(0, 60)) + (r.q.stem.length > 60 ? '…' : '') + '</span>' +
        '<span class="ri-toggle">展开 ▾</span>' +
        '</div>' +
        '<div class="ri-detail" style="display:none">' +
        '<div class="rd-stem">' + escapeHtml(r.q.stem) + '</div>' +
        '<div class="rd-answer">你的答案：' + (r.answered ? r.selected.map(function (i) { return String.fromCharCode(65 + i); }).join(", ") : "未作答") + ' | 正确答案：' + formatAnswer(r.q) + '</div>' +
        '<div class="rd-explain"><strong>解析：</strong>' + escapeHtml(r.q.explain || "") + '</div>' +
        '</div>' +
        '</div>';
    });

    html += '</div></div>' +

      '<div class="result-actions">' +
      '<button class="btn primary" id="retry-btn">再练一轮</button>' +
      '<button class="btn ghost" id="wrongbook-btn">查看错题本</button>' +
      '<button class="btn ghost" id="back-home">返回首页</button>' +
      '</div>' +
      '</div>';

    document.getElementById("app").innerHTML = html;

    document.querySelectorAll(".ri-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var detail = row.parentElement.querySelector(".ri-detail");
        var toggle = row.querySelector(".ri-toggle");
        if (detail.style.display === "none") {
          detail.style.display = "block";
          toggle.textContent = "收起 ▴";
        } else {
          detail.style.display = "none";
          toggle.textContent = "展开 ▾";
        }
      });
    });

    document.getElementById("retry-btn").addEventListener("click", function () {
      if (state.fromWrong) { renderHome(); }
      else { startQuiz(false); }
    });
    document.getElementById("wrongbook-btn").addEventListener("click", function () {
      state.view = "wrongbook";
      renderWrongbook();
    });
    document.getElementById("back-home").addEventListener("click", renderHome);
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ---------- 渲染：错题本 ----------
  function renderWrongbook() {
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
      var qs = getQuestions(t.id);
      var wrongQs = qs.filter(function (q) { return ids.indexOf(q.id) >= 0; });

      html +=
        '<div class="wb-section">' +
        '<h2>' + escapeHtml(t.icon + ' ' + t.name) + ' <span class="wb-count">' + ids.length + '题</span></h2>' +
        '<div class="wb-list">';

      wrongQs.forEach(function (q) {
        html +=
          '<div class="wb-item">' +
          '<div class="wb-stem">' + escapeHtml(q.stem) + '</div>' +
          '<div class="wb-answer">正确答案：' + formatAnswer(q) + '</div>' +
          '<div class="wb-explain"><strong>解析：</strong>' + escapeHtml(q.explain || "") + '</div>' +
          '<div class="wb-actions">' +
          '<button class="btn primary small wb-practice" data-topic="' + t.id + '">练习此题</button>' +
          '<button class="btn ghost small wb-remove" data-topic="' + t.id + '" data-qid="' + q.id + '">移除</button>' +
          '</div>' +
          '</div>';
      });

      html += '</div></div>';
    });

    html += '</div>';
    document.getElementById("app").innerHTML = html;

    document.getElementById("wb-back").addEventListener("click", function (e) {
      e.preventDefault();
      renderHome();
    });
    document.querySelectorAll(".wb-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        removeFromWrongBook(btn.dataset.topic, btn.dataset.qid);
        renderWrongbook();
      });
    });
    document.querySelectorAll(".wb-practice").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.topicId = btn.dataset.topic;
        startQuiz(true);
      });
    });
  }

  // ---------- 计时器 ----------
  var timerInterval = null;
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    var startTime = Date.now();
    timerInterval = setInterval(function () {
      var elapsed = Math.round((Date.now() - startTime) / 1000);
      var el = document.getElementById("quiz-timer");
      if (el) el.textContent = formatTime(elapsed);
    }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  // ---------- 初始化 ----------
  document.addEventListener("DOMContentLoaded", function () {
    // 绑定全局导航
    document.addEventListener("click", function (e) {
      var target = e.target;
      if (target.classList.contains("home-link")) {
        e.preventDefault();
        stopTimer();
        renderHome();
      }
    });

    renderHome();
  });

  // 暴露给外部
  window.QuizApp = {
    renderHome: renderHome,
    renderWrongbook: renderWrongbook,
    getWrongCount: getWrongCount
  };
})();
