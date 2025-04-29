const $ = new Env('顺丰速运');
$.KEY_login = 'chavy_login_sfexpress';

!(async () => {
  try {
    // 1. APP登录获取凭证
    await loginapp();
    await $.wait(1500);
    
    // 登录结果检查
    if (!$.login || !$.login.obj) {
      throw new Error('⚠️ 登录失败：未获取到有效登录凭证');
    }

    // 2. WEB登录保持会话
    await loginweb();
    await $.wait(1500);

    // 3. 执行签到
    await sign();
    await $.wait(1000);

    // 4. 处理每日任务
    await signDailyTasks();
    
    // 5. 显示结果
    showmsg();
  } catch (e) {
    $.logErr(e);
    $.msg($.name, '❌ 脚本执行失败', e.message || JSON.stringify(e));
  } finally {
    $.done();
  }
})();

/*******************
 * 核心功能函数
 *******************/

async function loginapp() {
  const loginOpts = $.getjson($.KEY_login);
  if (!loginOpts || !loginOpts.url) {
    throw new Error('❌ 请先配置登录信息');
  }

  // 请求头处理（兼容Loon）
  loginOpts.headers = loginOpts.headers || {};
  delete loginOpts.headers.Cookie;
  loginOpts.headers['Content-Type'] = loginOpts.headers['Content-Type'] || 'application/json';

  // 发送登录请求
  const resp = await $.http.post(loginOpts).catch(err => {
    throw new Error(`APP登录请求失败: ${err}`);
  });

  // 多环境响应数据解析
  try {
    const data = JSON.parse(resp.body);
    $.login = {
      obj: data.obj || data.data || data,
      ...data
    };
    
    // Loon特殊处理
    if ($.isLoon() && !$.login.obj.sign) {
      $.login.obj.sign = data.sign || (data.result ? data.result.sign : null);
    }
  } catch (e) {
    throw new Error(`登录响应解析失败: ${resp.body}`);
  }

  if (!$.login.obj?.sign) {
    throw new Error('❌ 未获取到关键sign参数');
  }
}

function loginweb() {
  const sign = encodeURIComponent($.login.obj.sign);
  return $.http.get({
    url: `https://mcs-mimp-web.sf-express.com/mcs-mimp/share/app/shareRedirect?sign=${sign}&source=SFAPP&bizCode=647@RnlvejM1R3VTSVZ6d3BNaXJxRFpOUVVtQkp0ZnFpNDBKdytobm5TQWxMeHpVUXVrVzVGMHVmTU5BVFA1bXlwcw==`,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Referer': 'https://mcs-mimp-web.sf-express.com/'
    }
  }).catch(err => {
    throw new Error(`WEB登录失败: ${err}`);
  });
}

async function sign() {
  const resp = await $.http.post({
    url: `https://mcs-mimp-web.sf-express.com/mcs-mimp/commonPost/~memberNonactivity~integralTaskSignPlusService~automaticSignFetchPackage`,
    body: `{"comeFrom": "vioin", "channelFrom": "SFAPP"}`,
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://mcs-mimp-web.sf-express.com'
    }
  }).catch(err => {
    throw new Error(`签到请求失败: ${err}`);
  });

  try {
    $.sign = JSON.parse(resp.body);
  } catch (e) {
    throw new Error(`签到结果解析失败: ${resp.body}`);
  }
}

async function queryDailyTask() {
  const resp = await $.http.post({
    url: `https://mcs-mimp-web.sf-express.com/mcs-mimp/commonPost/~memberNonactivity~integralTaskStrategyService~queryPointTaskAndSignFromES`,
    body: `{"channelType":"1"}`,
    headers: {
      'Content-Type': 'application/json'
    }
  }).catch(err => {
    throw new Error(`任务查询失败: ${err}`);
  });

  try {
    const data = JSON.parse(resp.body);
    $.tasks = data.obj ? data.obj.taskTitleLevels : (data.data ? data.data.taskTitleLevels : []);
  } catch (e) {
    throw new Error(`任务数据解析失败: ${resp.body}`);
  }
}

async function signDailyTasks() {
  await queryDailyTask();

  for (const task of $.tasks) {
    try {
      if (task.status === 1) {
        await getPoint(task);
      } else if (task.status === 2) {
        await doTask(task);
        await getPoint(task);
      } else if (task.status === 3) {
        task.result = '✅ 积分已领取';
      } else {
        task.result = '⚠️ 未知状态';
      }
    } catch (e) {
      task.result = `❌ 失败: ${e.message}`;
    }
    await $.wait(500); // 任务间间隔
  }
}

function doTask(task) {
  return $.http.post({
    url: `https://mcs-mimp-web.sf-express.com/mcs-mimp/commonRoutePost/memberEs/taskRecord/finishTask`,
    body: `{"taskCode":"${task.taskCode}"}`,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function getPoint(task) {
  return $.http.post({
    url: 'https://mcs-mimp-web.sf-express.com/mcs-mimp/commonPost/~memberNonactivity~integralTaskStrategyService~fetchIntegral',
    body: `{"strategyId":${task.strategyId},"taskId":"${task.taskId}","taskCode":"${task.taskCode}","channelType":"1"}`,
    headers: {
      'Content-Type': 'application/json'
    }
  }).then(resp => {
    const data = JSON.parse(resp.body);
    task.result = data.success ? `✅ +${data.obj ? data.obj.acquiredPoints : 0}积分` : `❌ ${data.errorMessage ? data.errorMessage : '领取失败'}`;
  });
}

function showmsg() {
  let subt = '';
  const desc = [];

  // 签到结果
  if ($.sign) {
    subt = $.sign.success ? '✅ 签到成功' : '❌ 签到失败';
    if ($.sign.obj) {
      desc.push(`连续签到: ${$.sign.obj.countDay ? $.sign.obj.countDay : 0}天`);
      if ($.sign.obj.hasFinishSign) {
        desc.push('今日已签到，请勿重复');
      }
    }
    if ($.sign.errorMessage) {
      desc.push(`错误信息: ${$.sign.errorMessage}`);
    }
  }

  // 每日任务
  if ($.tasks && $.tasks.length) {
    desc.push('', '📌 每日任务:');
    $.tasks.forEach(task => {
      desc.push(`${task.title ? task.title : task.taskCode}: ${task.result ? task.result : '未处理'}`);
    });
  }

  $.msg($.name, subt, desc.join('\n'));
}

/*******************
 * 环境兼容封装
 *******************/
function Env(t, e) {
  class s {
    constructor(t) { this.env = t }
    send(t, e = "GET") {
      t = "string" == typeof t ? { url: t } : t;
      let s = this.get;
      return "POST" === e && (s = this.post), new Promise((e, i) => {
        s.call(this, t, (t, s, r) => { t ? i(t) : e(s) })
      })
    }
    get(t) { return this.send.call(this.env, t) }
    post(t) { return this.send.call(this.env, t, "POST") }
  }
  return new class {
    constructor(t, e) {
      this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔 ${this.name}, 开始!`)
    }
    isNode() { return "undefined" != typeof module && !!module.exports }
    isQuanX() { return "undefined" != typeof $task }
    isSurge() { return "undefined" != typeof $httpClient && "undefined" == typeof $loon }
    isLoon() { return "undefined" != typeof $loon }
    isShadowrocket() { return "undefined" != typeof $rocket }
    toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } }
    toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } }
    getjson(t, e) {
      let s = e;
      const i = this.getdata(t);
      if (i) try { s = JSON.parse(this.getdata(t)) } catch { }
      return s
    }
    setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } }
    getScript(t) { return new Promise(e => { this.get({ url: t }, (t, s, i) => e(i)) }) }
    runScript(t, e) {
      return new Promise(s => {
        let i = this.getdata("@chavy_boxjs_userCfgs.httpapi");
        i = i ? i.replace(/\n/g, "").trim() : i;
        let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");
        r = r ? 1 * r : 20, r = e && e.timeout ? e.timeout : r;
        const [o, h] = i.split("@"), a = {
          url: `http://${h}/v1/scripting/evaluate`,
          body: { script_text: t, mock_type: "cron", timeout: r },
          headers: { "X-Key": o, Accept: "*/*" }
        };
        this.post(a, (t, e, i) => s(i))
      }).catch(t => this.logErr(t))
    }
    loaddata() {
      if (!this.isNode()) return {}; {
        this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path");
        const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e);
        if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } }
      }
    }
    writedata() {
      if (this.isNode()) {
        this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path");
        const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), r = JSON.stringify(this.data);
        s ? this.fs.writeFileSync(t, r) : i ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r)
      }
    }
    lodash_get(t, e, s) {
      const i = e.replace(/\[(\d+)\]/g, ".$1").split(".");
      let r = t;
      for (const t of i)
        if (r = Object(r)[t], void 0 === r) return s;
      return r
    }
    lodash_set(t, e, s) {
      return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}, t)[e[e.length - 1]] = s, t)
    }
    getdata(t) {
      let e = this.getval(t);
      if (/^@/.test(t)) {
        const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : "";
        if (r) try { const t = JSON.parse(r); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" }
      }
      return e
    }
    setdata(t, e) {
      let s = !1;
      if (/^@/.test(e)) {
        const [, i, r] = /^@(.*?)\.(.*?)$/.exec(e), o = this.getval(i), h = i ? "null" === o ? null : o || "{}" : "{}";
        try { const e = JSON.parse(h); this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const o = {}; this.lodash_set(o, r, t), s = this.setval(JSON.stringify(o), i) }
      } else s = this.setval(t, e);
      return s
    }
    getval(t) { return this.isSurge() || this.isLoon() ? $persistentStore.read(t) : this.isQuanX() ? $prefs.valueForKey(t) : this.isNode() ? (this.data = this.loaddata(), this.data[t]) : this.data && this.data[t] || null }
    setval(t, e) { return this.isSurge() || this.isLoon() ? $persistentStore.write(t, e) : this.isQuanX() ? $prefs.setValueForKey(t, e) : this.isNode() ? (this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0) : this.data && this.data[e] || null }
    initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) }
    get(t, e = (() => { })) {
      t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"]), this.isSurge() || this.isLoon() ? (this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, (t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i) })) : this.isQuanX() ? (this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => e(t))) : this.isNode() && (this.initGotEnv(t), this.got(t).on("redirect", (t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } }).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => { const { message: s, response: i } = t; e(s, i, i && i.body) }))
    }
    post(t, e = (() => { })) {
      const s = t.method ? t.method.toLocaleLowerCase() : "post";
      if (t.body && t.headers && !t.headers["Content-Type"] && (t.headers["Content-Type"] = "application/x-www-form-urlencoded"), t.headers && delete t.headers["Content-Length"], this.isSurge() || this.isLoon() ? this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, (t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i) })) : this.isQuanX() ? t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => e(t))) : this.isNode()) { this.initGotEnv(t); const { url: i, ...r } = t; this.got[s](i, r).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => { const { message: s, response: i } = t; e(s, i, i && i.body) }) }
    }
    time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t }
    msg(e = t, s = "", i = "", r) {
      const o = t => { if (!t) return t; if ("string" == typeof t) return this.isLoon() ? t : this.isQuanX() ? { "open-url": t } : this.isSurge() ? { url: t } : void 0; if ("object" == typeof t) { if (this.isLoon()) { let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"]; return { openUrl: e, mediaUrl: s } } if (this.isQuanX()) { let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl; return { "open-url": e, "media-url": s } } if (this.isSurge()) { let e = t.url || t.openUrl || t["open-url"]; return { url: e } } } };
      if (this.isMute || (this.isSurge() || this.isLoon() ? $notification.post(e, s, i, o(r)) : this.isQuanX() && $notify(e, s, i, o(r))), !this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) }
    }
    log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) }
    logErr(t, e) { const s = !this.isSurge() && !this.isQuanX() && !this.isLoon(); s ? this.log("", `❗️${this.name}, 错误!`, t.stack) : this.log("", `❗️${this.name}, 错误!`, t) }
    wait(t) { return new Promise(e => setTimeout(e, t)) }
    done(t = {}) { const e = (new Date).getTime(), s = (e - this.startTime) / 1e3; this.log("", `🔔 ${this.name}, 结束! 🕛 ${s} 秒`), this.log(), (this.isSurge() || this.isQuanX() || this.isLoon()) && $done(t) }
  }(t, e)
}
