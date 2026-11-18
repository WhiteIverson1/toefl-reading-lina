(function () {
  "use strict";

  const STORAGE_KEY = "toefl_reading_state_v1";
  const passages = window.TOEFL_DATA || [];
  const LETTERS = ["A", "B", "C", "D"];

  const TYPE_LABELS = {
    vocabulary: "词汇题 (Vocabulary)",
    detail: "事实信息题 (Factual Information)",
    negative_detail: "否定事实信息题 (Negative Factual)",
    inference: "推理题 (Inference)",
    rhetorical_purpose: "修辞目的题 (Rhetorical Purpose)",
    organization: "篇章结构题 (Organization)",
    insert_sentence: "句子插入题 (Insert Text)",
    main_idea: "主旨题 (Main Idea)",
    reference: "指代题 (Reference)",
    select_sentence: "选择句子题 (Select Sentence)",
    sentence_simplification: "句子简化题 (Sentence Simplification)"
  };

  const TYPE_SHORT = {
    vocabulary: "词汇",
    detail: "事实信息",
    negative_detail: "否定事实",
    inference: "推理",
    rhetorical_purpose: "修辞目的",
    organization: "篇章结构",
    insert_sentence: "句子插入",
    main_idea: "主旨",
    reference: "指代",
    select_sentence: "选择句子",
    sentence_simplification: "句子简化"
  };

  const TARGET_OPTIONS = [0, 5, 6];
  const GROUP_SIZES = [5, 10, 20];

  // One-line strategy tip per question type (shown on the type cards)
  const TYPE_TIPS = {
    detail: "答案是原文明确写出的信息：先用题干关键词回原文定位，再和选项逐一比对。",
    negative_detail: "找原文没有提到、或与原文不符的一项：把三个能在原文找到的选项排除掉。",
    vocabulary: "看词在这句话里的意思，而不是最常见的词义：把选项代回原句检查是否通顺。",
    inference: "答案没有直接写出，但能由原文推出：不要选需要额外假设或推得太远的选项。",
    rhetorical_purpose: "问作者为什么提到某个信息：看它在段落里是举例、解释、对比还是支持观点。",
    insert_sentence: "抓待插入句里的代词、连接词和指代关系，判断放在哪个位置前后最连贯。",
    select_sentence: "按题目要求在选项中找出与原文意思最吻合的一句，注意偷换和过度概括。",
    sentence_simplification: "选出保留高亮句全部核心信息、且没有改变逻辑关系的选项。",
    reference: "找出代词指代的对象：把选项代回原句，看语法和意思是否都成立。",
    main_idea: "把握全文中心思想：排除只讲细节、或范围过大过小的选项。",
    organization: "判断段落或全文的组织方式：先概括每段在做什么，再看段落之间的关系。"
  };

  // qid -> { passage, question, index }
  const questionLookup = {};
  passages.forEach((p) =>
    p.questions.forEach((q, i) => {
      questionLookup[q.id] = { passage: p, question: q, index: i };
    })
  );

  // ================= STATE =================
  const state = {
    view: "home", // home | dashboard | quiz | mistakes | redo | guide
    currentPassageId: passages[0] ? passages[0].id : null,
    currentQuestionIndex: 0,
    displayMode: "single", // single | all
    settings: {
      studyMode: "exam", // exam: 做完整篇再看解析 | practice: 每题即时反馈
      targetMinutes: 5, // 0 = 不设目标
      groupSize: 10 // 题型专项每组题数
    },
    // passageId -> { answers, flagged, revealed, submitted, elapsedSeconds, mode }
    records: {},
    // qid -> { passageId, wrongCount, lastAnswer, addedAt, lastRedo }
    mistakes: {},
    mistakeTab: "wrong", // wrong | flagged
    mistakeType: "all",
    dashSubject: "all",
    dashStatus: "all", // all | todo | doing | done
    dashTab: "passages", // passages | types
    // qid -> { correct: bool, at } latest result from any practice mode
    qResults: {},
    redo: null, // { source, queue: [qid], index, answers: {}, finished }
    evidenceQ: null // qid whose evidence is shown (all-mode)
  };

  const HASH_VIEWS = ["home", "dashboard", "mistakes", "guide"];
  function setHash(view) {
    const target = view === "quiz" ? "dashboard" : view === "redo" ? "mistakes" : view;
    if (HASH_VIEWS.includes(target) && location.hash !== "#" + target) {
      location.hash = target;
    }
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      if (saved.records) state.records = saved.records;
      if (saved.mistakes) state.mistakes = saved.mistakes;
      if (saved.qResults) state.qResults = saved.qResults;
      if (saved.dashTab) state.dashTab = saved.dashTab;
      if (saved.displayMode) state.displayMode = saved.displayMode;
      if (saved.settings) Object.assign(state.settings, saved.settings);
      // a value saved from an earlier version that is no longer offered
      if (!TARGET_OPTIONS.includes(state.settings.targetMinutes)) state.settings.targetMinutes = 5;
      if (!GROUP_SIZES.includes(state.settings.groupSize)) state.settings.groupSize = 10;
    } catch (e) {
      console.warn("Failed to read localStorage:", e);
    }
    // Backfill per-question results from passage records saved before qResults existed
    passages.forEach((p) => {
      const rec = state.records[p.id];
      if (!rec) return;
      p.questions.forEach((q) => {
        if (state.qResults[q.id]) return;
        if (rec.submitted || (rec.revealed && rec.revealed[q.id])) {
          state.qResults[q.id] = { correct: rec.answers[q.id] === q.answer, at: 0 };
        }
      });
    });
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          displayMode: state.displayMode,
          settings: state.settings,
          records: state.records,
          mistakes: state.mistakes,
          qResults: state.qResults,
          dashTab: state.dashTab
        })
      );
    } catch (e) {
      console.warn("Failed to save localStorage:", e);
    }
  }

  function newRecord() {
    return {
      answers: {},
      flagged: {},
      revealed: {},
      submitted: false,
      elapsedSeconds: 0,
      mode: state.settings.studyMode
    };
  }

  function getRecord(passageId) {
    if (!state.records[passageId]) state.records[passageId] = newRecord();
    const rec = state.records[passageId];
    // records saved by older versions
    if (!rec.revealed) rec.revealed = {};
    if (!rec.flagged) rec.flagged = {};
    if (!rec.mode) rec.mode = "exam";
    return rec;
  }

  function hasProgress(rec) {
    return rec.submitted || Object.keys(rec.answers).length > 0;
  }

  function isRevealed(rec, q) {
    return rec.submitted || !!rec.revealed[q.id];
  }

  function getCurrentPassage() {
    return passages.find((p) => p.id === state.currentPassageId) || passages[0];
  }

  // ================= HELPERS =================
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function stripMarkup(text) {
    return text
      .replace(/\[\[BOX_\d\]\]/g, "")
      .replace(/\{\{q\d+:(.*?)\}\}/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function lbl(full, short) {
    return `<span class="lbl-full">${full}</span><span class="lbl-short">${short}</span>`;
  }

  function scoreOf(passage, rec) {
    let correct = 0;
    passage.questions.forEach((q) => {
      if (rec.answers[q.id] === q.answer) correct++;
    });
    const total = passage.questions.length;
    return { correct, total, percent: Math.round((correct / total) * 100) };
  }

  function evidenceList(q) {
    if (!q.evidence) return [];
    return Array.isArray(q.evidence) ? q.evidence : [q.evidence];
  }

  function setResult(q, answer) {
    state.qResults[q.id] = { correct: answer === q.answer, at: Date.now() };
  }

  // ================= MISTAKES =================
  function recordMistake(q, passageId, answer) {
    if (answer === q.answer) return;
    const m = state.mistakes[q.id] || {
      passageId,
      wrongCount: 0,
      addedAt: Date.now()
    };
    m.wrongCount += 1;
    m.lastAnswer = answer || null;
    m.lastRedo = null;
    state.mistakes[q.id] = m;
  }

  function getFlaggedIds() {
    const ids = [];
    passages.forEach((p) => {
      const rec = state.records[p.id];
      if (!rec || !rec.flagged) return;
      p.questions.forEach((q) => {
        if (rec.flagged[q.id]) ids.push(q.id);
      });
    });
    return ids;
  }

  function getWrongIds() {
    // keep question-bank order (passage, then question number)
    const ids = [];
    passages.forEach((p) =>
      p.questions.forEach((q) => {
        if (state.mistakes[q.id]) ids.push(q.id);
      })
    );
    return ids;
  }

  function mistakeIdsForTab(tab) {
    return tab === "flagged" ? getFlaggedIds() : getWrongIds();
  }

  function toggleFlag(qid) {
    const info = questionLookup[qid];
    if (!info) return;
    const rec = getRecord(info.passage.id);
    if (rec.flagged[qid]) delete rec.flagged[qid];
    else rec.flagged[qid] = true;
    saveState();
  }

  // ================= TIMER =================
  let timerInterval = null;

  function timerClass(sec) {
    const target = state.settings.targetMinutes * 60;
    if (!target) return "";
    if (sec > target) return "over";
    if (sec >= target * 0.8) return "warn";
    return "";
  }

  function startTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      if (state.view !== "quiz" || document.hidden) return;
      const passage = getCurrentPassage();
      if (!passage) return;
      const rec = getRecord(passage.id);
      if (rec.submitted) return;
      rec.elapsedSeconds = (rec.elapsedSeconds || 0) + 1;
      const valEl = document.getElementById("header-timer-val");
      if (valEl) valEl.textContent = formatTime(rec.elapsedSeconds);
      const badge = document.getElementById("timer-badge");
      if (badge) badge.className = `timer-badge ${timerClass(rec.elapsedSeconds)}`;
      if (rec.elapsedSeconds % 5 === 0) saveState();
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ================= PASSAGE RENDERING =================
  // ctx: { activeQuestion, answerFor(qid), revealed(q), showInsertBoxes }
  function renderParagraphHTML(rawText, passage, ctx) {
    const active = ctx.activeQuestion;
    let html = rawText.replace(/\{\{(q\d+):(.*?)\}\}/g, (m, refKey, inner) => {
      const isActive = active && active.highlightRef === refKey;
      return `<span class="passage-highlight ${isActive ? "active" : ""}" id="hl-${refKey}">${inner}</span>`;
    });

    const insertQ = passage.questions.find((q) => q.type === "insert_sentence");
    html = html.replace(/\[\[BOX_([1-4])\]\]/g, (m, boxNum) => {
      if (!insertQ || !ctx.showInsertBoxes) return "";
      const letter = LETTERS[boxNum - 1];
      const selected = ctx.answerFor(insertQ.id);
      const revealed = ctx.revealed(insertQ);
      let preview = "";
      if (selected === letter) {
        const cls = revealed ? (letter === insertQ.answer ? "correct-insert" : "wrong-insert") : "";
        preview = `<span class="inserted-sentence-preview ${cls}">${insertQ.insertSentence}</span> `;
      } else if (revealed && insertQ.answer === letter) {
        preview = `<span class="inserted-sentence-preview correct-insert">[正确位置] ${insertQ.insertSentence}</span> `;
      }
      return `<span class="insert-square interactive" data-action="insert-box" data-qid="${insertQ.id}" data-opt="${letter}" title="点击将句子插入位置 ${boxNum}">■ ${boxNum}</span> ${preview}`;
    });
    return html;
  }

  function renderPassagePaper(passage, ctx) {
    const active = ctx.activeQuestion;
    const paras = passage.paragraphs
      .map((raw, i) => {
        const n = i + 1;
        const isTarget = active && active.paragraphHint === n;
        return `
          <p class="passage-paragraph ${isTarget ? "active-para" : ""}" id="para-${n}">
            <span class="para-marker">P${n}</span>
            ${renderParagraphHTML(raw, passage, ctx)}
          </p>`;
      })
      .join("");
    const words =
      ctx.showWordlist && passage.wordlist && passage.wordlist.length
        ? `<section class="wordlist">
            <div class="wordlist-title">📒 本篇词汇</div>
            <ul>${passage.wordlist.map((w) => `<li>${w}</li>`).join("")}</ul>
          </section>`
        : "";
    return `
      <article class="passage-paper" id="passage-paper">
        <h1 class="passage-heading">${passage.title}</h1>
        ${paras}
        ${words}
      </article>`;
  }

  // ================= QUESTION CARD =================
  // opts: { userAns, revealed, locked, numberLabel, flagged, footerHTML, extraActionsHTML }
  function renderQuestionCard(q, passage, opts) {
    const typeLabel = TYPE_LABELS[q.type] || "阅读理解题";
    const { userAns, revealed } = opts;

    let insertHTML = "";
    if (q.type === "insert_sentence" && q.insertSentence) {
      insertHTML = `
        <div class="insert-sentence-box">${q.insertSentence}</div>
        <div class="insert-tip">💡 可以直接点击原文中的 <strong>■ 1 ~ ■ 4</strong> 预览插入效果，也可以点下方选项。</div>`;
    }

    const optionsHTML = LETTERS.map((letter) => {
      let cls = "";
      if (revealed) {
        cls = "locked";
        if (letter === q.answer) cls += " correct-answer";
        else if (userAns === letter) cls += " wrong-answer";
      } else if (userAns === letter) {
        cls = "selected";
      }
      return `
        <div class="option-item ${cls}" data-action="choose" data-qid="${q.id}" data-opt="${letter}">
          <span class="option-letter">${letter}</span>
          <span class="option-text">${q.options[letter]}</span>
        </div>`;
    }).join("");

    let explanationHTML = "";
    if (revealed) {
      const correct = userAns === q.answer;
      const verdict = correct ? "✓ 回答正确" : userAns ? `✗ 回答错误（你选了 ${userAns}）` : "✗ 未作答";
      const locate = evidenceList(q).length
        ? `<button class="btn btn-evidence" data-action="show-evidence" data-qid="${q.id}">📍 定位原文依据</button>`
        : "";
      explanationHTML = `
        <div class="explanation-box">
          <div class="explanation-header">
            <span class="verdict-tag ${correct ? "verdict-correct" : "verdict-wrong"}">${verdict}</span>
            <span>正确答案：<strong>${q.answer}</strong></span>
            ${locate}
          </div>
          <div>${q.explanation}</div>
          ${opts.extraActionsHTML || ""}
        </div>`;
    }

    return `
      <div class="question-card" data-q-index="${questionLookup[q.id] ? questionLookup[q.id].index : 0}" id="card-${q.id}">
        <div class="q-card-header">
          <span class="q-number-badge">${opts.numberLabel}</span>
          <span class="q-type-tag">${typeLabel}${q.paragraphHint ? ` · P${q.paragraphHint}` : ""}</span>
          <button class="flag-btn ${opts.flagged ? "on" : ""}" data-action="flag" data-qid="${q.id}" title="${opts.flagged ? "取消标记" : "标记复查：会出现在错题本的「标记复查」里"}">
            ${opts.flagged ? "★" : "☆"}<span class="flag-text">${opts.flagged ? "已标记" : "标记"}</span>
          </button>
        </div>
        <div class="q-prompt">${q.prompt}</div>
        ${insertHTML}
        <div class="options-list">${optionsHTML}</div>
        ${explanationHTML}
        ${opts.footerHTML || ""}
      </div>`;
  }

  // ================= HOME & GUIDE =================
  const SUBJECT_INTRO = {
    "社会科学": { desc: "经济、心理、技术与历史类文章", tone: "blue" },
    "自然科学": { desc: "地质、生态与地球科学类文章", tone: "green" },
    "生命科学": { desc: "生物、医学与跨物种研究", tone: "teal" },
    "艺术": { desc: "艺术史、建筑与美学类文章", tone: "amber" }
  };

  function libraryOverview() {
    const subjects = {};
    const types = {};
    passages.forEach((p) => {
      const sub = p.subject || "其他";
      if (!subjects[sub]) subjects[sub] = { count: 0, topics: [] };
      subjects[sub].count += 1;
      const topic = (p.topic || "").split("·").pop().trim();
      if (topic && subjects[sub].topics.length < 3 && !subjects[sub].topics.includes(topic)) {
        subjects[sub].topics.push(topic);
      }
      p.questions.forEach((q) => {
        types[q.type] = (types[q.type] || 0) + 1;
      });
    });
    return { subjects, types, totalQuestions: passages.reduce((s, p) => s + p.questions.length, 0) };
  }

  function renderHome() {
    const { subjects, types, totalQuestions } = libraryOverview();
    const totalTypes = Object.keys(TYPE_LABELS).length;
    const subjectCards = Object.keys(subjects)
      .map((sub) => {
        const info = SUBJECT_INTRO[sub] || { desc: "学术阅读专题", tone: "blue" };
        return `
          <button class="subject-card tone-${info.tone}" data-action="filter-subject" data-v="${escapeAttr(sub)}">
            <span class="subject-card-top">
              <span class="subject-name">${sub}</span>
              <span class="subject-count">${subjects[sub].count} 篇</span>
            </span>
            <span class="subject-desc">${info.desc}</span>
            <span class="subject-topics">${subjects[sub].topics.map((t) => `<span>${t}</span>`).join("")}</span>
            <span class="subject-link">查看该学科 <span aria-hidden="true">→</span></span>
          </button>`;
      })
      .join("");

    const topTypes = Object.keys(types)
      .sort((a, b) => types[b] - types[a])
      .slice(0, 8)
      .map(
        (t) => `
          <div class="home-type-item">
            <span class="home-type-name">${TYPE_SHORT[t] || t}</span>
            <span class="home-type-count">${types[t]} 题</span>
          </div>`
      )
      .join("");

    return `
      <main class="home-page">
        <section class="hero">
          <div class="hero-copy">
            <span class="hero-kicker"><span class="kicker-dot"></span>本地离线 · 托福阅读备考</span>
            <h1>把学术阅读，<br /><em>练成看得懂的分数。</em></h1>
            <p class="hero-lead">面向中国考生的托福学术阅读练习站。精选 ${passages.length} 篇文章、${totalQuestions} 道题，配中文词汇表、原文证据定位和逐题解析，做完就能看懂错在哪里。</p>
            <div class="hero-actions">
              <button class="btn btn-primary btn-lg" data-action="go-dashboard">开始练习 <span aria-hidden="true">→</span></button>
              <button class="btn btn-ghost btn-lg" data-action="go-guide">先看使用指南</button>
            </div>
            <div class="hero-note">无需注册 · 无需联网 · 打开即用</div>
          </div>
          <div class="hero-panel" aria-label="题库概况">
            <div class="hero-panel-head"><span>题库总览</span><span class="panel-live">TOEFL READING</span></div>
            <div class="hero-numbers">
              <div><strong>${passages.length}</strong><span>篇学术文章</span></div>
              <div><strong>${totalQuestions}</strong><span>道练习题</span></div>
              <div><strong>${Object.keys(subjects).length}</strong><span>大学科分类</span></div>
              <div><strong>${totalTypes}</strong><span>类常见题型</span></div>
            </div>
            <div class="hero-panel-list">
              ${Object.keys(subjects)
                .map(
                  (sub) => `<div class="hero-bar-row"><span>${sub}</span><span class="bar-track"><i style="width:${Math.round((subjects[sub].count / passages.length) * 100)}%"></i></span><b>${subjects[sub].count}</b></div>`
                )
                .join("")}
            </div>
          </div>
        </section>

        <section class="home-section">
          <div class="section-head">
            <div><span class="section-eyebrow">按学科练习</span><h2>四类学术话题，覆盖真实考试常见领域</h2></div>
            <button class="text-link" data-action="go-dashboard">浏览全部文章 <span aria-hidden="true">→</span></button>
          </div>
          <div class="subject-grid">${subjectCards}</div>
        </section>

        <section class="home-section home-split">
          <div class="panel-box">
            <span class="section-eyebrow">题型覆盖</span>
            <h2>高频题型，逐类击破</h2>
            <p class="panel-desc">题库涵盖托福阅读常见题型。新增「题型专项」练习，每种题型一组一组练，更有针对性。</p>
            <div class="home-type-grid">${topTypes}</div>
            <button class="text-link" data-action="go-types">进入题型专项 <span aria-hidden="true">→</span></button>
          </div>
          <div class="panel-box steps-box">
            <span class="section-eyebrow">使用流程</span>
            <h2>三步完成一次有效练习</h2>
            <ol class="steps-list">
              <li><span class="step-num">1</span><div><strong>选择练习方式</strong><p>按篇章练习逐篇精读，或按题型专项集中突破弱项。</p></div></li>
              <li><span class="step-num">2</span><div><strong>限时作答</strong><p>左文右题，单题或整卷平铺，支持标记疑问题目。</p></div></li>
              <li><span class="step-num">3</span><div><strong>看解析、练错题</strong><p>定位原文证据，错题自动入本，可逐题重做。</p></div></li>
            </ol>
          </div>
        </section>

        <section class="home-section">
          <div class="section-head">
            <div><span class="section-eyebrow">为中文学习者设计</span><h2>不只是做题，更要读懂为什么</h2></div>
          </div>
          <div class="feature-grid">
            <article class="feature-card"><span class="feature-icon">词</span><h3>生词表先扫盲</h3><p>每篇文章附重点词汇与中文释义，读文章前先看一遍，减少词汇障碍。</p></article>
            <article class="feature-card"><span class="feature-icon">题</span><h3>题型专项突破</h3><p>按题型分组练习，可设定每组 5/10/20 题，优先练没做过的和做错的。</p></article>
            <article class="feature-card"><span class="feature-icon">证</span><h3>答案回到原文</h3><p>解析标出定位句、语境义与选项判断，知道答案从哪里来。</p></article>
            <article class="feature-card"><span class="feature-icon">稳</span><h3>本地稳定运行</h3><p>页面、题库与样式全部在本地，不依赖外部网络资源，进度自动保存。</p></article>
          </div>
        </section>

        <section class="home-cta">
          <div><span class="section-eyebrow">现在开始</span><h2>今天先练一组，慢慢把分数练上去。</h2><p>进度保存在当前浏览器，随时可以回来继续。</p></div>
          <button class="btn btn-primary btn-lg" data-action="random">随机抽一篇 <span aria-hidden="true">→</span></button>
        </section>
      </main>`;
  }

  function renderGuide() {
    const { types, totalQuestions } = libraryOverview();
    const typeRows = Object.keys(TYPE_LABELS)
      .map((t) => {
        const label = TYPE_LABELS[t];
        const cn = label.replace(/\s*\(.*$/, "");
        const en = (label.match(/\((.*)\)/) || [])[1] || "";
        return `
          <tr>
            <td><strong>${cn}</strong><span class="guide-en">${en}</span></td>
            <td>${types[t] || 0} 题</td>
            <td>${TYPE_TIPS[t] || "结合原文定位作答。"}</td>
          </tr>`;
      })
      .join("");

    return `
      <main class="guide-page">
        <header class="page-head">
          <span class="section-eyebrow">使用指南</span>
          <h1>这样用，练习效率更高</h1>
          <p>从选题到复盘，一套适合自己的阅读训练流程。所有功能都在本地完成，不需要注册或联网。</p>
        </header>

        <section class="guide-section">
          <h2>一、两种练习方式</h2>
          <div class="guide-grid">
            <div class="guide-card"><span class="guide-index">01</span><h3>篇章练习</h3><p>按学科或完成状态筛选文章，逐篇精读。适合训练整体阅读节奏和时间控制。</p></div>
            <div class="guide-card"><span class="guide-index">02</span><h3>题型专项</h3><p>按题型分组练习，每组 5/10/20 题，优先抽没做过的和做错的题。适合集中突破弱项。</p></div>
            <div class="guide-card"><span class="guide-index">03</span><h3>交卷与复盘</h3><p>交卷后显示成绩、用时和逐题解析。错题自动进入错题本，可在错题本中按题型筛选并重做。</p></div>
          </div>
        </section>

        <section class="guide-section">
          <h2>二、两种做题模式</h2>
          <div class="mode-compare">
            <div class="mode-card">
              <span class="mode-tag">推荐 · 接近考试</span>
              <h3>考试模式</h3>
              <p>整篇作答完成后统一交卷，交卷前不显示对错。适合检验真实水平、训练时间控制。</p>
              <ul><li>计时器按设定目标提醒</li><li>交卷后才显示解析</li><li>未作答题也会计入错题</li></ul>
            </div>
            <div class="mode-card">
              <span class="mode-tag alt">适合入门</span>
              <h3>练习模式</h3>
              <p>每答一题立即显示答案与解析，适合刚开始系统练习、边做边理解题型思路。</p>
              <ul><li>每题即时反馈</li><li>错题实时加入错题本</li><li>做完最后一题自动结束</li></ul>
            </div>
          </div>
          <p class="guide-tip">模式在题库页顶部设置，只对尚未开始的新练习生效；已开始的文章会沿用原模式。</p>
        </section>

        <section class="guide-section">
          <h2>三、题型速览（共 ${totalQuestions} 题）</h2>
          <div class="guide-table-wrap">
            <table class="guide-table">
              <thead><tr><th>题型</th><th>题量</th><th>做题建议</th></tr></thead>
              <tbody>${typeRows}</tbody>
            </table>
          </div>
        </section>

        <section class="guide-section">
          <h2>四、常见问题</h2>
          <div class="faq-list">
            <details><summary>需要联网吗？会加载外部资源吗？</summary><p>不需要。题库、脚本和样式都在本地文件中，页面不请求外部字体、图片或脚本，在断网环境下也能正常使用。</p></details>
            <details><summary>进度保存在哪里？换设备还在吗？</summary><p>进度保存在当前浏览器的本地存储中。换浏览器、换设备或清除浏览器数据后不会保留，也不会上传到任何服务器。</p></details>
            <details><summary>手机上可以用吗？</summary><p>可以。页面会自适应手机屏幕，底部提供固定导航。答题时原文和题目上下排列，可滚动查看。</p></details>
            <details><summary>题型专项每组多少题？可以改吗？</summary><p>默认每组 10 题，在题库页「题型专项」标签的设置里可以切换为 5、10 或 20 题。</p></details>
            <details><summary>想重新做一篇已经完成的文章怎么办？</summary><p>进入该篇文章后点「重做本篇」即可清空本篇作答记录。错题本中的记录会保留，方便后续针对性复习。</p></details>
          </div>
        </section>

        <div class="guide-cta">
          <p>方法看完了，开始练一组吧。</p>
          <button class="btn btn-primary" data-action="go-dashboard">前往题库 <span aria-hidden="true">→</span></button>
        </div>
      </main>`;
  }

  // ================= HEADER =================
  function brandHTML(titleHTML) {
    return `
      <div class="brand-area">
        <span class="brand-logo">TOEFL iBT</span>
        <span class="brand-title">${titleHTML}</span>
      </div>`;
  }

  // ================= DASHBOARD =================
  function segmented(name, current, items) {
    return `
      <div class="segmented" role="group">
        ${items
          .map(
            ([value, label]) =>
              `<button class="seg-btn ${String(current) === String(value) ? "on" : ""}" data-action="setting" data-name="${name}" data-value="${value}">${label}</button>`
          )
          .join("")}
      </div>`;
  }

  function renderDashboard() {
    let completed = 0;
    let answeredTotal = 0;
    let correctTotal = 0;
    const totalQuestions = passages.reduce((s, p) => s + p.questions.length, 0);

    passages.forEach((p) => {
      const rec = state.records[p.id];
      if (rec && rec.submitted) {
        completed++;
        const s = scoreOf(p, rec);
        answeredTotal += s.total;
        correctTotal += s.correct;
      }
    });
    const accuracy = answeredTotal ? `${Math.round((correctTotal / answeredTotal) * 100)}%` : "—";
    const bookCount = getWrongIds().length + getFlaggedIds().length;

    const statusOf = (p) => {
      const rec = state.records[p.id];
      if (rec && rec.submitted) return "done";
      if (rec && Object.keys(rec.answers).length) return "doing";
      return "todo";
    };
    const subjects = [];
    passages.forEach((p) => {
      if (p.subject && !subjects.includes(p.subject)) subjects.push(p.subject);
    });
    const shown = passages.filter(
      (p) =>
        (state.dashSubject === "all" || p.subject === state.dashSubject) &&
        (state.dashStatus === "all" || statusOf(p) === state.dashStatus)
    );
    const chip = (action, key, value, label, current) =>
      `<button class="chip ${current === value ? "on" : ""}" data-action="${action}" data-${key}="${value}">${label}</button>`;
    const subjectChips = [chip("dash-subject", "v", "all", "全部学科", state.dashSubject)]
      .concat(subjects.map((sub) => chip("dash-subject", "v", sub, sub, state.dashSubject)))
      .join("");
    const statusChips = [
      ["all", "全部"],
      ["todo", "未做"],
      ["doing", "进行中"],
      ["done", "已完成"]
    ]
      .map(([v, l]) => chip("dash-status", "v", v, l, state.dashStatus))
      .join("");

    const cards = shown
      .map((p) => {
        const rec = state.records[p.id];
        const answered = rec ? Object.keys(rec.answers).length : 0;
        let statusClass = "status-unstarted";
        let statusText = "未开始";
        if (rec && rec.submitted) {
          const s = scoreOf(p, rec);
          statusClass = "status-completed";
          statusText = `已完成 · ${s.correct}/${s.total}`;
        } else if (answered > 0) {
          statusClass = "status-progress";
          statusText = `进行中 · ${answered}/${p.questions.length}`;
        }
        return `
          <div class="passage-card" data-action="open-passage" data-pid="${p.id}">
            <div class="card-top">
              <div class="card-meta">
                <span class="passage-num-tag">Passage ${p.number}</span>
                <span class="topic-tag">${p.topic || ""}</span>
              </div>
              <h3 class="card-title">${p.title}</h3>
              <p class="card-excerpt">${stripMarkup(p.paragraphs[0])}</p>
              ${p.level ? `<div class="card-level" title="文本难度">${"★".repeat(p.level)}<span class="level-off">${"★".repeat(Math.max(0, 4 - p.level))}</span>${p.lexile ? ` · ${p.lexile}` : ""}</div>` : ""}
            </div>
            <div class="card-footer">
              <span class="status-badge ${statusClass}">${statusText}</span>
              <span class="card-cta">${rec && rec.submitted ? "查看解析 →" : answered ? "继续作答 →" : "开始练习 →"}</span>
            </div>
          </div>`;
      })
      .join("");

    const modeHint =
      state.settings.studyMode === "practice"
        ? "每做一题立刻显示对错和解析，适合刚开始练习。"
        : "整篇做完交卷后再看解析，更接近真实考试。";

    return `
      <header class="top-header">
        ${brandHTML('<span class="dash-title">Academic Reading 练习</span>')}
        <div class="header-controls">
          <button class="btn btn-header" data-action="go-mistakes">${lbl("错题本", "错题本")}${bookCount ? `<span class="count-dot">${bookCount}</span>` : ""}</button>
          <button class="btn btn-header" data-action="random">${lbl("随机抽一篇", "随机")}</button>
        </div>
      </header>

      <main class="dashboard-container">
        ${dashTabsHTML()}
        ${state.dashTab === "types" ? renderTypesTab() : `
        <section class="stats-banner">
          <div class="stats-group">
            <div class="stat-item"><span class="stat-label">题库</span><span class="stat-value">${passages.length} 篇 · ${totalQuestions} 题</span></div>
            <div class="stat-item"><span class="stat-label">已完成</span><span class="stat-value">${completed} / ${passages.length}</span></div>
            <div class="stat-item"><span class="stat-label">答对题数</span><span class="stat-value">${correctTotal} / ${answeredTotal}</span></div>
            <div class="stat-item"><span class="stat-label">正确率</span><span class="stat-value">${accuracy}</span></div>
          </div>
        </section>

        <section class="settings-bar">
          <div class="setting-row">
            <span class="setting-label">做题模式</span>
            ${segmented("studyMode", state.settings.studyMode, [
              ["exam", "考试模式"],
              ["practice", "练习模式"]
            ])}
            <span class="setting-hint">${modeHint}</span>
          </div>
          <div class="setting-row">
            <span class="setting-label">每篇目标用时</span>
            ${segmented(
              "targetMinutes",
              state.settings.targetMinutes,
              TARGET_OPTIONS.map((m) => [m, m ? `${m} 分钟` : "不设"])
            )}
            <span class="setting-hint">${state.settings.targetMinutes ? "接近目标时计时器变黄，超时变红。" : "只正向计时，不提醒。"}</span>
          </div>
        </section>

        <section class="filter-bar">
          <div class="chip-row">${subjectChips}</div>
          <div class="chip-row">${statusChips}<span class="filter-count">${shown.length} 篇</span></div>
        </section>

        <section class="passage-grid">${cards || `<div class="empty-state">没有符合条件的篇目。</div>`}</section>
        `}

        <footer class="dash-footer">
          进度保存在当前浏览器中，换设备或清除浏览器数据后不会保留。
          <button class="link-btn" data-action="reset-all">清空全部进度</button>
        </footer>
      </main>`;
  }

  function dashTabsHTML() {
    const tab = (v, label) =>
      `<button class="dash-tab ${state.dashTab === v ? "on" : ""}" data-action="dash-tab" data-v="${v}">${label}</button>`;
    return `<nav class="dash-tabs">${tab("passages", "篇章练习")}${tab("types", "题型专项")}</nav>`;
  }

  function questionsOfType(type) {
    const ids = [];
    passages.forEach((p) => p.questions.forEach((q) => q.type === type && ids.push(q.id)));
    return ids;
  }

  function typeStats(type) {
    const ids = questionsOfType(type);
    let done = 0;
    let correct = 0;
    ids.forEach((id) => {
      const r = state.qResults[id];
      if (r) {
        done++;
        if (r.correct) correct++;
      }
    });
    return { total: ids.length, done, correct };
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Unseen questions first, then ones last answered wrong, then the rest.
  function pickTypeGroup(type, size) {
    const ids = questionsOfType(type);
    const unseen = ids.filter((id) => !state.qResults[id]);
    const wrong = ids.filter((id) => state.qResults[id] && !state.qResults[id].correct);
    const right = ids.filter((id) => state.qResults[id] && state.qResults[id].correct);
    return shuffle(unseen).concat(shuffle(wrong), shuffle(right)).slice(0, size);
  }

  function typeName(type) {
    const m = (TYPE_LABELS[type] || "").match(/^(.*?)\s*\((.*)\)$/);
    return m ? { zh: m[1], en: m[2] } : { zh: TYPE_SHORT[type] || type, en: "" };
  }

  function renderTypesTab() {
    const types = Object.keys(TYPE_LABELS)
      .map((t) => ({ t, ...typeStats(t) }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);
    const size = state.settings.groupSize;

    const cards = types
      .map(({ t, total, done, correct }) => {
        const name = typeName(t);
        const pct = done ? Math.round((correct / done) * 100) : null;
        const accClass = pct === null ? "" : pct >= 80 ? "acc-good" : pct >= 60 ? "acc-mid" : "acc-low";
        const n = Math.min(size, total);
        return `
          <div class="type-card">
            <div class="type-card-head">
              <h3 class="type-name">${name.zh}</h3>
              <span class="type-en">${name.en}</span>
              <span class="type-total">${total} 题</span>
            </div>
            <p class="type-tip">${TYPE_TIPS[t] || ""}</p>
            <div class="type-progress" title="已做 ${done} / ${total}"><span style="width:${(done / total) * 100}%"></span></div>
            <div class="type-stats">
              <span>已做 ${done} / ${total}</span>
              <span class="type-acc ${accClass}">${pct === null ? "还没做过" : `正确率 ${pct}%`}</span>
            </div>
            <button class="btn btn-primary type-start" data-action="start-type" data-type="${t}">练一组（${n} 题）</button>
          </div>`;
      })
      .join("");

    return `
      <section class="settings-bar">
        <div class="setting-row">
          <span class="setting-label">每组题数</span>
          ${segmented("groupSize", size, GROUP_SIZES.map((g) => [g, `${g} 题`]))}
          <span class="setting-hint">每题做完立刻显示对错和解析。优先出没做过的题，其次是之前做错的。</span>
        </div>
      </section>
      <section class="type-grid">${cards}</section>`;
  }

  // ================= QUIZ VIEW =================
  function renderQuiz() {
    const passage = getCurrentPassage();
    const rec = getRecord(passage.id);
    const activeQ = passage.questions[state.currentQuestionIndex] || passage.questions[0];
    const isPractice = rec.mode === "practice";

    const pills = passage.questions
      .map((q, idx) => {
        const isCurrent = idx === state.currentQuestionIndex;
        const ans = rec.answers[q.id];
        let cls = "";
        if (isRevealed(rec, q)) cls = ans === q.answer ? "correct" : "wrong";
        else if (ans) cls = "answered";
        if (isCurrent) cls += state.displayMode === "single" ? " active" : " current";
        return `<button class="q-pill ${cls} ${rec.flagged[q.id] ? "flagged" : ""}" data-action="goto-q" data-idx="${idx}" title="第 ${q.number} 题">${q.number}</button>`;
      })
      .join("");

    const ctx = {
      activeQuestion: activeQ,
      answerFor: (qid) => rec.answers[qid],
      revealed: (q) => isRevealed(rec, q),
      showInsertBoxes: state.displayMode === "all" || activeQ.type === "insert_sentence",
      showWordlist: rec.submitted
    };

    // Score banner
    let scoreHTML = "";
    if (rec.submitted) {
      const s = scoreOf(passage, rec);
      const target = state.settings.targetMinutes * 60;
      let timeNote = "";
      if (target) {
        const diff = rec.elapsedSeconds - target;
        timeNote =
          diff > 0
            ? `<span class="time-over">（目标 ${formatTime(target)}，超时 ${formatTime(diff)}）</span>`
            : `<span class="time-ok">（目标 ${formatTime(target)}，达标）</span>`;
      }
      const wrongCount = s.total - s.correct;
      const next = passages[passages.indexOf(passage) + 1];
      scoreHTML = `
        <div class="score-summary-card">
          <div>
            <div class="score-label">本篇成绩 · ${isPractice ? "练习模式" : "考试模式"}</div>
            <div class="score-big">${s.correct} / ${s.total}<span class="score-pct">${s.percent}%</span></div>
            <div class="score-sub">用时 ${formatTime(rec.elapsedSeconds || 0)} ${timeNote}</div>
            ${wrongCount ? `<div class="score-sub">${wrongCount} 道错题已加入错题本</div>` : ""}
          </div>
          <div class="score-actions">
            <button class="btn btn-outline" data-action="retry">重做本篇</button>
            ${next ? `<button class="btn btn-primary" data-action="open-passage" data-pid="${next.id}">下一篇 →</button>` : ""}
          </div>
        </div>`;
    }

    const toRender = state.displayMode === "single" ? [activeQ] : passage.questions;
    const cardsHTML = toRender
      .map((q) => {
        const idx = passage.questions.indexOf(q);
        let footer = "";
        if (state.displayMode === "single") {
          const isLast = idx === passage.questions.length - 1;
          let right;
          if (!isLast) right = `<button class="btn btn-primary" data-action="next-q">下一题 →</button>`;
          else if (!rec.submitted) right = `<button class="btn btn-submit" data-action="submit">${isPractice ? "结束本篇" : "完成并交卷 ✓"}</button>`;
          else right = `<span class="muted">已是最后一题</span>`;
          footer = `
            <div class="q-bottom-nav">
              <button class="btn btn-outline" data-action="prev-q" ${idx === 0 ? "disabled" : ""}>← 上一题</button>
              ${right}
            </div>`;
        }
        return renderQuestionCard(q, passage, {
          userAns: rec.answers[q.id],
          revealed: isRevealed(rec, q),
          numberLabel: `Question ${q.number} of ${passage.questions.length}`,
          flagged: !!rec.flagged[q.id],
          footerHTML: footer
        });
      })
      .join("");

    const sec = rec.elapsedSeconds || 0;
    const target = state.settings.targetMinutes * 60;
    const answeredCount = passage.questions.filter((q) => rec.answers[q.id]).length;

    return `
      <header class="top-header">
        <div class="brand-area">
          <button class="btn btn-header" data-action="go-dashboard" title="返回题库">←${lbl(" 题库", "")}</button>
          <span class="brand-title" title="${escapeAttr(passage.title)}"><span class="lbl-full">Passage ${passage.number}: </span>${passage.title}</span>
          <span class="mode-badge ${isPractice ? "practice" : ""}">${isPractice ? "练习" : "考试"}</span>
        </div>
        <div class="header-controls">
          <div class="timer-badge ${timerClass(sec)}" id="timer-badge" title="${target ? `目标用时 ${state.settings.targetMinutes} 分钟` : "本篇用时"}">
            <span>⏱</span><span id="header-timer-val">${formatTime(sec)}</span>${target ? `<span class="timer-target lbl-full">/ ${formatTime(target)}</span>` : ""}
          </div>
          <button class="btn btn-header" data-action="toggle-display">
            ${state.displayMode === "single" ? lbl("整卷平铺", "平铺") : lbl("单题模式", "单题")}
          </button>
          ${
            !rec.submitted
              ? `<button class="btn btn-header-primary" data-action="submit">${lbl(isPractice ? "结束本篇" : "交卷看解析", isPractice ? "结束" : "交卷")}</button>`
              : `<button class="btn btn-header" data-action="retry">${lbl("重做本篇", "重做")}</button>`
          }
        </div>
      </header>

      <div class="sub-toolbar">
        <div class="sub-toolbar-left">
          <span class="passage-indicator">
            ${
              state.displayMode === "single"
                ? `Question ${state.currentQuestionIndex + 1} of ${passage.questions.length}`
                : `共 ${passage.questions.length} 题 · 已答 ${answeredCount}`
            }
          </span>
          <div class="q-pills">${pills}</div>
        </div>
        <div class="sub-toolbar-right">
          ${
            state.displayMode === "single"
              ? `<button class="btn btn-outline btn-sm" data-action="prev-q" id="btn-prev-q" ${state.currentQuestionIndex === 0 ? "disabled" : ""}>← 上一题</button>
                 <button class="btn btn-primary btn-sm" data-action="next-q" id="btn-next-q" ${state.currentQuestionIndex === passage.questions.length - 1 ? "disabled" : ""}>下一题 →</button>`
              : `<span class="all-mode-hint">点题号可跳到对应题目</span>`
          }
        </div>
      </div>

      <main class="split-workspace">
        <section class="passage-pane" id="passage-pane">${renderPassagePaper(passage, ctx)}</section>
        <section class="question-pane" id="question-pane">${scoreHTML}${cardsHTML}</section>
      </main>`;
  }

  // ================= MISTAKE BOOK =================
  function renderMistakes() {
    const wrongIds = getWrongIds();
    const flaggedIds = getFlaggedIds();
    const tab = state.mistakeTab;
    const allIds = tab === "flagged" ? flaggedIds : wrongIds;

    // type filter chips with counts
    const typeCounts = {};
    allIds.forEach((id) => {
      const t = questionLookup[id].question.type;
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    if (state.mistakeType !== "all" && !typeCounts[state.mistakeType]) state.mistakeType = "all";
    const ids = allIds.filter(
      (id) => state.mistakeType === "all" || questionLookup[id].question.type === state.mistakeType
    );

    const chips = [`<button class="chip ${state.mistakeType === "all" ? "on" : ""}" data-action="mistake-type" data-type="all">全部 ${allIds.length}</button>`]
      .concat(
        Object.keys(TYPE_SHORT)
          .filter((t) => typeCounts[t])
          .map(
            (t) =>
              `<button class="chip ${state.mistakeType === t ? "on" : ""}" data-action="mistake-type" data-type="${t}">${TYPE_SHORT[t]} ${typeCounts[t]}</button>`
          )
      )
      .join("");

    const items = ids
      .map((id) => {
        const { passage, question: q } = questionLookup[id];
        const m = state.mistakes[id];
        const meta = [];
        if (tab === "wrong" && m) {
          meta.push(`错 ${m.wrongCount} 次`);
          meta.push(m.lastAnswer ? `上次选 ${m.lastAnswer}` : "上次未作答");
        }
        let redoBadge = "";
        const lastRedo = m && m.lastRedo;
        if (lastRedo === "correct") redoBadge = `<span class="status-badge status-completed">重做已答对</span>`;
        else if (lastRedo === "wrong") redoBadge = `<span class="status-badge status-wrong">重做仍错</span>`;
        const removeBtn =
          tab === "wrong"
            ? `<button class="btn btn-outline btn-sm" data-action="remove-mistake" data-qid="${id}">移出</button>`
            : `<button class="btn btn-outline btn-sm" data-action="unflag" data-qid="${id}">取消标记</button>`;
        return `
          <div class="mistake-item">
            <div class="mistake-meta">
              <span class="passage-num-tag">Passage ${passage.number} · Q${q.number}</span>
              <span class="type-chip">${TYPE_SHORT[q.type] || ""}</span>
              <span class="mistake-passage-title">${passage.title}</span>
            </div>
            <div class="mistake-prompt">${q.prompt}</div>
            ${q.insertSentence ? `<div class="mistake-insert">${q.insertSentence}</div>` : ""}
            <div class="mistake-footer">
              <span class="muted">${meta.join(" · ")}</span>
              ${redoBadge}
              <span class="spacer"></span>
              ${removeBtn}
              <button class="btn btn-primary btn-sm" data-action="redo-one" data-qid="${id}">重做</button>
            </div>
          </div>`;
      })
      .join("");

    const empty =
      tab === "wrong"
        ? "还没有错题。交卷后（或练习模式下）答错的题会自动出现在这里。"
        : "还没有标记的题。做题时点题目右上角的 ☆ 标记，就会出现在这里。";

    return `
      <header class="top-header">
        <div class="brand-area">
          <button class="btn btn-header" data-action="go-dashboard" title="返回题库">←${lbl(" 题库", "")}</button>
          <span class="brand-title">错题本</span>
        </div>
      </header>

      <main class="dashboard-container">
        <section class="mistake-head">
          <div class="segmented big">
            <button class="seg-btn ${tab === "wrong" ? "on" : ""}" data-action="mistake-tab" data-tab="wrong">错题 <b>${wrongIds.length}</b></button>
            <button class="seg-btn ${tab === "flagged" ? "on" : ""}" data-action="mistake-tab" data-tab="flagged">标记复查 <b>${flaggedIds.length}</b></button>
          </div>
          ${ids.length ? `<button class="btn btn-primary" data-action="redo-all">全部重做（${ids.length} 题）</button>` : ""}
        </section>
        ${allIds.length ? `<div class="chip-row">${chips}</div>` : ""}
        <section class="mistake-list">
          ${items || `<div class="empty-state">${empty}</div>`}
        </section>
      </main>`;
  }

  // ================= REDO SESSION =================
  function startRedo(ids, source, type) {
    if (!ids.length) return;
    state.redo = { source, type: type || null, queue: ids.slice(), index: 0, answers: {}, finished: false };
    state.view = "redo";
    render();
  }

  function renderRedo() {
    const r = state.redo;
    const total = r.queue.length;

    if (r.finished) {
      const correct = r.queue.filter((id) => r.answers[id] === questionLookup[id].question.answer).length;
      const wrongIds = r.queue.filter((id) => r.answers[id] !== questionLookup[id].question.answer);
      const isType = r.source === "type";
      const back = isType
        ? `<button class="btn btn-outline" data-action="go-types">返回题型列表</button>`
        : `<button class="btn btn-outline" data-action="go-mistakes">返回错题本</button>`;
      const st = isType ? typeStats(r.type) : null;
      return `
        <header class="top-header">
          <div class="brand-area">
            <button class="btn btn-header" data-action="${isType ? "go-types" : "go-mistakes"}">←${lbl(isType ? " 题型专项" : " 错题本", "")}</button>
            <span class="brand-title">${isType ? `${typeName(r.type).zh} · 本组完成` : "重做完成"}</span>
          </div>
        </header>
        <main class="dashboard-container">
          <section class="redo-summary">
            <div class="score-label">${isType ? "本组成绩" : "本轮重做"}</div>
            <div class="score-big">${correct} / ${total}<span class="score-pct">${Math.round((correct / total) * 100)}%</span></div>
            <p class="muted">${
              isType
                ? `${typeName(r.type).zh}累计已做 ${st.done} / ${st.total}，正确率 ${st.done ? Math.round((st.correct / st.done) * 100) : 0}%。做错的题已加入错题本。`
                : "答对的题可以在错题本里点「移出」；仍然做错的题错误次数已加一。"
            }</p>
            <div class="score-actions">
              ${isType ? `<button class="btn btn-primary" data-action="start-type" data-type="${r.type}">再练一组</button>` : ""}
              ${wrongIds.length ? `<button class="btn ${isType ? "btn-outline" : "btn-primary"}" data-action="redo-again">再做一遍做错的（${wrongIds.length} 题）</button>` : ""}
              ${back}
            </div>
          </section>
        </main>`;
    }

    const qid = r.queue[r.index];
    const { passage, question: q } = questionLookup[qid];
    const userAns = r.answers[qid];
    const revealed = !!userAns;
    const rec = getRecord(passage.id);
    const ctx = {
      activeQuestion: q,
      answerFor: (id) => r.answers[id],
      revealed: (qq) => !!r.answers[qq.id],
      showInsertBoxes: q.type === "insert_sentence"
    };

    let extra = "";
    if (revealed && userAns === q.answer && r.source !== "type") {
      if (state.mistakes[qid]) {
        extra = `<div class="redo-extra"><button class="btn btn-outline btn-sm" data-action="remove-mistake" data-qid="${qid}">已掌握，移出错题本</button></div>`;
      } else if (r.source === "wrong") {
        extra = `<div class="redo-extra muted">已移出错题本</div>`;
      }
    }

    const isLast = r.index === total - 1;
    const footer = `
      <div class="q-bottom-nav">
        <button class="btn btn-outline" data-action="redo-prev" ${r.index === 0 ? "disabled" : ""}>← 上一题</button>
        ${
          isLast
            ? `<button class="btn btn-submit" data-action="redo-finish">${r.source === "type" ? "完成本组 ✓" : "完成重做 ✓"}</button>`
            : `<button class="btn btn-primary" data-action="redo-next">下一题 →</button>`
        }
      </div>`;

    return `
      <header class="top-header">
        <div class="brand-area">
          ${
            r.source === "type"
              ? `<button class="btn btn-header" data-action="go-types" title="返回题型专项">←${lbl(" 题型专项", "")}</button>
                 <span class="brand-title">${typeName(r.type).zh}专项</span>`
              : `<button class="btn btn-header" data-action="go-mistakes" title="返回错题本">←${lbl(" 错题本", "")}</button>
                 <span class="brand-title">${r.source === "flagged" ? "标记题重做" : "错题重做"}</span>`
          }
          <span class="mode-badge practice">${r.index + 1} / ${total}</span>
        </div>
      </header>
      <div class="sub-toolbar">
        <div class="sub-toolbar-left">
          <span class="passage-indicator redo-source">Passage ${passage.number}: ${passage.title}</span>
        </div>
        <div class="sub-toolbar-right">
          <div class="redo-progress"><span style="width:${((r.index + (revealed ? 1 : 0)) / total) * 100}%"></span></div>
        </div>
      </div>
      <main class="split-workspace">
        <section class="passage-pane" id="passage-pane">${renderPassagePaper(passage, ctx)}</section>
        <section class="question-pane" id="question-pane">
          ${renderQuestionCard(q, passage, {
            userAns,
            revealed,
            numberLabel: `Passage ${passage.number} · Q${q.number}`,
            flagged: !!rec.flagged[qid],
            footerHTML: footer,
            extraActionsHTML: extra
          })}
        </section>
      </main>`;
  }

  // ================= EVIDENCE HIGHLIGHT =================
  // Wrap evidence sentences in the rendered passage. Works on the DOM so it is
  // independent of other markup (vocabulary highlights, insert squares).
  function normChar(c) {
    if (/\s/.test(c)) return " ";
    if (c === "’" || c === "‘") return "'";
    if (c === "“" || c === "”") return '"';
    if (c === "–" || c === "—") return "-";
    return c.toLowerCase();
  }

  function normalizeText(s) {
    let out = "";
    for (const c of s) {
      const n = normChar(c);
      if (n === " " && (out === "" || out.endsWith(" "))) continue;
      out += n;
    }
    return out.trim();
  }

  function markEvidence(container, phrases) {
    if (!container || !phrases.length) return [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !parent.closest(".passage-paragraph")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".para-marker, .insert-square, .inserted-sentence-preview")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let text = "";
    const map = []; // map[i] = [node, offset] for text[i]
    let node;
    let lastPara = null;
    while ((node = walker.nextNode())) {
      const para = node.parentElement.closest(".passage-paragraph");
      if (para !== lastPara && text && !text.endsWith(" ")) {
        text += " ";
        map.push(null);
      }
      lastPara = para;
      const v = node.nodeValue;
      for (let i = 0; i < v.length; i++) {
        const n = normChar(v[i]);
        if (n === " " && (text === "" || text.endsWith(" "))) continue;
        text += n;
        map.push([node, i]);
      }
    }

    // collect [node, start, end) segments
    const segs = [];
    phrases.forEach((phrase) => {
      const target = normalizeText(phrase);
      if (!target) return;
      const at = text.indexOf(target);
      if (at < 0) {
        console.warn("Evidence not found in passage:", phrase);
        return;
      }
      let cur = null;
      for (let i = at; i < at + target.length; i++) {
        const m = map[i];
        if (!m) continue;
        if (cur && cur.node === m[0] && m[1] === cur.end) {
          cur.end = m[1] + 1;
        } else if (cur && cur.node === m[0]) {
          cur.end = m[1] + 1; // collapsed whitespace inside the same node
        } else {
          if (cur) segs.push(cur);
          cur = { node: m[0], start: m[1], end: m[1] + 1 };
        }
      }
      if (cur) segs.push(cur);
    });

    // wrap from the end of each node backwards so earlier offsets stay valid
    const byNode = new Map();
    segs.forEach((s) => {
      if (!byNode.has(s.node)) byNode.set(s.node, []);
      byNode.get(s.node).push(s);
    });
    const ordered = [];
    byNode.forEach((list) => list.sort((a, b) => b.start - a.start).forEach((s) => ordered.push(s)));
    const marks = [];
    ordered.forEach(({ node: n, start, end }) => {
      const middle = n.splitText(start);
      middle.splitText(end - start);
      const span = document.createElement("span");
      span.className = "evidence-mark";
      middle.parentNode.insertBefore(span, middle);
      span.appendChild(middle);
      marks.push(span);
    });
    return marks;
  }

  // Which question's evidence should be visible right now?
  function evidenceQuestionForView() {
    if (state.view === "redo" && state.redo && !state.redo.finished) {
      const qid = state.redo.queue[state.redo.index];
      return state.redo.answers[qid] ? questionLookup[qid].question : null;
    }
    if (state.view !== "quiz") return null;
    const passage = getCurrentPassage();
    const rec = getRecord(passage.id);
    let q;
    if (state.displayMode === "single") q = passage.questions[state.currentQuestionIndex];
    else q = state.evidenceQ && questionLookup[state.evidenceQ] ? questionLookup[state.evidenceQ].question : null;
    if (!q || !passage.questions.includes(q) || !isRevealed(rec, q)) return null;
    return q;
  }

  // ================= RENDER =================
  let lastScreenKey = null;
  let lastQuestionKey = null;
  let pendingCardScroll = false;
  let pendingEvidenceScroll = false;

  function currentKeys() {
    if (state.view === "quiz") {
      return {
        screen: `quiz|${state.currentPassageId}|${state.displayMode}`,
        question: `quiz|${state.currentPassageId}|${state.currentQuestionIndex}`
      };
    }
    if (state.view === "redo" && state.redo && !state.redo.finished) {
      const qid = state.redo.queue[state.redo.index];
      return { screen: `redo|${questionLookup[qid].passage.id}`, question: `redo|${state.redo.index}` };
    }
    return { screen: state.view, question: state.view };
  }

  function render() {
    const app = document.getElementById("app");
    if (!app) return;

    const oldP = document.getElementById("passage-pane");
    const oldQ = document.getElementById("question-pane");
    const oldMain = document.querySelector(".dashboard-container");
    const savedP = oldP ? oldP.scrollTop : 0;
    const savedQ = oldQ ? oldQ.scrollTop : 0;
    const savedMain = oldMain ? oldMain.scrollTop : 0;

    const keys = currentKeys();
    const sameScreen = keys.screen === lastScreenKey;
    const questionChanged = keys.question !== lastQuestionKey;
    document.body.classList.toggle("site-page", state.view === "home" || state.view === "guide");

    if (state.view === "quiz") {
      app.innerHTML = renderQuiz();
      startTimer();
    } else {
      stopTimer();
      if (state.view === "mistakes") app.innerHTML = renderMistakes();
      else if (state.view === "redo") app.innerHTML = renderRedo();
      else if (state.view === "guide") app.innerHTML = renderGuide();
      else if (state.view === "home") app.innerHTML = renderHome();
      else app.innerHTML = renderDashboard();
    }

    const navView =
      state.view === "quiz" ? "dashboard" : state.view === "redo" ? "mistakes" : state.view;
    document.querySelectorAll("[data-nav]").forEach((el) => {
      const on = el.dataset.nav === navView;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    document.title =
      ({
        home: "托福学术阅读练习 · 中文学习站",
        dashboard: "题库练习 · 托福学术阅读",
        quiz: "答题中 · 托福学术阅读",
        mistakes: "错题本 · 托福学术阅读",
        redo: "专项练习 · 托福学术阅读",
        guide: "使用指南 · 托福学术阅读"
      }[state.view] || "托福学术阅读练习") + "";

    if (!sameScreen) window.scrollTo({ top: 0, behavior: "auto" });

    const pPane = document.getElementById("passage-pane");
    const qPane = document.getElementById("question-pane");
    const main = document.querySelector(".dashboard-container");

    if (sameScreen) {
      if (pPane) pPane.scrollTop = savedP;
      if (qPane) {
        const reset = state.view === "redo" || (state.view === "quiz" && state.displayMode === "single");
        qPane.scrollTop = reset && questionChanged ? 0 : savedQ;
      }
      if (main) main.scrollTop = savedMain;
    }

    // evidence
    const evQ = evidenceQuestionForView();
    const marks = evQ && pPane ? markEvidence(pPane, evidenceList(evQ)) : [];

    if (pendingCardScroll && state.view === "quiz" && state.displayMode === "all") {
      const card = document.querySelector(`.question-card[data-q-index="${state.currentQuestionIndex}"]`);
      if (card && qPane) scrollWithinPane(qPane, card, "start", sameScreen ? "smooth" : "auto");
    }
    pendingCardScroll = false;

    if (pPane) {
      const behavior = sameScreen ? "smooth" : "auto";
      if (marks.length && (pendingEvidenceScroll || questionChanged || !sameScreen)) {
        scrollWithinPane(pPane, marks[0], "center", behavior);
        if (pendingEvidenceScroll) {
          marks.forEach((m) => m.classList.add("flash"));
        }
      } else if (!sameScreen || questionChanged) {
        scrollToActiveHighlight(pPane, behavior);
      }
    }
    pendingEvidenceScroll = false;

    lastScreenKey = keys.screen;
    lastQuestionKey = keys.question;
  }

  function activeQuestionForScroll() {
    if (state.view === "redo") return questionLookup[state.redo.queue[state.redo.index]].question;
    return getCurrentPassage().questions[state.currentQuestionIndex];
  }

  function scrollToActiveHighlight(pane, behavior) {
    const q = activeQuestionForScroll();
    if (!q) return;
    if (q.highlightRef) {
      const el = document.getElementById(`hl-${q.highlightRef}`);
      if (el) return scrollWithinPane(pane, el, "center", behavior);
    }
    if (q.paragraphHint) {
      const el = document.getElementById(`para-${q.paragraphHint}`);
      if (el) return scrollWithinPane(pane, el, "nearest", behavior);
    }
  }

  // Scroll only the given pane (scrollIntoView would also move the page).
  function scrollWithinPane(pane, el, block, behavior) {
    const paneRect = pane.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = r.top - paneRect.top + pane.scrollTop;
    let target;
    if (block === "center") {
      target = top - (pane.clientHeight - r.height) / 2;
    } else if (block === "start") {
      target = top - 12;
    } else {
      const vTop = pane.scrollTop;
      const vBottom = vTop + pane.clientHeight;
      if (top >= vTop && top + r.height <= vBottom) return;
      target = r.height > pane.clientHeight || top < vTop ? top - 12 : top + r.height - pane.clientHeight + 12;
    }
    pane.scrollTo({ top: Math.max(0, target), behavior });
  }

  // ================= CONFIRM DIALOG =================
  // window.confirm is blocked when the page is hosted in a sandboxed frame,
  // so confirmations use an in-page dialog instead.
  function askConfirm(message, okLabel, onOk) {
    const old = document.getElementById("confirm-overlay");
    if (old) old.remove();
    const overlay = document.createElement("div");
    overlay.id = "confirm-overlay";
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true">
        <p class="confirm-msg"></p>
        <div class="confirm-actions">
          <button class="btn btn-outline" data-confirm="cancel">取消</button>
          <button class="btn btn-primary" data-confirm="ok"></button>
        </div>
      </div>`;
    overlay.querySelector(".confirm-msg").textContent = message;
    overlay.querySelector('[data-confirm="ok"]').textContent = okLabel;
    overlay.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-confirm]");
      if (e.target === overlay || btn) {
        e.stopPropagation();
        overlay.remove();
        if (btn && btn.dataset.confirm === "ok") onOk();
      }
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-confirm="ok"]').focus();
  }

  // ================= ACTIONS =================
  function openPassage(pid) {
    state.currentPassageId = pid;
    state.currentQuestionIndex = 0;
    state.evidenceQ = null;
    const rec = getRecord(pid);
    // An untouched passage follows the current mode setting.
    if (!hasProgress(rec)) rec.mode = state.settings.studyMode;
    state.view = "quiz";
    saveState();
    render();
  }

  function chooseAnswer(qid, opt) {
    if (state.view === "redo") {
      const r = state.redo;
      if (r.answers[qid]) return; // locked after answering
      r.answers[qid] = opt;
      const q = questionLookup[qid].question;
      setResult(q, opt);
      const m = state.mistakes[qid];
      if (opt === q.answer) {
        if (m) m.lastRedo = "correct";
      } else if (m) {
        m.lastRedo = "wrong";
        m.wrongCount += 1;
        m.lastAnswer = opt;
      } else {
        recordMistake(q, questionLookup[qid].passage.id, opt);
        state.mistakes[qid].lastRedo = "wrong";
      }
      saveState();
      render();
      return;
    }

    const { passage, question: q, index } = questionLookup[qid];
    const rec = getRecord(passage.id);
    state.currentQuestionIndex = index;
    if (isRevealed(rec, q)) {
      render();
      return;
    }
    rec.answers[qid] = opt;
    if (rec.mode === "practice") {
      rec.revealed[qid] = true;
      recordMistake(q, passage.id, opt);
      setResult(q, opt);
      if (passage.questions.every((qq) => rec.revealed[qq.id])) rec.submitted = true;
    }
    saveState();
    render();
  }

  function submitPassage() {
    const passage = getCurrentPassage();
    const rec = getRecord(passage.id);
    const unanswered = passage.questions.filter((q) => !rec.answers[q.id]).length;
    if (unanswered > 0) {
      askConfirm(`还有 ${unanswered} 道题没有作答，确定现在交卷吗？未作答的题会算作错题。`, "确定交卷", () => doSubmit(passage, rec));
      return;
    }
    doSubmit(passage, rec);
  }

  function doSubmit(passage, rec) {
    passage.questions.forEach((q) => {
      if (!rec.revealed[q.id]) {
        recordMistake(q, passage.id, rec.answers[q.id]);
        setResult(q, rec.answers[q.id]);
      }
    });
    rec.submitted = true;
    saveState();
    render();
    const qPane = document.getElementById("question-pane");
    if (qPane) qPane.scrollTop = 0;
  }

  const actions = {
    "open-passage": (el) => openPassage(el.dataset.pid),
    random: () => {
      const pool = passages.filter((p) => !(state.records[p.id] && state.records[p.id].submitted));
      const list = pool.length ? pool : passages;
      const pick = list[Math.floor(Math.random() * list.length)];
      if (pick) openPassage(pick.id);
    },
    "reset-all": () => {
      askConfirm("确定要清空所有答题记录、成绩和错题本吗？此操作无法撤销。", "清空", () => {
        state.records = {};
        state.mistakes = {};
        state.qResults = {};
        saveState();
        render();
      });
    },
    setting: (el) => {
      const name = el.dataset.name;
      const v = el.dataset.value;
      state.settings[name] = name === "targetMinutes" || name === "groupSize" ? Number(v) : v;
      saveState();
      render();
    },
    "go-home": () => {
      saveState();
      state.view = "home";
      setHash("home");
      render();
    },
    "go-guide": () => {
      saveState();
      state.view = "guide";
      setHash("guide");
      render();
    },
    "go-dashboard": () => {
      saveState();
      state.view = "dashboard";
      setHash("dashboard");
      render();
    },
    "filter-subject": (el) => {
      state.dashSubject = el.dataset.v;
      state.dashStatus = "all";
      state.dashTab = "passages";
      state.view = "dashboard";
      setHash("dashboard");
      render();
    },
    "go-mistakes": () => {
      saveState();
      state.view = "mistakes";
      state.redo = null;
      setHash("mistakes");
      render();
    },
    "toggle-display": () => {
      state.displayMode = state.displayMode === "single" ? "all" : "single";
      saveState();
      render();
    },
    "goto-q": (el) => {
      state.currentQuestionIndex = Number(el.dataset.idx);
      pendingCardScroll = true;
      render();
    },
    "prev-q": () => {
      if (state.currentQuestionIndex > 0) {
        state.currentQuestionIndex--;
        render();
      }
    },
    "next-q": () => {
      if (state.currentQuestionIndex < getCurrentPassage().questions.length - 1) {
        state.currentQuestionIndex++;
        render();
      }
    },
    choose: (el) => chooseAnswer(el.dataset.qid, el.dataset.opt),
    "insert-box": (el) => chooseAnswer(el.dataset.qid, el.dataset.opt),
    flag: (el) => {
      toggleFlag(el.dataset.qid);
      render();
    },
    submit: submitPassage,
    retry: () => {
      askConfirm("确定要清空本篇作答记录并重新练习吗？（错题本不受影响）", "重做本篇", () => {
        const passage = getCurrentPassage();
        const old = getRecord(passage.id);
        const rec = newRecord();
        rec.flagged = old.flagged || {}; // keep review flags
        state.records[passage.id] = rec;
        state.currentQuestionIndex = 0;
        saveState();
        render();
      });
    },
    "show-evidence": (el) => {
      const qid = el.dataset.qid;
      if (state.view === "quiz") {
        state.evidenceQ = qid;
        state.currentQuestionIndex = questionLookup[qid].index;
      }
      pendingEvidenceScroll = true;
      render();
    },
    "dash-subject": (el) => {
      state.dashSubject = el.dataset.v;
      render();
    },
    "dash-status": (el) => {
      state.dashStatus = el.dataset.v;
      render();
    },
    "mistake-tab": (el) => {
      state.mistakeTab = el.dataset.tab;
      state.mistakeType = "all";
      render();
    },
    "mistake-type": (el) => {
      state.mistakeType = el.dataset.type;
      render();
    },
    "remove-mistake": (el) => {
      delete state.mistakes[el.dataset.qid];
      saveState();
      render();
    },
    unflag: (el) => {
      toggleFlag(el.dataset.qid);
      render();
    },
    "redo-one": (el) => startRedo([el.dataset.qid], state.mistakeTab),
    "redo-all": () => {
      const ids = mistakeIdsForTab(state.mistakeTab).filter(
        (id) => state.mistakeType === "all" || questionLookup[id].question.type === state.mistakeType
      );
      startRedo(ids, state.mistakeTab);
    },
    "redo-prev": () => {
      if (state.redo.index > 0) {
        state.redo.index--;
        render();
      }
    },
    "redo-next": () => {
      if (state.redo.index < state.redo.queue.length - 1) {
        state.redo.index++;
        render();
      }
    },
    "redo-finish": () => {
      state.redo.finished = true;
      render();
    },
    "redo-again": () => {
      const r = state.redo;
      const ids = r.queue.filter((id) => r.answers[id] !== questionLookup[id].question.answer);
      startRedo(ids, r.source, r.type);
    },
    "dash-tab": (el) => {
      state.dashTab = el.dataset.v;
      saveState();
      render();
    },
    "go-types": () => {
      state.view = "dashboard";
      state.dashTab = "types";
      state.redo = null;
      setHash("dashboard");
      saveState();
      render();
    },
    "start-type": (el) => {
      const type = el.dataset.type;
      startRedo(pickTypeGroup(type, state.settings.groupSize), "type", type);
    }
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  document.addEventListener("DOMContentLoaded", () => {
    loadState();
    const initial = (location.hash || "").replace(/^#/, "");
    if (HASH_VIEWS.includes(initial)) state.view = initial;
    render();
  });

  window.addEventListener("hashchange", () => {
    const target = (location.hash || "").replace(/^#/, "");
    if (!HASH_VIEWS.includes(target) || target === state.view) return;
    state.view = target;
    if (target === "mistakes") state.redo = null;
    render();
  });
})();
