// 解锁式刷题 · 核心逻辑
// 状态机: locked -> learning -> practicing -> completed
// 进度存 localStorage，题库版本变化自动重置避免脏数据

(function () {
  "use strict";

  const STORAGE_KEY = "gwy_unlock_progress_v" + COURSE.version;
  const FAILS_BEFORE_EXPLAIN = 2; // 连错几次后展示解析

  // ---------- 进度状态 ----------
  let progress = loadProgress();

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
    if (index === 0) return true; // 第一关永远开放
    const prev = COURSE.nodes[index - 1];
    return isCompleted(prev.id);
  }
  function nodeById(id) {
    return COURSE.nodes.find((n) => n.id === id);
  }

  // ---------- 渲染：侧边栏 ----------
  function renderSidebar() {
    const ul = document.getElementById("kp-list");
    ul.innerHTML = "";
    let doneCount = 0;
    COURSE.nodes.forEach((node, i) => {
      if (isCompleted(node.id)) doneCount++;
      const li = document.createElement("li");
      const unlocked = isUnlocked(i);
      const completed = isCompleted(node.id);

      li.className =
        "kp-item" +
        (unlocked ? "" : " locked") +
        (completed ? " completed" : "") +
        (i === currentIndex ? " active" : "");
      li.dataset.index = i;

      const icon = completed ? "✓" : unlocked ? (i + 1) : "🔒";
      li.innerHTML =
        '<span class="kp-icon">' + icon + "</span>" +
        '<span class="kp-title">' + escapeHtml(node.title) + "</span>";

      if (unlocked) {
        li.addEventListener("click", () => {
          currentIndex = i;
          render();
        });
      } else {
        li.title = "先通过上一关才能解锁";
      }
      ul.appendChild(li);
    });

    const pct = Math.round((doneCount / COURSE.nodes.length) * 100);
    document.getElementById("progress-bar").style.width = pct + "%";
    document.getElementById("progress-text").textContent =
      "已通关 " + doneCount + " / " + COURSE.nodes.length;
  }

  // ---------- 渲染：主区 ----------
  let currentIndex = 0;
  let phase = "lesson"; // lesson | practicing
  let selected = {}; // 当前作答 {qid: [indices]}
  let lastResult = null;

  function render() {
    renderSidebar();
    const node = COURSE.nodes[currentIndex];
    const main = document.getElementById("main");

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
    const lessonHtml = node.lesson
      .split("\n")
      .map((l) => (l.trim() === "" ? "<br>" : "<p>" + escapeHtml(l) + "</p>"))
      .join("");

    const completedBadge = isCompleted(node.id)
      ? '<span class="badge done">已通关</span>'
      : "";

    main.innerHTML =
      '<div class="lesson">' +
      "<h2>" + escapeHtml(node.title) + " " + completedBadge + "</h2>" +
      '<div class="lesson-body">' + lessonHtml + "</div>" +
      '<button class="btn primary" id="to-practice">开始练习 →</button>' +
      (isCompleted(node.id)
        ? '<button class="btn ghost" id="review-reset">重做本章</button>'
        : "") +
      "</div>";

    document.getElementById("to-practice").addEventListener("click", () => {
      phase = "practicing";
      selected = {};
      lastResult = null;
      render();
    });
    const rr = document.getElementById("review-reset");
    if (rr) {
      rr.addEventListener("click", () => {
        phase = "practicing";
        selected = {};
        lastResult = null;
        render();
      });
    }
  }

  function renderPractice(node, main) {
    let html =
      '<div class="practice"><h2>' + escapeHtml(node.title) + " · 练习</h2>";

    node.exercises.forEach((ex, ei) => {
      const isMulti = ex.type === "multi";
      let opts = "";
      ex.options.forEach((opt, oi) => {
        const checked = (selected[ex.id] || []).includes(oi);
        opts +=
          '<label class="opt ' + (checked ? "checked" : "") + '">' +
          '<input type="' + (isMulti ? "checkbox" : "radio") +
          '" name="' + ex.id + '" value="' + oi + '" ' +
          (checked ? "checked" : "") + ">" +
          "<span>" + escapeHtml(opt) + "</span></label>";
      });

      const showExplain =
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
        const fails = progress.attempts[node.id] || 0;
        html +=
          '<div class="result fail">✗ 还没通过（已尝试 ' + fails +
          " 次）。" + (fails >= FAILS_BEFORE_EXPLAIN
            ? "已为你展示错题解析，看看再来一次。"
            : "再想想，或点“返回讲解”复习。") + "</div>";
      }
    }

    html += "</div>";
    main.innerHTML = html;

    // 绑定选项
    main.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((inp) => {
      inp.addEventListener("change", () => {
        const qid = inp.name;
        if (inp.type === "radio") {
          selected[qid] = [parseInt(inp.value, 10)];
        } else {
          let arr = selected[qid] || [];
          if (inp.checked) {
            arr = arr.concat(parseInt(inp.value, 10));
          } else {
            arr = arr.filter((x) => x !== parseInt(inp.value, 10));
          }
          selected[qid] = arr;
        }
        // 更新样式
        const qWrap = inp.closest(".question");
        qWrap.querySelectorAll(".opt").forEach((o) => o.classList.remove("checked"));
        qWrap.querySelectorAll("input:checked").forEach((c) => {
          c.closest(".opt").classList.add("checked");
        });
      });
    });

    document.getElementById("submit").addEventListener("click", () => submit(node));
    document.getElementById("back-lesson").addEventListener("click", () => {
      phase = "lesson";
      render();
    });
  }

  // ---------- 提交与判定 ----------
  function submit(node) {
    const detail = {};
    let correct = 0;
    node.exercises.forEach((ex) => {
      const ans = (selected[ex.id] || []).slice().sort();
      const key = (Array.isArray(ex.answer) ? ex.answer : [ex.answer]).slice().sort();
      const isRight =
        ans.length === key.length && ans.every((v, i) => v === key[i]);
      if (isRight) correct++;
      else detail[ex.id] = { wrong: true };
    });

    const total = node.exercises.length;
    const accuracy = correct / total;
    const passed =
      correct >= node.passRule.needCorrect &&
      accuracy >= (node.passRule.minAccuracy || 0);

    lastResult = { passed, correct, total, detail };

    progress.attempts[node.id] = (progress.attempts[node.id] || 0) + 1;

    if (passed) {
      progress.completed[node.id] = {
        at: new Date().toISOString(),
        attempts: progress.attempts[node.id],
      };
      saveProgress();
      // 通关后自动定位到下一关
      const next = currentIndex + 1;
      if (next < COURSE.nodes.length && isUnlocked(next)) {
        setTimeout(() => {
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
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (confirm("确定清空所有通关进度？")) {
      progress = { completed: {}, attempts: {} };
      saveProgress();
      currentIndex = 0;
      phase = "lesson";
      render();
    }
  });

  // ---------- 启动 ----------
  // 进入时跳到第一个未通关且已解锁的节点
  for (let i = 0; i < COURSE.nodes.length; i++) {
    if (isUnlocked(i) && !isCompleted(COURSE.nodes[i].id)) {
      currentIndex = i;
      break;
    }
    if (i === COURSE.nodes.length - 1) currentIndex = i;
  }
  document.getElementById("course-title").textContent = COURSE.title;
  document.getElementById("course-sub").textContent = COURSE.subtitle;
  render();
})();
