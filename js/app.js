// 解锁式刷题 · 共享核心逻辑
// 每个专题页面需在引入本脚本前定义 TOPIC_ID 和 COURSE
// 状态机: locked -> learning -> practicing -> completed

(function () {
  "use strict";

  if (typeof COURSE === "undefined") {
    console.error("COURSE 数据未加载！");
    return;
  }
  if (typeof TOPIC_ID === "undefined") {
    var pathParts = window.location.pathname.split("/");
    TOPIC_ID = pathParts[pathParts.length - 1].replace(".html", "") || "gwy";
  }

  var STORAGE_KEY = "gwy_progress_" + TOPIC_ID + "_v" + COURSE.version;
  var FAILS_BEFORE_EXPLAIN = 2;
  // 预览模式：URL 带 ?preview=1 时解除门控，便于编辑/检查所有知识点
  var PREVIEW = /[?&]preview=1\b/.test(location.search);

  // ---------- 进度状态 ----------
  var progress = loadProgress();

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { completed: {}, attempts: {} };
  }
  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {}
  }

  // ---------- 门控判定 ----------
  function isCompleted(id) {
    return !!progress.completed[id];
  }
  function isUnlocked(index) {
    if (PREVIEW) return true;
    if (index === 0) return true;
    var prev = COURSE.nodes[index - 1];
    return isCompleted(prev.id);
  }
  function nodeById(id) {
    return COURSE.nodes.find(function (n) { return n.id === id; });
  }

  // ---------- 渲染：侧边栏 ----------
  function renderSidebar() {
    var ul = document.getElementById("kp-list");
    ul.innerHTML = "";
    var doneCount = 0;
    COURSE.nodes.forEach(function (node, i) {
      if (isCompleted(node.id)) doneCount++;
      var li = document.createElement("li");
      var unlocked = isUnlocked(i);
      var completed = isCompleted(node.id);

      li.className =
        "kp-item" +
        (unlocked ? "" : " locked") +
        (completed ? " completed" : "") +
        (i === currentIndex ? " active" : "");
      li.dataset.index = i;

      var icon = completed ? "✓" : unlocked ? (i + 1) : "🔒";
      li.innerHTML =
        '<span class="kp-icon">' + icon + "</span>" +
        '<span class="kp-title">' + escapeHtml(node.title) + "</span>";

      if (unlocked) {
        li.addEventListener("click", function () {
          currentIndex = i;
          render();
        });
      } else {
        li.title = "先通过上一关才能解锁";
      }
      ul.appendChild(li);
    });

    var pct = Math.round((doneCount / COURSE.nodes.length) * 100);
    document.getElementById("progress-bar").style.width = pct + "%";
    document.getElementById("progress-text").textContent =
      "已通关 " + doneCount + " / " + COURSE.nodes.length;
  }

  // ---------- 渲染：主区 ----------
  var currentIndex = 0;
  var phase = "lesson";
  var selected = {};
  var lastResult = null;

  function render() {
    renderSidebar();
    var node = COURSE.nodes[currentIndex];
    var main = document.getElementById("main");

    if (!isUnlocked(currentIndex)) {
      main.innerHTML =
        '<div class="locked-screen"><div class="lock-emoji">🔒</div>' +
        "<h2>这一关还未解锁</h2><p>先通过上一关的习题，才能解锁《" +
        escapeHtml(COURSE.nodes[currentIndex - 1].title) +
        "》。</p></div>";
      return;
    }

    if (phase === "lesson") {
      renderLesson(node, main);
    } else {
      renderPractice(node, main);
    }
  }

  function renderLesson(node, main) {
    var lessonHtml = node.lesson
      .split("\n")
      .map(function (l) { return l.trim() === "" ? "<br>" : "<p>" + escapeHtml(l) + "</p>"; })
      .join("");

    var completedBadge = isCompleted(node.id)
      ? '<span class="badge done">已通关</span>'
      : "";

    main.innerHTML =
      '<div class="lesson">' +
      "<h2>" + escapeHtml(node.title) + " " + completedBadge + "</h2>" +
      '<div class="lesson-body">' + lessonHtml + "</div>" +
      '<div class="actions">' +
      '<button class="btn primary" id="to-practice">开始练习 →</button>' +
      (isCompleted(node.id)
        ? '<button class="btn ghost" id="review-reset">重做本章</button>'
        : "") +
      "</div>" +
      "</div>";

    document.getElementById("to-practice").addEventListener("click", function () {
      phase = "practicing";
      selected = {};
      lastResult = null;
      render();
    });
    var rr = document.getElementById("review-reset");
    if (rr) {
      rr.addEventListener("click", function () {
        phase = "practicing";
        selected = {};
        lastResult = null;
        render();
      });
    }
  }

  function renderPractice(node, main) {
    var html =
      '<div class="practice"><h2>' + escapeHtml(node.title) + " · 练习</h2>";

    node.exercises.forEach(function (ex, ei) {
      var isMulti = ex.type === "multi";
      var opts = "";
      ex.options.forEach(function (opt, oi) {
        var checked = (selected[ex.id] || []).indexOf(oi) >= 0;
        opts +=
          '<label class="opt ' + (checked ? "checked" : "") + '">' +
          '<input type="' + (isMulti ? "checkbox" : "radio") +
          '" name="' + ex.id + '" value="' + oi + '" ' +
          (checked ? "checked" : "") + ">" +
          "<span>" + escapeHtml(opt) + "</span></label>";
      });

      var showExplain =
        lastResult && lastResult.detail[ex.id] && lastResult.detail[ex.id].wrong;
      html +=
        '<div class="question" data-qid="' + ex.id + '">' +
        '<div class="q-stem">' + (ei + 1) + ". " + escapeHtml(ex.stem) +
        (isMulti ? ' <span class="hint">（多选）</span>' : "") + "</div>" +
        '<div class="opts">' + opts + "</div>" +
        (showExplain
          ? '<div class="explain">' + escapeHtml(ex.explain) + "</div>"
          : "") +
        "</div>";
    });

    html += '<div class="actions">';
    html += '<button class="btn primary" id="submit">提交答案</button>';
    html += '<button class="btn ghost" id="back-lesson">返回讲解</button>';
    html += "</div>";

    if (lastResult) {
      if (lastResult.passed) {
        html +=
          '<div class="result pass">🎉 全部答对，已解锁下一关！</div>';
      } else {
        var fails = progress.attempts[node.id] || 0;
        html +=
          '<div class="result fail">✗ 还没通过（已尝试 ' + fails +
          " 次）。" + (fails >= FAILS_BEFORE_EXPLAIN
            ? "已为你展示错题解析，看看再来一次。"
            : "再想想，或点\"返回讲解\"复习。") + "</div>";
      }
    }

    html += "</div>";
    main.innerHTML = html;

    // 绑定选项
    main.querySelectorAll('input[type=radio], input[type=checkbox]').forEach(function (inp) {
      inp.addEventListener("change", function () {
        var qid = inp.name;
        if (inp.type === "radio") {
          selected[qid] = [parseInt(inp.value, 10)];
        } else {
          var arr = selected[qid] || [];
          if (inp.checked) {
            arr = arr.concat(parseInt(inp.value, 10));
          } else {
            arr = arr.filter(function (x) { return x !== parseInt(inp.value, 10); });
          }
          selected[qid] = arr;
        }
        // 更新样式
        var qWrap = inp.closest(".question");
        qWrap.querySelectorAll(".opt").forEach(function (o) { o.classList.remove("checked"); });
        qWrap.querySelectorAll("input:checked").forEach(function (c) {
          c.closest(".opt").classList.add("checked");
        });
      });
    });

    document.getElementById("submit").addEventListener("click", function () { submit(node); });
    document.getElementById("back-lesson").addEventListener("click", function () {
      phase = "lesson";
      render();
    });
  }

  // ---------- 提交与判定 ----------
  function submit(node) {
    var detail = {};
    var correct = 0;
    node.exercises.forEach(function (ex) {
      var ans = (selected[ex.id] || []).slice().sort();
      var key = (Array.isArray(ex.answer) ? ex.answer : [ex.answer]).slice().sort();
      var isRight =
        ans.length === key.length && ans.every(function (v, i) { return v === key[i]; });
      if (isRight) correct++;
      else detail[ex.id] = { wrong: true };
    });

    var total = node.exercises.length;
    var accuracy = correct / total;
    var passed =
      correct >= node.passRule.needCorrect &&
      accuracy >= (node.passRule.minAccuracy || 0);

    lastResult = { passed: passed, correct: correct, total: total, detail: detail };

    progress.attempts[node.id] = (progress.attempts[node.id] || 0) + 1;

    if (passed) {
      progress.completed[node.id] = {
        at: new Date().toISOString(),
        attempts: progress.attempts[node.id]
      };
      saveProgress();
      var next = currentIndex + 1;
      if (next < COURSE.nodes.length && isUnlocked(next)) {
        setTimeout(function () {
          currentIndex = next;
          phase = "lesson";
          render();
        }, 900);
      }
    } else {
      saveProgress();
    }
    render();
  }

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- 重置 ----------
  var resetBtn = document.getElementById("reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      if (confirm("确定清空本专题的所有通关进度？")) {
        progress = { completed: {}, attempts: {} };
        saveProgress();
        currentIndex = 0;
        phase = "lesson";
        render();
      }
    });
  }

  // ---------- 启动 ----------
  for (var i = 0; i < COURSE.nodes.length; i++) {
    if (isUnlocked(i) && !isCompleted(COURSE.nodes[i].id)) {
      currentIndex = i;
      break;
    }
    if (i === COURSE.nodes.length - 1) currentIndex = i;
  }
  document.getElementById("course-title").textContent = COURSE.title;
  var subEl = document.getElementById("course-sub");
  if (subEl) subEl.textContent = COURSE.subtitle;

  // 首页链接
  var homeLink = document.querySelector(".home-link");
  if (homeLink) {
    homeLink.addEventListener("click", function (e) {
      e.preventDefault();
      window.location.href = "../index.html";
    });
  }

  render();
})();
