(function () {
  "use strict";

  var client = window.supabaseClient;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function addStyles() {
    var style = document.createElement("style");
    style.textContent =
      ".auth-bar{max-width:1100px;margin:0 auto;padding:14px 24px;display:flex;justify-content:flex-end;gap:10px;align-items:center;font-size:14px}" +
      ".auth-user{color:var(--muted,#74808f)}.auth-dialog{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}" +
      ".auth-card{width:min(420px,100%);background:#fff;border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2)}" +
      ".auth-card h2{margin:0 0 8px}.auth-card p{color:var(--muted,#74808f);font-size:13px}.auth-card label{display:block;margin:12px 0 6px;font-size:13px;font-weight:600}.auth-card input{width:100%;padding:10px 12px;border:1px solid #dce2ec;border-radius:8px;font-size:14px}.auth-card .auth-actions{display:flex;gap:8px;margin-top:18px}.auth-card .auth-message{min-height:20px;margin-top:12px;font-size:13px;color:#b42318}";
    document.head.appendChild(style);
  }

  function renderBar(session) {
    var bar = document.getElementById("auth-bar");
    if (!bar) return;
    if (!client) {
      bar.innerHTML = '<span class="auth-user">登录功能准备中</span>';
      return;
    }
    if (session && session.user) {
      bar.innerHTML = '<span class="auth-user">' + escapeHtml(session.user.email || "已登录") + '</span><button class="btn ghost" id="auth-sign-out">退出登录</button>';
      document.getElementById("auth-sign-out").addEventListener("click", async function () {
        await client.auth.signOut();
        renderBar(null);
      });
      return;
    }
    bar.innerHTML = '<button class="btn ghost" id="auth-sign-in">登录 / 注册</button>';
    document.getElementById("auth-sign-in").addEventListener("click", openDialog);
  }

  function openDialog() {
    var dialog = document.createElement("div");
    dialog.className = "auth-dialog";
    dialog.innerHTML =
      '<form class="auth-card" id="auth-form">' +
      '<h2>登录或注册</h2><p>登录后可同步学习状态、错题和答题记录。</p>' +
      '<label for="auth-email">邮箱</label><input id="auth-email" type="email" required autocomplete="email">' +
      '<label for="auth-password">密码</label><input id="auth-password" type="password" minlength="6" required autocomplete="current-password">' +
      '<div class="auth-actions"><button class="btn primary" type="submit">登录</button><button class="btn ghost" type="button" id="auth-register">注册</button><button class="btn ghost" type="button" id="auth-cancel">取消</button></div>' +
      '<div class="auth-message" id="auth-message"></div></form>';
    document.body.appendChild(dialog);

    function message(text, ok) {
      var el = document.getElementById("auth-message");
      el.style.color = ok ? "#0a6e3a" : "#b42318";
      el.textContent = text;
    }
    function values() {
      return {
        email: document.getElementById("auth-email").value.trim(),
        password: document.getElementById("auth-password").value
      };
    }
    document.getElementById("auth-cancel").addEventListener("click", function () { dialog.remove(); });
    document.getElementById("auth-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var v = values();
      var result = await client.auth.signInWithPassword(v);
      if (result.error) return message(result.error.message);
      dialog.remove();
      renderBar(result.data.session);
    });
    document.getElementById("auth-register").addEventListener("click", async function () {
      var v = values();
      var result = await client.auth.signUp(v);
      if (result.error) return message(result.error.message);
      message(result.data.session ? "注册成功，已登录。" : "注册成功，请检查邮箱确认链接。", true);
      if (result.data.session) {
        setTimeout(function () { dialog.remove(); renderBar(result.data.session); }, 600);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    addStyles();
    var bar = document.createElement("div");
    bar.className = "auth-bar";
    bar.id = "auth-bar";
    document.body.insertBefore(bar, document.body.firstChild);
    if (!client) return renderBar(null);
    var result = await client.auth.getSession();
    renderBar(result.data.session);
    client.auth.onAuthStateChange(function (_event, session) { renderBar(session); });
  });
})();
