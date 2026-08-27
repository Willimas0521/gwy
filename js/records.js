// 刷题记录与智能组卷系统
// 功能：答题记录、薄弱分析、智能组卷、专项突破

(function () {
  "use strict";

  var HISTORY_KEY = "gwy_quiz_history_v1";
  var TOPIC_LIST = (window.TOPIC_LIST || []);

  // ---------- 历史记录 ----------
  function loadHistory() {
    try {
      var r = localStorage.getItem(HISTORY_KEY);
      return r ? JSON.parse(r) : [];
    } catch (e) { return []; }
  }
  function saveHistory(h) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) {}
  }
  function addHistoryRecord(record) {
    var h = loadHistory();
    h.push(record);
    // 最多保留 2000 条
    if (h.length > 2000) h = h.slice(-2000);
    saveHistory(h);
  }
  // 暴露给 quiz.js 调用
  window.QuizHistory = { add: addHistoryRecord };

  // ---------- 统计分析 ----------
  function getTopicStats() {
    var history = loadHistory();
    var stats = {}; // {topicId: {total, correct, wrong, qids: {qid: {correct, wrong, attempts}}}}

    TOPIC_LIST.forEach(function (t) {
      stats[t.id] = { total: 0, correct: 0, wrong: 0, qids: {} };
    });

    history.forEach(function (r) {
      if (!stats[r.topicId]) return;
      stats[r.topicId].total++;
      if (r.correct) stats[r.topicId].correct++;
      else stats[r.topicId].wrong++;
      if (!stats[r.topicId].qids[r.qid]) {
        stats[r.topicId].qids[r.qid] = { correct: 0, wrong: 0, attempts: 0 };
      }
      stats[r.topicId].qids[r.qid].attempts++;
      if (r.correct) stats[r.topicId].qids[r.qid].correct++;
      else stats[r.topicId].qids[r.qid].wrong++;
    });

    return stats;
  }

  function getOverallStats() {
    var history = loadHistory();
    var total = history.length;
    var correct = history.filter(function (r) { return r.correct; }).length;
    var wrong = total - correct;
    var accuracy = total > 0 ? Math.round(correct / total * 100) : 0;

    var totalTime = 0;
    var topicTime = {};
    TOPIC_LIST.forEach(function (t) { topicTime[t.id] = 0; });

    history.forEach(function (r) {
      totalTime += r.timeSpent || 0;
      if (topicTime[r.topicId] !== undefined) {
        topicTime[r.topicId] += r.timeSpent || 0;
      }
    });

    return {
      total: total,
      correct: correct,
      wrong: wrong,
      accuracy: accuracy,
      totalTime: totalTime,
      topicTime: topicTime,
      sessions: getSessions(history).length
    };
  }

  function getSessions(history) {
    // 按日期分组
    var groups = {};
    history.forEach(function (r) {
      var day = new Date(r.timestamp).toISOString().split("T")[0];
      if (!groups[day]) groups[day] = [];
      groups[day].push(r);
    });
    return Object.keys(groups).map(function (day) {
      var items = groups[day];
      var correct = items.filter(function (r) { return r.correct; }).length;
      return {
        date: day,
        total: items.length,
        correct: correct,
        accuracy: items.length > 0 ? Math.round(correct / items.length * 100) : 0
      };
    }).sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  function getWeakQuestions(topicId, limit) {
    var stats = getTopicStats();
    if (!stats[topicId]) return [];
    var qids = stats[topicId].qids;
    var weak = [];
    Object.keys(qids).forEach(function (qid) {
      var q = qids[qid];
      if (q.wrong > 0) {
        weak.push({ qid: qid, wrong: q.wrong, correct: q.correct, attempts: q.attempts });
      }
    });
    weak.sort(function (a, b) { return b.wrong - a.wrong; });
    return limit ? weak.slice(0, limit) : weak;
  }

  // ---------- 智能组卷 ----------
  // 参数: { total, topicWeights: {topicId: weight}, fromWrongOnly: bool }
  function generatePaper(opts) {
    opts = opts || {};
    var total = opts.total || 10;
    var weights = opts.topicWeights || {};
    var wrongOnly = !!opts.fromWrongOnly;

    // 默认权重：根据错题数自动计算
    var stats = getTopicStats();
    if (Object.keys(weights).length === 0) {
      TOPIC_LIST.forEach(function (t) {
        var s = stats[t.id];
        if (s && s.total > 0) {
          // 错题越多权重越高，正确率越低权重越高
          var wrongWeight = s.wrong * 2;
          var diffWeight = s.total > 0 ? (1 - s.correct / s.total) * 3 : 1;
          weights[t.id] = Math.max(wrongWeight + diffWeight, 0.5);
        } else {
          weights[t.id] = 1;
        }
      });
    }

    // 计算每个专题的题目数量
    var totalWeight = 0;
    Object.keys(weights).forEach(function (k) { totalWeight += weights[k]; });

    var paper = [];
    var usedQids = {}; // 防止重复

    Object.keys(weights).forEach(function (tid) {
      var count = Math.round((weights[tid] / totalWeight) * total);
      var questions = getQuestionsForTopic(tid);

      if (wrongOnly) {
        var weakIds = getWeakQuestions(tid).map(function (w) { return w.qid; });
        questions = questions.filter(function (q) { return weakIds.indexOf(q.id) >= 0; });
      }

      // 随机选取
      questions = shuffleArr(questions);
      var picked = 0;
      for (var i = 0; i < questions.length && picked < count; i++) {
        if (!usedQids[questions[i].id]) {
          paper.push(questions[i]);
          usedQids[questions[i].id] = true;
          picked++;
        }
      }
    });

    // 如果不够，从其他专题补足
    if (paper.length < total) {
      var allQ = [];
      TOPIC_LIST.forEach(function (t) {
        allQ = allQ.concat(getQuestionsForTopic(t.id));
      });
      allQ = shuffleArr(allQ);
      for (var j = 0; j < allQ.length && paper.length < total; j++) {
        if (!usedQids[allQ[j].id]) {
          paper.push(allQ[j]);
          usedQids[allQ[j].id] = true;
        }
      }
    }

    return paper.slice(0, total);
  }

  function getQuestionsForTopic(topicId) {
    if (window.QUIZ_DATA && window.QUIZ_DATA[topicId]) {
      return window.QUIZ_DATA[topicId];
    }
    return [];
  }

  function shuffleArr(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ---------- 渲染记录页 ----------
  function renderRecords() {
    var overall = getOverallStats();
    var topicStats = getTopicStats();
    var sessions = getSessions(loadHistory());

    // 计算薄弱专题排名
    var weakTopics = [];
    TOPIC_LIST.forEach(function (t) {
      var s = topicStats[t.id];
      if (s && s.total > 0) {
        weakTopics.push({
          id: t.id,
          name: t.name,
          icon: t.icon,
          total: s.total,
          correct: s.correct,
          wrong: s.wrong,
          accuracy: Math.round(s.correct / s.total * 100),
          weakCount: s.wrong,
          timeSpent: overall.topicTime[t.id] || 0
        });
      }
    });
    weakTopics.sort(function (a, b) { return b.wrong - a.wrong; });

    var html =
      '<div class="records-page">' +
      '<div class="rec-header">' +
      '<a class="home-link" href="quiz.html">← 返回刷题</a>' +
      '<h1>📊 刷题记录</h1>' +
      '<p>智能分析薄弱环节 · 一键组卷专项突破</p>' +
      '</div>';

    // 总体统计卡片
    html +=
      '<div class="rec-overview">' +
      '<div class="rec-card">' +
      '<div class="rec-num">' + overall.total + '</div>' +
      '<div class="rec-label">总答题数</div>' +
      '</div>' +
      '<div class="rec-card ok">' +
      '<div class="rec-num">' + overall.correct + '</div>' +
      '<div class="rec-label">答对</div>' +
      '</div>' +
      '<div class="rec-card err">' +
      '<div class="rec-num">' + overall.wrong + '</div>' +
      '<div class="rec-label">答错</div>' +
      '</div>' +
      '<div class="rec-card">' +
      '<div class="rec-num">' + overall.accuracy + '%</div>' +
      '<div class="rec-label">正确率</div>' +
      '</div>' +
      '<div class="rec-card">' +
      '<div class="rec-num">' + formatTime(overall.totalTime) + '</div>' +
      '<div class="rec-label">总用时</div>' +
      '</div>' +
      '<div class="rec-card">' +
      '<div class="rec-num">' + overall.sessions + '</div>' +
      '<div class="rec-label">练习次数</div>' +
      '</div>' +
      '</div>';

    // 薄弱专题排行
    html +=
      '<div class="rec-section">' +
      '<div class="rec-section-head">' +
      '<h2>🔥 薄弱专题排行</h2>' +
      '<p>按错题数排序，错题越多越靠前</p>' +
      '</div>' +
      '<div class="weak-list">';

    if (weakTopics.length === 0) {
      html += '<div class="rec-empty">暂无练习记录，快去刷题吧！</div>';
    } else {
      weakTopics.forEach(function (t, i) {
        var barColor = t.accuracy >= 80 ? 'var(--ok)' : t.accuracy >= 60 ? '#e8a020' : 'var(--bad)';
        html +=
          '<div class="weak-item">' +
          '<div class="wi-rank">' + (i + 1) + '</div>' +
          '<div class="wi-info">' +
          '<div class="wi-title">' + t.icon + ' ' + t.name + '</div>' +
          '<div class="wi-bar-wrap">' +
          '<div class="wi-bar" style="width:' + t.accuracy + '%;background:' + barColor + '"></div>' +
          '</div>' +
          '<div class="wi-stats">' +
          '<span>正确率 ' + t.accuracy + '%</span>' +
          '<span>错题 ' + t.wrong + ' 道</span>' +
          '<span>用时 ' + formatTime(t.timeSpent) + '</span>' +
          '</div>' +
          '</div>' +
          '<div class="wi-action">' +
          '<button class="btn primary small wi-practice" data-topic="' + t.id + '">专项练习</button>' +
          '</div>' +
          '</div>';
      });
    }

    html += '</div></div>';

    // 智能组卷
    html +=
      '<div class="rec-section">' +
      '<div class="rec-section-head">' +
      '<h2>🎯 智能组卷</h2>' +
      '<p>根据你的薄弱环节智能加权出题，错题越多的专题占比越高</p>' +
      '</div>' +
      '<div class="paper-config">' +
      '<div class="pc-row">' +
      '<label>题目数量：</label>' +
      '<select id="pc-total">' +
      '<option value="5">5题（快速）</option>' +
      '<option value="10" selected>10题（标准）</option>' +
      '<option value="20">20题（模拟）</option>' +
      '<option value="30">30题（训练）</option>' +
      '</select>' +
      '</div>' +
      '<div class="pc-row">' +
      '<label>组卷方式：</label>' +
      '<select id="pc-mode">' +
      '<option value="balanced">智能均衡（侧重薄弱）</option>' +
      '<option value="weak-only">仅错题（专项突破）</option>' +
      '<option value="random">完全随机</option>' +
      '</select>' +
      '</div>' +
      '<div class="pc-row pc-weight-row">' +
      '<label>自定义权重：</label>' +
      '<div class="pc-weights" id="pc-weights">';

    // 权重滑块
    TOPIC_LIST.forEach(function (t) {
      var st = topicStats[t.id] || { total: 0, wrong: 0 };
      var autoWeight = st.total > 0 ? Math.max(st.wrong * 2 + (1 - st.correct / st.total) * 3, 0.5) : 1;
      html +=
        '<div class="pc-weight-item">' +
        '<span class="pw-label">' + t.icon + ' ' + t.name + '</span>' +
        '<input type="range" class="pw-slider" data-topic="' + t.id + '" min="0" max="5" step="0.1" value="' + autoWeight.toFixed(1) + '">' +
        '<span class="pw-value" id="pw-' + t.id + '">' + autoWeight.toFixed(1) + '</span>' +
        '</div>';
    });

    html +=
      '</div>' +
      '<div class="pc-tip">拖动滑块调整各专题权重，值越大在组卷中占比越高</div>' +
      '</div>' +
      '<div class="pc-actions">' +
      '<button class="btn primary" id="generate-paper">🎲 生成试卷</button>' +
      '<button class="btn ghost" id="reset-weights">重置权重</button>' +
      '</div>' +
      '</div>' +
      '<div id="paper-preview"></div>' +
      '</div>' +

    // 最近练习
    if (sessions.length > 0) {
      html +=
        '<div class="rec-section">' +
        '<div class="rec-section-head">' +
        '<h2>📅 最近练习</h2>' +
        '</div>' +
        '<div class="session-list">';
      sessions.slice(0, 10).forEach(function (s) {
        html +=
          '<div class="session-item">' +
          '<div class="s-date">' + s.date + '</div>' +
          '<div class="s-info">' + s.total + '题 · 正确率 ' + s.accuracy + '%</div>' +
          '</div>';
      });
      html += '</div></div>';
    }

    html += '</div>';
    document.getElementById("app").innerHTML = html;

    // 绑定事件
    document.querySelectorAll(".wi-practice").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.location.href = "quiz.html?topic=" + btn.dataset.topic;
      });
    });

    // 权重滑块
    document.querySelectorAll(".pw-slider").forEach(function (slider) {
      slider.addEventListener("input", function () {
        var tid = slider.dataset.topic;
        document.getElementById("pw-" + tid).textContent = parseFloat(slider.value).toFixed(1);
      });
    });

    document.getElementById("reset-weights").addEventListener("click", function () {
      TOPIC_LIST.forEach(function (t) {
        var st = topicStats[t.id] || { total: 0, wrong: 0 };
        var w = st.total > 0 ? Math.max(st.wrong * 2 + (1 - st.correct / st.total) * 3, 0.5) : 1;
        var slider = document.querySelector('.pw-slider[data-topic="' + t.id + '"]');
        slider.value = w.toFixed(1);
        document.getElementById("pw-" + t.id).textContent = w.toFixed(1);
      });
    });

    document.getElementById("generate-paper").addEventListener("click", function () {
      var total = parseInt(document.getElementById("pc-total").value, 10);
      var mode = document.getElementById("pc-mode").value;
      var weights = {};

      if (mode === "balanced" || mode === "random") {
        document.querySelectorAll(".pw-slider").forEach(function (slider) {
          weights[slider.dataset.topic] = parseFloat(slider.value);
        });
      }

      var paper;
      if (mode === "weak-only") {
        paper = generatePaper({ total: total, fromWrongOnly: true });
      } else if (mode === "random") {
        // 完全随机，权重相同
        TOPIC_LIST.forEach(function (t) { weights[t.id] = 1; });
        paper = generatePaper({ total: total, topicWeights: weights });
      } else {
        paper = generatePaper({ total: total, topicWeights: weights });
      }

      showPaperPreview(paper);
    });
  }

  function showPaperPreview(paper) {
    var preview = document.getElementById("paper-preview");
    if (paper.length === 0) {
      preview.innerHTML = '<div class="rec-empty">没有足够的题目，请增加题量或选择更多专题</div>';
      return;
    }

    var topicBreakdown = {};
    paper.forEach(function (q) {
      var topicId = findTopicForQuestion(q.id);
      if (!topicBreakdown[topicId]) topicBreakdown[topicId] = [];
      topicBreakdown[topicId].push(q);
    });

    var html =
      '<div class="paper-preview">' +
      '<h3>📋 预览试卷（共 ' + paper.length + ' 题）</h3>' +
      '<div class="paper-breakdown">';

    Object.keys(topicBreakdown).forEach(function (tid) {
      var t = TOPIC_LIST.find(function (x) { return x.id === tid; });
      if (t) {
        html += '<span class="pb-tag">' + t.icon + ' ' + t.name + ' × ' + topicBreakdown[tid].length + '题</span>';
      }
    });

    html += '</div>' +
      '<div class="paper-actions">' +
      '<button class="btn primary" id="start-paper">开始作答</button>' +
      '<button class="btn ghost" id="redraw-paper">重新组卷</button>' +
      '</div>' +
      '</div>';

    preview.innerHTML = html;

    document.getElementById("start-paper").addEventListener("click", function () {
      startPaperQuiz(paper);
    });
    document.getElementById("redraw-paper").addEventListener("click", function () {
      document.getElementById("generate-paper").click();
    });
  }

  function findTopicForQuestion(qid) {
    for (var i = 0; i < TOPIC_LIST.length; i++) {
      var qs = getQuestionsForTopic(TOPIC_LIST[i].id);
      for (var j = 0; j < qs.length; j++) {
        if (qs[j].id === qid) return TOPIC_LIST[i].id;
      }
    }
    return null;
  }

  function startPaperQuiz(paper) {
    // 复用 quiz.js 的逻辑，但使用自定义题目列表
    var state = {
      view: "quiz",
      questionSet: paper,
      paperMode: true,
      current: 0,
      answers: {},
      showAnswer: {},
      startTime: Date.now(),
      topicId: "smart_paper"
    };

    // 简易答题循环
    runPaperQuiz(state);
  }

  function runPaperQuiz(state) {
    var total = state.questionSet.length;
    var q = state.questionSet[state.current];
    var isMulti = q.type === "multi";

    if (state.current >= total) {
      // 显示结果
      showPaperResult(state);
      return;
    }

    var html =
      '<div class="quiz-play">' +
      '<div class="quiz-top-bar">' +
      '<a class="home-link" href="records.html">← 返回记录</a>' +
      '<div class="quiz-progress">' +
      '<div class="qp-bar"><div class="qp-fill" style="width:' + Math.round((state.current + 1) / total * 100) + '%"></div></div>' +
      '<span class="qp-text">智能组卷 · 第 ' + (state.current + 1) + ' / ' + total + ' 题</span>' +
      '</div>' +
      '</div>' +
      '<div class="quiz-question">' +
      '<div class="q-num">' + (state.current + 1) + '</div>' +
      '<div class="q-stem">' + escapeHtml(q.stem) + (isMulti ? ' <span class="q-tag">多选</span>' : '') + '</div>' +
      '<div class="q-options">';

    q.options.forEach(function (opt, oi) {
      html +=
        '<label class="q-opt">' +
        '<span class="q-opt-label">' + String.fromCharCode(65 + oi) + '</span>' +
        '<span class="q-opt-text">' + escapeHtml(opt) + '</span>' +
        '<input type="' + (isMulti ? "checkbox" : "radio") + '" name="pq_' + q.id + '" value="' + oi + '">' +
        '</label>';
    });

    html += '</div></div>' +
      '<div class="quiz-actions">' +
      '<button class="btn primary" id="pq-submit">提交作答</button>' +
      '</div>' +
      '</div>';

    document.getElementById("app").innerHTML = html;

    document.getElementById("pq-submit").addEventListener("click", function () {
      var inputs = document.querySelectorAll('input[name="pq_' + q.id + '"]:checked');
      var selected = [];
      inputs.forEach(function (inp) { selected.push(parseInt(inp.value, 10)); });

      if (selected.length === 0) {
        alert("请先选择一个选项");
        return;
      }

      var correct = Array.isArray(q.answer) ? q.answer.slice().sort() : [q.answer].slice().sort();
      var selSorted = selected.slice().sort();
      var isRight = selSorted.length === correct.length && selSorted.every(function (v, i) { return v === correct[i]; });

      // 记录历史
      var topicId = findTopicForQuestion(q.id);
      addHistoryRecord({
        topicId: topicId,
        qid: q.id,
        timestamp: Date.now(),
        correct: isRight,
        timeSpent: 0
      });

      state.current++;
      runPaperQuiz(state);
    });
  }

  function showPaperResult(state) {
    var total = state.questionSet.length;
    var correctCount = 0;
    var wrongCount = 0;

    // 统计已记录的结果
    var history = loadHistory();
    var recentRecords = history.slice(-total);
    recentRecords.forEach(function (r) {
      if (r.correct) correctCount++;
      else wrongCount++;
    });

    var accuracy = total > 0 ? Math.round(correctCount / total * 100) : 0;

    var html =
      '<div class="quiz-result">' +
      '<div class="result-summary">' +
      '<h2>🎯 智能组卷 · 练习结果</h2>' +
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
      '</div>' +
      '</div>' +
      '<div class="result-actions">' +
      '<button class="btn primary" id="back-records">返回记录</button>' +
      '<button class="btn ghost" id="go-quiz">去刷题</button>' +
      '</div>' +
      '</div>';

    document.getElementById("app").innerHTML = html;

    document.getElementById("back-records").addEventListener("click", renderRecords);
    document.getElementById("go-quiz").addEventListener("click", function () {
      window.location.href = "quiz.html";
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatTime(sec) {
    sec = Math.round(sec);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    if (m === 0) return s + "秒";
    var h = Math.floor(m / 60);
    if (h === 0) return m + "分" + (s > 0 ? s + "秒" : "");
    return h + "时" + (m % 60) + "分";
  }

  // ---------- 初始化 ----------
  document.addEventListener("DOMContentLoaded", function () {
    // 从 quiz.html 跳转过来的情况
    var params = new URLSearchParams(window.location.search);
    var autoTopic = params.get("topic");
    if (autoTopic && window.QUIZ_DATA && window.QUIZ_DATA[autoTopic]) {
      // 跳转到 quiz.html 并预选专题
      window.location.href = "quiz.html?topic=" + autoTopic;
      return;
    }

    renderRecords();
  });

  window.RecordsApp = {
    render: renderRecords,
    getOverall: getOverallStats,
    getTopic: getTopicStats,
    generatePaper: generatePaper
  };
})();
