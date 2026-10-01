/*
 * NestHire — Project Kickoff & Team Alignment deck generator.
 *
 * Source of content: the kickoff brief only (no NestHire project documents,
 * brand files, team roster or code were available when this was built).
 * Every item the brief does not establish is labelled on the slide as
 * PLANNED / PROPOSED / NEEDS CONFIRMATION / FUTURE VISION.
 *
 * Usage:  node build_deck.js [output.pptx]
 * Needs:  pptxgenjs, jszip, react, react-dom, react-icons, sharp
 */
const path = require('path');
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const Lu = require('react-icons/lu');

const OUT = process.argv[2] || path.join(__dirname, 'NestHire_Project_Kickoff_2026.pptx');

// ---------------------------------------------------------------------------
// Placeholder theme. No official NestHire brand guidelines were provided —
// replace these tokens with the official palette once it is confirmed.
// ---------------------------------------------------------------------------
const C = {
  ink: '0B1F2A', ink2: '15303E', teal: '0F766E', tealD: '115E59', mint: '5EEAD4',
  tint: 'E8F3F2', tint2: 'F4F8F8', line: 'D3E2E0', text: '1E293B', slate: '52606D',
  muted: '7F8F9C', onDark: 'C5D3DA', onDark2: '93A9B5', white: 'FFFFFF',
  coral: 'D9532F', coralT: 'FBE9E3', grey: 'EEF2F6', greyB: 'CBD5E1', greyT: '94A3B8',
  amberBg: 'FCEFC0', amberTx: '6F4500', violetBg: 'ECE6FA', violetTx: '553A9E',
  blueBg: 'E2EBF8', blueTx: '1F4E8C',
};
const FONT = 'Arial';
const X0 = 0.6;
const CW = 12.133;
const TOTAL = 28;

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
pres.author = 'NestHire Team';
pres.company = 'NestHire';
pres.title = 'NestHire — Project Kickoff & Team Alignment';
pres.subject = 'Internal kickoff and team alignment (draft v0.1)';
const SH = pres.shapes;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const iconCache = new Map();
async function icon(name, color) {
  const key = `${name}-${color}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const Comp = Lu[name];
  if (!Comp) throw new Error(`Unknown icon ${name}`);
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: `#${color}`, size: 256 }));
  const buf = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  const data = 'image/png;base64,' + buf.toString('base64');
  iconCache.set(key, data);
  return data;
}

const altFor = (name) => `${name.replace(/^Lu/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase()} icon`;

function T(s, text, x, y, w, h, o = {}) {
  s.addText(text, Object.assign({
    x, y, w, h, fontFace: FONT, fontSize: 12, color: C.text, margin: 0, valign: 'top', isTextBox: true,
  }, o));
}

const shadow = () => ({ type: 'outer', color: '0B1F2A', opacity: 0.1, blur: 7, offset: 2, angle: 90 });

function box(s, x, y, w, h, o = {}) {
  const opts = { x, y, w, h, fill: { color: o.fill || C.white } };
  if (o.line) opts.line = { color: o.line, width: o.lineW || 0.75, dashType: o.dash || 'solid' };
  if (o.shadow) opts.shadow = shadow();
  if (o.square) {
    s.addShape(SH.RECTANGLE, opts);
  } else {
    opts.rectRadius = o.r === undefined ? 0.08 : o.r;
    s.addShape(SH.ROUNDED_RECTANGLE, opts);
  }
}

async function iconCircle(s, name, x, y, d, bg, fg, pad = 0.24) {
  s.addShape(SH.OVAL, { x, y, w: d, h: d, fill: { color: bg } });
  const p = d * pad;
  s.addImage({ data: await icon(name, fg), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, altText: altFor(name) });
}

async function iconImg(s, name, x, y, d, color) {
  s.addImage({ data: await icon(name, color), x, y, w: d, h: d, altText: altFor(name) });
}

function arrow(s, x1, y1, x2, y2, color, o = {}) {
  const opts = {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    line: { color, width: o.width || 1.25, dashType: o.dash || 'solid' },
  };
  if (o.head !== false) opts.line.endArrowType = 'triangle';
  if (x2 < x1) opts.flipH = true;
  if (y2 < y1) opts.flipV = true;
  s.addShape(SH.LINE, opts);
}

const CHIP = {
  planned: [C.tint, C.tealD], proposed: [C.blueBg, C.blueTx], confirm: [C.amberBg, C.amberTx],
  vision: [C.violetBg, C.violetTx], target: [C.tint, C.tealD], grey: [C.grey, C.slate],
  coral: [C.coral, C.white], ink: [C.ink, C.mint], done: [C.teal, C.white], mint: [C.mint, C.ink],
};
const chipW = (text, size = 8.5) => 0.28 + text.length * size * 0.0108;
function chip(s, x, y, text, kind = 'planned', o = {}) {
  const size = o.size || 8.5;
  const w = o.w || chipW(text, size);
  const h = o.h || 0.28;
  let xx = x;
  if (o.alignRight) xx = x - w;
  if (o.center) xx = x - w / 2;
  const [bg, fg] = CHIP[kind];
  s.addShape(SH.ROUNDED_RECTANGLE, { x: xx, y, w, h, fill: { color: bg }, rectRadius: h / 2 });
  T(s, text, xx, y, w, h, { fontSize: size, bold: true, color: fg, align: 'center', valign: 'middle', charSpacing: 0.5 });
  return w;
}

function footer(s, n, dark = false) {
  const col = dark ? '6E8A99' : C.muted;
  T(s, 'NESTHIRE  ·  Project Kickoff & Team Alignment  ·  Draft v0.1, built from the kickoff brief', X0, 7.05, 9, 0.25,
    { fontSize: 8.5, color: col });
  T(s, `${String(n).padStart(2, '0')} / ${TOTAL}`, 11.233, 7.05, 1.5, 0.25, { fontSize: 8.5, color: col, align: 'right' });
}

function header(s, { kicker, title, lede, chip: ch, dark = false }) {
  T(s, kicker, X0, 0.42, 8, 0.28, { fontSize: 10.5, bold: true, color: dark ? C.mint : C.teal, charSpacing: 3 });
  T(s, title, X0, 0.7, 10.2, 0.7, { fontSize: 30, bold: true, color: dark ? C.white : C.ink, valign: 'middle' });
  if (lede) T(s, lede, X0, 1.42, 11.8, 0.5, { fontSize: 14, color: dark ? C.onDark : C.slate });
  if (ch) chip(s, 12.733, 0.42, ch[0], ch[1], { alignRight: true });
}

function note(s, text, y = 6.66) {
  T(s, text, X0, y, CW, 0.28, { fontSize: 9.5, italic: true, color: C.muted });
}

function table(s, x, y, colW, head, rows, o = {}) {
  const fs = o.fontSize || 11;
  const hdr = head.map((t) => ({
    text: t, options: { bold: true, color: C.white, fill: { color: C.ink }, fontSize: fs - 1, valign: 'middle', charSpacing: 0.5 },
  }));
  const body = rows.map((r, i) => r.map((t, j) => ({
    text: t,
    options: {
      fill: { color: i % 2 ? C.tint2 : C.white }, color: j === 0 ? C.tealD : C.text,
      bold: j === 0 || (o.boldCol === j), fontSize: fs, valign: 'middle',
    },
  })));
  s.addTable([hdr, ...body], {
    x, y, w: colW.reduce((a, b) => a + b, 0), colW,
    rowH: [o.headH || 0.4, ...rows.map(() => o.rowH || 0.5)],
    fontFace: FONT, border: { type: 'solid', pt: 0.75, color: C.line }, margin: o.margin || [0.04, 0.09, 0.04, 0.09],
  });
}

// Speaker notes: Arabic (the meeting language), with English product terms.
const timing = [];
function notes(s, n, min, say, idea, stress, next, extra) {
  timing[n] = min;
  const end = timing.reduce((a, b) => a + (b || 0), 0);
  const hh = Math.floor(end / 60);
  const mm = String(end % 60).padStart(2, '0');
  const parts = [
    `الوقت المقترح: ${min} ${min === 1 ? 'دقيقة' : min === 2 ? 'دقيقتان' : 'دقائق'} — ننتهي من هذه الشريحة عند ${hh}:${mm}`,
    '',
    '1) ماذا يقول قائد الاجتماع:',
    say,
    '',
    '2) الفكرة التي يجب أن يفهمها الفريق:',
    idea,
    '',
    '3) النقطة التي يجب التأكيد عليها:',
    stress,
    '',
    '4) الانتقال إلى الشريحة التالية:',
    next,
  ];
  if (extra) parts.push('', extra);
  s.addNotes(parts.join('\n'));
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------
async function build() {
  let s;
  let n = 0;

  // 01 — COVER ---------------------------------------------------------------
  s = pres.addSlide(); n++;
  s.background = { color: C.ink };
  box(s, X0, 0.6, 2.7, 0.62, { fill: C.ink, line: '3B6170', dash: 'dash', r: 0.06 });
  T(s, 'Official NestHire logo — Needs Confirmation', X0 + 0.1, 0.6, 2.5, 0.62,
    { fontSize: 9, color: C.onDark2, align: 'center', valign: 'middle' });
  T(s, 'NESTHIRE', X0, 1.95, 8.4, 1.1, { fontSize: 64, bold: true, color: C.white, charSpacing: 6, valign: 'middle' });
  T(s, 'AI-Powered Recruitment & Talent Intelligence Platform', X0, 3.08, 8.6, 0.45, { fontSize: 19, color: C.mint });
  T(s, 'Project Kickoff & Team Alignment', X0, 3.9, 8.4, 0.6, { fontSize: 30, bold: true, color: C.white });
  T(s, 'Internal team meeting  ·  2026  ·  Team only', X0, 4.6, 8, 0.35, { fontSize: 13, color: C.onDark2 });
  chip(s, X0, 6.2, 'DRAFT v0.1', 'confirm');
  T(s, 'Built from the kickoff brief — to be validated against NestHire project documents.', X0 + 1.3, 6.2, 7.2, 0.28,
    { fontSize: 10.5, color: C.onDark2, valign: 'middle' });
  // Right: the proposed NestHire path as a vertical motif
  const path8 = ['Requirements', 'Evidence', 'Skills', 'Experience', 'Assessments', 'Interviews', 'Explainable Analysis', 'Human Decision'];
  T(s, 'THE PROPOSED NESTHIRE PATH', 9.55, 0.62, 3.2, 0.25, { fontSize: 9, bold: true, color: C.onDark2, charSpacing: 2 });
  s.addShape(SH.LINE, { x: 9.75, y: 1.2, w: 0, h: 5.15, line: { color: '2E5566', width: 1.5 } });
  path8.forEach((label, i) => {
    const cy = 1.2 + i * 0.735;
    const last = i === path8.length - 1;
    const d = last ? 0.32 : 0.2;
    s.addShape(SH.OVAL, { x: 9.75 - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: last ? C.coral : C.mint } });
    T(s, label, 10.1, cy - 0.17, 2.7, 0.34, {
      fontSize: last ? 14 : 12.5, bold: last, color: last ? 'F28C6B' : C.onDark, valign: 'middle',
    });
  });
  notes(s, n, 1,
    '«أهلًا بالجميع. هذا هو الاجتماع الرسمي لانطلاق مشروع NestHire. هدفنا اليوم ليس عرض منتج جاهز — لا يوجد منتج بعد. هدفنا أن نخرج جميعًا بفهم واحد لما سنبنيه، ولماذا، وكيف، ومن يملك كل جزء.»',
    'هذا اجتماع مواءمة داخلي للفريق، وليس عرضًا تسويقيًا ولا عرضًا للمستثمرين.',
    'NestHire لم يبدأ تطويره بعد. كل ما في هذا العرض هو تصميم مستهدف وخطة مقترحة. لاحظوا الوسوم على الشرائح: Planned و Proposed و Needs Confirmation و Future Vision.',
    '«قبل أن نتحدث عن المنتج، دعونا نتفق على سبب وجودنا هنا اليوم.»',
    'تحضير قبل الاجتماع: استبدل مربع الشعار بالشعار الرسمي، وطبّق ألوان الهوية الرسمية إن وُجدت (الألوان الحالية مؤقتة)، وحدّث رقم الإصدار بعد مراجعة المحتوى مقابل وثائق المشروع.');
  footer(s, n, true);

  // 02 — WHY ARE WE HERE? ----------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '01 · KICKOFF PURPOSE', title: 'Why Are We Here?',
    lede: 'One goal: everyone leaves this room aligned and ready to start building NestHire.',
  });
  const goals = [
    ['Align our understanding', 'One shared picture of NestHire — no private versions.'],
    ['Clarify the NestHire vision', 'Where NestHire is heading in the long term.'],
    ['Understand the full product', 'Users, modules and the end-to-end flow.'],
    ['Understand how the system will work', 'From job requirements to a human decision.'],
    ['Define what each discipline owns', 'Responsibilities, deliverables, dependencies.'],
    ['Agree on how we work', 'Workflow, GitHub, reviews and task management.'],
    ['Get ready to execute', 'Leave with Sprint 1 and clear next steps.'],
  ];
  goals.forEach(([t, d], i) => {
    const y = 2.12 + i * 0.64;
    s.addShape(SH.OVAL, { x: X0, y: y + 0.08, w: 0.44, h: 0.44, fill: { color: C.teal } });
    T(s, String(i + 1), X0, y + 0.08, 0.44, 0.44, { fontSize: 13, bold: true, color: C.white, align: 'center', valign: 'middle' });
    T(s, [
      { text: t, options: { fontSize: 15, bold: true, color: C.ink, breakLine: true } },
      { text: d, options: { fontSize: 11.5, color: C.slate } },
    ], X0 + 0.65, y, 6.4, 0.6, { valign: 'middle' });
  });
  box(s, 8.0, 2.12, 4.733, 4.45, { fill: C.ink, r: 0.1 });
  T(s, 'BY THE END OF TODAY, EVERYONE CAN ANSWER:', 8.35, 2.38, 4.1, 0.55, { fontSize: 11.5, bold: true, color: C.mint, charSpacing: 1 });
  const qs = ['What are we building?', 'Why are we building it?', 'Who are we building it for?', 'How will it work?',
    'What are we building first?', 'What is my role?', 'How will we work?', 'What happens after this meeting?'];
  for (let i = 0; i < qs.length; i++) {
    const y = 3.05 + i * 0.425;
    await iconImg(s, 'LuCircleCheck', 8.35, y + 0.07, 0.26, C.mint);
    T(s, qs[i], 8.75, y, 3.8, 0.4, { fontSize: 14, color: C.white, valign: 'middle' });
  }
  notes(s, n, 3,
    '«لدينا سبعة أهداف اليوم [اقرأ العناوين بسرعة]. وعلى اليمين ثمانية أسئلة: في نهاية الاجتماع يجب أن يستطيع كل واحد منكم الإجابة عنها بجملة أو جملتين، دون الرجوع لأحد.»',
    'الاجتماع ناجح فقط إذا خرج كل عضو قادرًا على الإجابة عن الأسئلة الثمانية.',
    'أي سؤال خارج نطاق اليوم يُسجَّل في «Parking Lot» ونعود إليه في نهاية الاجتماع أو بعده، حتى نلتزم بالوقت.',
    '«لنبدأ بأهم نقطة: أين نحن الآن بالضبط؟»',
    'خطة الوقت (Run of Show): السياق 0:00–0:10 · المشكلة والحل والمنتج 0:10–0:25 · الذكاء والمفاهيم الأساسية 0:25–0:38 · المبادئ 0:38–0:42 · المعمارية 0:42–0:46 · الفريق والمسؤوليات 0:46–0:53 · التنفيذ وSprint 1 0:53–1:07 · التوقعات والقرارات والخطوات التالية 1:07–1:15 · أسئلة 10–15 دقيقة. إذا كان الوقت 60 دقيقة فقط: اختصر الشرائح 10–14 إلى 6 دقائق والشرائح 19–20 إلى دقيقتين.');
  footer(s, n);

  // 03 — WHERE WE ARE NOW ----------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '01 · CONTEXT', title: 'Where We Are Now',
    lede: 'Idea and planning are in place and the team is formed. Development has not started — it starts after this kickoff.',
  });
  const stages = [
    { t: 'Idea & Planning', c: ['COMPLETE / CURRENT', 'done'], d: 'Vision defined; initial planning and research done.', st: 'done', ic: 'LuCheck' },
    { t: 'Team', c: ['FORMED', 'done'], d: 'Disciplines in place; roles confirmed today.', st: 'done', ic: 'LuUsers' },
    { t: 'Kickoff', c: ['TODAY', 'coral'], d: 'Align on product, roles and way of working.', st: 'now', ic: 'LuFlag' },
    { t: 'Development', c: ['NOT STARTED YET', 'grey'], d: 'No product code, models or infrastructure yet.', st: 'todo', ic: 'LuCode' },
    { t: 'Execution', c: ['STARTS AFTER KICKOFF', 'grey'], d: 'Sprint 1 begins once roles are assigned.', st: 'todo', ic: 'LuRocket' },
  ];
  const cxs = stages.map((_, i) => X0 + 1.213 + i * 2.427);
  s.addShape(SH.LINE, { x: cxs[0], y: 2.5, w: cxs[2] - cxs[0], h: 0, line: { color: C.teal, width: 2.5 } });
  s.addShape(SH.LINE, { x: cxs[2], y: 2.5, w: cxs[4] - cxs[2], h: 0, line: { color: C.greyB, width: 2, dashType: 'dash' } });
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i];
    const cx = cxs[i];
    const d = st.st === 'now' ? 0.64 : 0.52;
    if (st.st === 'todo') {
      s.addShape(SH.OVAL, { x: cx - d / 2, y: 2.5 - d / 2, w: d, h: d, fill: { color: C.white }, line: { color: C.greyB, width: 1.5 } });
      await iconImg(s, st.ic, cx - 0.14, 2.36, 0.28, C.greyT);
    } else {
      await iconCircle(s, st.ic, cx - d / 2, 2.5 - d / 2, d, st.st === 'now' ? C.coral : C.teal, C.white);
    }
    T(s, st.t, cx - 1.15, 2.98, 2.3, 0.35, { fontSize: 15, bold: true, color: st.st === 'todo' ? C.slate : C.ink, align: 'center' });
    chip(s, cx, 3.38, st.c[0], st.c[1], { center: true });
    T(s, st.d, cx - 1.1, 3.78, 2.2, 0.6, { fontSize: 11, color: C.slate, align: 'center' });
  }
  box(s, X0, 4.62, 5.92, 1.5, { fill: C.tint });
  await iconImg(s, 'LuCircleCheck', X0 + 0.25, 4.8, 0.3, C.teal);
  T(s, 'In place today', X0 + 0.65, 4.8, 4, 0.3, { fontSize: 14, bold: true, color: C.tealD, valign: 'middle' });
  T(s, [
    { text: 'NestHire idea and vision', options: { bullet: true, breakLine: true } },
    { text: 'Initial planning and research', options: { bullet: true, breakLine: true } },
    { text: 'A formed, multi-disciplinary team', options: { bullet: true } },
  ], X0 + 0.3, 5.18, 5.4, 0.85, { fontSize: 12.5, color: C.text, paraSpaceAfter: 2 });
  box(s, 6.813, 4.62, 5.92, 1.5, { fill: C.grey });
  await iconImg(s, 'LuHourglass', 6.813 + 0.25, 4.8, 0.3, C.slate);
  T(s, 'Not started yet', 6.813 + 0.65, 4.8, 4, 0.3, { fontSize: 14, bold: true, color: C.slate, valign: 'middle' });
  T(s, [
    { text: 'Product development (web, mobile, backend)', options: { bullet: true, breakLine: true } },
    { text: 'AI / ML modules and models', options: { bullet: true, breakLine: true } },
    { text: 'Infrastructure and deployment', options: { bullet: true } },
  ], 6.813 + 0.3, 5.18, 5.4, 0.85, { fontSize: 12.5, color: C.text, paraSpaceAfter: 2 });
  // Legend: how to read the labels in this deck
  T(s, 'HOW TO READ THIS DECK', X0, 6.4, 2.0, 0.28, { fontSize: 9, bold: true, color: C.slate, charSpacing: 1, valign: 'middle' });
  let lx = X0 + 2.05;
  [['PLANNED', 'planned', 'not built yet'], ['PROPOSED', 'proposed', 'to agree'],
    ['NEEDS CONFIRMATION', 'confirm', 'not yet validated'], ['FUTURE VISION', 'vision', 'long-term']].forEach(([c, k, d]) => {
    const w = chip(s, lx, 6.4, c, k);
    const dw2 = 0.12 + d.length * 0.058;
    T(s, d, lx + w + 0.08, 6.4, dw2, 0.28, { fontSize: 9.5, color: C.slate, valign: 'middle' });
    lx += w + 0.08 + dw2 + 0.25;
  });
  notes(s, n, 3,
    '«قبل أي شيء، لنكن واضحين جدًا: أين نحن؟ الفكرة والرؤية موجودة، وتم جزء من التخطيط والبحث، والفريق تشكّل. لكن التطوير لم يبدأ: لا يوجد كود للمنتج، ولا نماذج، ولا بنية تحتية. التنفيذ يبدأ بعد هذا الاجتماع.»',
    'نحن عند نقطة الانتقال من التخطيط إلى التنفيذ — اليوم هو خط البداية.',
    'أي Prototype أو تجربة سابقة (إن وُجدت) هي للتعلّم فقط وليست بداية التطوير الرسمي. واشرح دليل القراءة أسفل الشريحة: Planned = ميزة مقصودة لم تُبنَ، Proposed = توصية تحتاج اتفاقًا، Needs Confirmation = معلومة لم يتم التحقق منها، Future Vision = اتجاه طويل المدى.',
    '«إذًا، ما الذي نريد أن نصل إليه على المدى الطويل؟»');
  footer(s, n);

  // 04 — THE BIG VISION ------------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '01 · CONTEXT', title: 'The Big Vision', chip: ['FUTURE VISION', 'vision'],
    lede: 'Where we want NestHire to go — and what makes it more than a CV matching system.',
  });
  box(s, X0, 2.12, 4.6, 4.45, { fill: C.ink, r: 0.1 });
  T(s, 'VISION — DRAFT WORDING', X0 + 0.35, 2.4, 3.9, 0.3, { fontSize: 10, bold: true, color: C.mint, charSpacing: 2 });
  T(s, 'Hiring decisions grounded in evidence, explained clearly, and made by people.', X0 + 0.35, 2.8, 3.95, 1.75,
    { fontSize: 22, bold: true, color: C.white });
  T(s, 'Long term: an AI-powered recruitment and talent intelligence platform that helps teams understand real skills and experience — not just keywords.',
    X0 + 0.35, 4.55, 3.95, 1.1, { fontSize: 12.5, color: C.onDark });
  chip(s, X0 + 0.35, 5.95, 'NEEDS CONFIRMATION', 'confirm');
  T(s, 'Final wording from project documents', X0 + 0.35, 6.25, 3.9, 0.25, { fontSize: 9.5, color: C.onDark2 });
  // Comparison
  const cx0 = 5.55;
  const colL = 1.45; const colO = 2.55; const colN = 3.073; const gap = 0.11;
  T(s, 'Typical CV matching', cx0 + colL + gap, 2.12, colO, 0.42, { fontSize: 12, bold: true, color: C.slate, align: 'center', valign: 'middle' });
  box(s, cx0 + colL + gap * 2 + colO, 2.12, colN, 0.42, { fill: C.teal, r: 0.06 });
  T(s, 'NestHire — future vision', cx0 + colL + gap * 2 + colO, 2.12, colN, 0.42, { fontSize: 12, bold: true, color: C.white, align: 'center', valign: 'middle' });
  const cmp = [
    ['STARTS FROM', 'Resume text', 'Job requirements + candidate evidence'],
    ['LOOKS AT', 'Keyword overlap', 'Skills, experience, assessments and interviews'],
    ['PRODUCES', 'A match score', 'An explainable analysis: evidence, gaps, confidence'],
    ['DECISION', 'Often implied by the score', 'Made by people — AI assists'],
  ];
  cmp.forEach(([l, o, nn], i) => {
    const y = 2.66 + i * 0.98;
    T(s, l, cx0, y, colL, 0.88, { fontSize: 10, bold: true, color: C.teal, charSpacing: 1, valign: 'middle' });
    box(s, cx0 + colL + gap, y, colO, 0.88, { fill: C.grey, r: 0.06 });
    T(s, o, cx0 + colL + gap + 0.18, y, colO - 0.36, 0.88, { fontSize: 13, color: C.slate, valign: 'middle' });
    box(s, cx0 + colL + gap * 2 + colO, y, colN, 0.88, { fill: C.tint, r: 0.06 });
    T(s, nn, cx0 + colL + gap * 2 + colO + 0.18, y, colN - 0.36, 0.88, { fontSize: 13, bold: true, color: C.ink, valign: 'middle' });
  });
  notes(s, n, 3,
    '«رؤيتنا باختصار: قرارات توظيف مبنية على الأدلة، مفسَّرة بوضوح، ويتخذها البشر. NestHire ليس مجرد نظام يطابق السيرة الذاتية مع الوظيفة. انظروا للمقارنة: النظام التقليدي يبدأ من نص السيرة الذاتية، يبحث عن كلمات، ويعطي رقمًا. نحن نريد أن نبدأ من متطلبات الوظيفة وأدلة المرشح، ونفهم المهارات والخبرة والتقييمات والمقابلات، وننتج تحليلًا قابلًا للتفسير — والقرار يبقى للإنسان.»',
    'الفرق الجوهري: Evidence + Explanation + Human Decision بدلًا من Keywords + Score.',
    'صياغة الرؤية هنا مسودة مشتقة من ملخص المشروع (Needs Confirmation). سنعتمد الصياغة الرسمية من وثائق المشروع. هذه رؤية مستقبلية وليست وصفًا لشيء موجود.',
    '«لماذا نحتاج هذا أصلًا؟ ما المشكلة التي نحلها؟»');
  footer(s, n);

  // 05 — THE PROBLEM ---------------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '02 · THE PROBLEM', title: 'The Problem',
    lede: 'What makes hiring hard today — the gaps NestHire is meant to close.',
  });
  const probs = [
    ['LuFileText', 'Over-reliance on the CV', 'Decisions lean on what is written, not on what is proven.'],
    ['LuSearch', 'Keyword matching', 'Matching words is not the same as understanding fit.'],
    ['LuBriefcase', 'Real experience is hard to read', 'The depth and context of experience get lost.'],
    ['LuFileSearch', 'Evidence is hard to verify', 'Claims are rarely linked to supporting evidence.'],
    ['LuHourglass', 'Manual evaluation', 'Reviewing candidates by hand is slow and inconsistent.'],
    ['LuScale', 'Hard to compare candidates', 'There is no common, structured basis for comparison.'],
    ['LuEyeOff', 'Little or no explanation', 'Some hiring systems give results without the why.'],
  ];
  const pw = 2.808; const ph = 2.05;
  for (let i = 0; i < probs.length; i++) {
    const [ic, t, d] = probs[i];
    const x = X0 + (i % 4) * (pw + 0.3);
    const y = 2.1 + Math.floor(i / 4) * (ph + 0.25);
    box(s, x, y, pw, ph, { fill: C.white, line: C.line, shadow: true });
    await iconCircle(s, ic, x + 0.25, y + 0.25, 0.55, C.tint, C.teal);
    T(s, String(i + 1).padStart(2, '0'), x + pw - 0.75, y + 0.25, 0.5, 0.3, { fontSize: 11, bold: true, color: C.greyT, align: 'right' });
    T(s, t, x + 0.25, y + 0.92, pw - 0.5, 0.55, { fontSize: 14.5, bold: true, color: C.ink, valign: 'middle' });
    T(s, d, x + 0.25, y + 1.47, pw - 0.5, 0.5, { fontSize: 11, color: C.slate });
  }
  {
    const x = X0 + 3 * (pw + 0.3); const y = 2.1 + ph + 0.25;
    box(s, x, y, pw, ph, { fill: C.ink });
    T(s, 'THE CORE GAP', x + 0.25, y + 0.25, pw - 0.5, 0.3, { fontSize: 10, bold: true, color: C.mint, charSpacing: 2 });
    T(s, 'Hiring decisions are often made on claims and keywords — without evidence or a clear why.', x + 0.25, y + 0.6, pw - 0.5, 1.3,
      { fontSize: 14.5, bold: true, color: C.white });
  }
  note(s, 'Problem list from the kickoff brief — to be validated against NestHire research documents. No statistics are shown because none were provided.');
  notes(s, n, 3,
    '«هذه سبع مشكلات في التوظيف اليوم: الاعتماد الكبير على السيرة الذاتية، المطابقة بالكلمات المفتاحية، صعوبة فهم الخبرة الفعلية، صعوبة التحقق من الأدلة، التقييم اليدوي، صعوبة مقارنة المرشحين، ونقص التفسير في بعض الأنظمة. القاسم المشترك: القرارات تُبنى غالبًا على ادعاءات وكلمات، بدون أدلة وبدون «لماذا» واضحة.»',
    'كل ميزة في NestHire يجب أن ترتبط بواحدة على الأقل من هذه المشكلات. إذا لم ترتبط بأي منها، نسأل: لماذا نبنيها؟',
    'لم نضع أي إحصائيات أو أرقام عن قصد — لا نستخدم أرقامًا غير موثّقة. القائمة من ملخص المشروع وتحتاج تحققًا مقابل وثائق البحث.',
    '«كيف سيحل NestHire هذه المشكلات؟»');
  footer(s, n);

  // 06 — THE NESTHIRE SOLUTION -----------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '02 · THE SOLUTION', title: 'The NestHire Solution', chip: ['PLANNED', 'planned'],
    lede: 'Move from matching keywords on a resume to an evidence-based, explainable picture — and leave the decision to people.',
  });
  T(s, 'FROM', X0, 2.15, 0.9, 0.5, { fontSize: 12, bold: true, color: C.slate, charSpacing: 2, valign: 'middle' });
  ['Resume', 'Keywords', 'Match'].forEach((t, i) => {
    const x = 1.6 + i * 2.0;
    box(s, x, 2.15, 1.6, 0.5, { fill: C.grey, r: 0.25 });
    T(s, t, x, 2.15, 1.6, 0.5, { fontSize: 13, color: C.slate, align: 'center', valign: 'middle' });
    if (i < 2) arrow(s, x + 1.65, 2.4, x + 1.95, 2.4, C.greyT);
  });
  T(s, 'Typical approach: words in, score out.', 7.6, 2.15, 5, 0.5, { fontSize: 12, italic: true, color: C.muted, valign: 'middle' });
  T(s, 'TO', X0, 2.95, 2, 0.3, { fontSize: 12, bold: true, color: C.teal, charSpacing: 2 });
  const to = ['Requirements', 'Evidence', 'Skills', 'Experience', 'Assessments', 'Interviews', 'Explainable Analysis', 'Human Decision'];
  const nw = 1.3; const ng = (CW - 8 * nw) / 7;
  to.forEach((t, i) => {
    const x = X0 + i * (nw + ng);
    const human = i === to.length - 1;
    box(s, x, 3.3, nw, 1.0, { fill: human ? C.coral : C.teal, r: 0.08 });
    T(s, t, x + 0.05, 3.3, nw - 0.1, 1.0, { fontSize: 11.5, bold: true, color: C.white, align: 'center', valign: 'middle' });
    if (i < to.length - 1) arrow(s, x + nw + 0.03, 3.8, x + nw + ng - 0.03, 3.8, C.teal);
  });
  const shifts = [
    ['From claims', 'To evidence', 'Every finding should point back to evidence: projects, experience, assessments, interviews.'],
    ['From scores', 'To explanations', 'Show why: which requirements are supported, what is missing, how confident we are.'],
    ['From automation', 'To human decisions', 'AI organizes and explains. People review and make the hiring decision.'],
  ];
  const sw = (CW - 0.6) / 3;
  shifts.forEach(([from, toT, d], i) => {
    const x = X0 + i * (sw + 0.3);
    box(s, x, 4.65, sw, 1.9, { fill: C.tint2, line: C.line });
    T(s, `SHIFT ${i + 1}`, x + 0.3, 4.83, 2, 0.25, { fontSize: 9.5, bold: true, color: C.teal, charSpacing: 2 });
    T(s, [
      { text: from, options: { fontSize: 12, color: C.muted, breakLine: true } },
      { text: `→ ${toT}`, options: { fontSize: 16, bold: true, color: C.ink } },
    ], x + 0.3, 5.1, sw - 0.6, 0.62);
    T(s, d, x + 0.3, 5.8, sw - 0.6, 0.68, { fontSize: 11.5, color: C.slate });
  });
  notes(s, n, 3,
    '«الفكرة الأساسية هي تغيير المسار. بدلًا من: Resume → Keywords → Match، نريد: Requirements → Evidence → Skills → Experience → Assessments → Interviews → Explainable Analysis → Human Decision. وهذا يعني ثلاثة تحولات: من الادعاءات إلى الأدلة، من الأرقام إلى التفسيرات، ومن الأتمتة إلى قرار بشري.»',
    'آخر خطوة في السلسلة دائمًا قرار بشري — هذا ليس تفصيلًا، بل جزء من تعريف المنتج.',
    'هذا هو الحل المقترح وكل مكوناته Planned — لم يُنفَّذ أي جزء منه بعد.',
    '«لمن نبني هذا الحل؟»');
  footer(s, n);

  // 07 — WHO IS NESTHIRE FOR? ------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '02 · USERS', title: 'Who Is NestHire For?', chip: ['NEEDS CONFIRMATION', 'confirm'],
    lede: 'User groups named in the kickoff brief. Personas, priorities and first-release scope still need confirmation.',
  });
  T(s, 'HIRING ORGANIZATION', X0, 2.08, 5, 0.28, { fontSize: 10, bold: true, color: C.teal, charSpacing: 2 });
  const org = [
    ['LuBuilding2', 'Companies', 'Organizations that adopt NestHire for their hiring.'],
    ['LuUsers', 'HR Teams', 'Run consistent, explainable hiring processes.'],
    ['LuUserCheck', 'Recruiters', 'Review evidence-based analysis and move candidates forward.'],
    ['LuBriefcase', 'Hiring Managers', 'Review the analysis and take part in the hiring decision.'],
  ];
  for (let i = 0; i < org.length; i++) {
    const [ic, t, d] = org[i];
    const x = X0 + i * (2.808 + 0.3);
    box(s, x, 2.42, 2.808, 1.95, { fill: C.white, line: C.line, shadow: true });
    await iconCircle(s, ic, x + 0.25, 2.65, 0.55, C.teal, C.white);
    T(s, t, x + 0.25, 3.3, 2.3, 0.35, { fontSize: 16, bold: true, color: C.ink });
    T(s, d, x + 0.25, 3.67, 2.3, 0.62, { fontSize: 11.5, color: C.slate });
  }
  const lower = [
    ['CANDIDATES', 'LuIdCard', 'Candidates', 'Share CV, projects, assessments and interviews — evaluated on evidence, not keywords.', 'CANDIDATE-FACING SCOPE: TBC'],
    ['PLATFORM', 'LuUserCog', 'Administrators', 'Manage the platform: users, roles, permissions and settings.', null],
  ];
  for (let i = 0; i < lower.length; i++) {
    const [lab, ic, t, d, c] = lower[i];
    const x = X0 + i * (5.917 + 0.3);
    T(s, lab, x, 4.62, 4, 0.28, { fontSize: 10, bold: true, color: C.teal, charSpacing: 2 });
    box(s, x, 4.96, 5.917, 1.3, { fill: C.white, line: C.line, shadow: true });
    await iconCircle(s, ic, x + 0.25, 5.2, 0.55, i === 0 ? C.ink : C.slate, C.white);
    T(s, t, x + 1.0, 5.18, 2.6, 0.35, { fontSize: 16, bold: true, color: C.ink });
    T(s, d, x + 1.0, 5.56, 4.65, 0.75, { fontSize: 11.5, color: C.slate });
    if (c) chip(s, x + 5.917 - 0.2, 5.2, c, 'confirm', { alignRight: true, size: 8 });
  }
  notes(s, n, 2,
    '«المستخدمون حسب ملخص المشروع: من جهة المؤسسة — الشركات، فرق الموارد البشرية، Recruiters، و Hiring Managers. ثم المرشحون. ثم مسؤولو النظام (Administrators).»',
    'لكل فئة احتياج مختلف؛ الواجهات والصلاحيات وتجربة الاستخدام ستختلف حسب الفئة.',
    'الـPersonas وأولوية كل فئة في الإصدار الأول تحتاج تأكيدًا — خاصة: هل للمرشح واجهة خاصة به في الإصدار الأول؟ هذا قرار مفتوح سنعود له في شريحة القرارات المفتوحة. الأوصاف المختصرة على البطاقات مسودة.',
    '«ماذا سيستخدم هؤلاء؟ لننظر إلى المنتج ككل.»');
  footer(s, n);

  // 08 — THE NESTHIRE PRODUCT ------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '02 · PRODUCT', title: 'The NestHire Product', chip: ['PLANNED', 'planned'],
    lede: 'Eleven planned modules in four groups. None are built yet — boundaries will be finalized in the product specification.',
  });
  const groups = [
    ['CORE RECRUITMENT', [['LuWorkflow', 'Recruitment', 'Hiring pipeline and stages'], ['LuBriefcase', 'Jobs', 'Job creation and requirements'], ['LuIdCard', 'Candidates', 'Candidate records and profiles']]],
    ['EVALUATION', [['LuPuzzle', 'Skills', 'Skills linked to evidence'], ['LuLayers', 'Experience', 'Experience in its context'], ['LuClipboardCheck', 'Assessments', 'Assessment results as evidence'], ['LuMic', 'Interviews', 'Interview inputs as evidence']]],
    ['INTELLIGENCE', [['LuBrain', 'Intelligence', 'Evidence extraction and analysis'], ['LuEye', 'Explainability', 'Reasons, evidence, gaps, confidence'], ['LuBot', 'Recruiter Copilot', 'AI assistant']]],
    ['PLATFORM', [['LuSettings', 'Admin', 'Users, roles and settings']]],
  ];
  const gw = 2.8; const gg = (CW - 4 * gw) / 3;
  for (let gi = 0; gi < groups.length; gi++) {
    const [gname, mods] = groups[gi];
    const x = X0 + gi * (gw + gg);
    box(s, x, 2.08, gw, 0.48, { fill: gi === 2 ? C.teal : C.ink, r: 0.06 });
    T(s, gname, x, 2.08, gw, 0.48, { fontSize: 10.5, bold: true, color: C.white, align: 'center', valign: 'middle', charSpacing: 2 });
    for (let j = 0; j < mods.length; j++) {
      const [ic, t, d] = mods[j];
      const y = 2.7 + j * 0.97;
      box(s, x, y, gw, 0.85, { fill: C.white, line: C.line });
      await iconCircle(s, ic, x + 0.15, y + 0.19, 0.46, C.tint, C.teal);
      T(s, t, x + 0.75, y + 0.11, gw - 0.85, 0.32, { fontSize: 13.5, bold: true, color: C.ink, valign: 'middle' });
      T(s, t === 'Recruiter Copilot' ? [
        { text: `${d} · `, options: { color: C.slate } },
        { text: 'scope TBC', options: { color: C.amberTx, bold: true } },
      ] : d, x + 0.75, y + 0.44, gw - 0.85, 0.34, { fontSize: 10.5, color: C.slate });
    }
  }
  {
    const x = X0 + 3 * (gw + gg);
    box(s, x, 3.67, gw, 2.85, { fill: C.amberBg, r: 0.08 });
    await iconImg(s, 'LuTriangleAlert', x + 0.2, 3.87, 0.32, C.amberTx);
    T(s, 'NEEDS CONFIRMATION', x + 0.62, 3.87, gw - 0.75, 0.32, { fontSize: 10, bold: true, color: C.amberTx, valign: 'middle', charSpacing: 1 });
    T(s, [
      { text: 'Module list is from the kickoff brief.', options: { bullet: true, breakLine: true } },
      { text: 'Final module boundaries.', options: { bullet: true, breakLine: true } },
      { text: 'Which modules form the first release (MVP).', options: { bullet: true, breakLine: true } },
      { text: 'Recruiter Copilot scope and phase.', options: { bullet: true } },
    ], x + 0.2, 4.32, gw - 0.4, 2.1, { fontSize: 11, color: C.amberTx, paraSpaceAfter: 4 });
  }
  notes(s, n, 3,
    '«المنتج مقسّم إلى 11 وحدة في أربع مجموعات: Core Recruitment (Recruitment و Jobs و Candidates)، و Evaluation (Skills و Experience و Assessments و Interviews)، و Intelligence (Intelligence و Explainability و Recruiter Copilot)، و Platform (Admin).»',
    'هذه خريطة المنتج التي سنشتق منها الـEpics والمهام بعد الاجتماع.',
    'كل الوحدات Planned ولا شيء منها مبني. حدود الوحدات، ونطاق Recruiter Copilot، وما يدخل في الـMVP — كلها تحتاج تأكيدًا. الوصف المختصر تحت كل وحدة مسودة للنقاش.',
    '«كيف تعمل هذه الوحدات معًا من البداية للنهاية؟»');
  footer(s, n);

  // 09 — HOW NESTHIRE WORKS --------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '02 · HOW IT WORKS', title: 'How NestHire Works', chip: ['PROPOSED PRODUCT FLOW', 'proposed'],
    lede: 'The proposed end-to-end flow. No stage is implemented yet — this is what we will build toward.',
  });
  const steps = [
    ['Job Requirements', 'What the role needs', 'in'],
    ['Candidate Data', 'CV, projects, experience', 'in'],
    ['Evidence Extraction', 'Pull evidence from candidate data', 'ai'],
    ['Skill & Experience Intelligence', 'Map evidence to skills and experience', 'ai'],
    ['Assessment Intelligence', 'Assessment results as evidence', 'ai'],
    ['Interview Intelligence', 'Interview inputs as evidence', 'ai'],
    ['Explainable Analysis', 'Requirements vs evidence, with reasons', 'ai'],
    ['Confidence & Fairness Checks', 'How reliable? Is it fair?', 'check'],
    ['Recruiter Review', 'People review the analysis', 'human'],
    ['Human Decision', 'People make the decision', 'human'],
  ];
  const sty = {
    in: { fill: C.grey, line: C.greyB, tx: C.ink, sub: C.slate, nb: C.slate, nt: C.white },
    ai: { fill: C.teal, tx: C.white, sub: 'D5F0EC', nb: C.white, nt: C.teal },
    check: { fill: C.ink, tx: C.white, sub: C.onDark, nb: C.mint, nt: C.ink },
    human: { fill: C.coral, tx: C.white, sub: 'FDE3DA', nb: C.white, nt: C.coral },
  };
  const fw = 2.067; const fg = (CW - 5 * fw) / 4; const fh = 1.42;
  steps.forEach(([t, d, k], i) => {
    const row = Math.floor(i / 5); const col = i % 5;
    const x = X0 + col * (fw + fg); const y = row === 0 ? 2.15 : 4.3;
    const st = sty[k];
    box(s, x, y, fw, fh, { fill: st.fill, line: st.line });
    s.addShape(SH.OVAL, { x: x + 0.15, y: y + 0.14, w: 0.32, h: 0.32, fill: { color: st.nb } });
    T(s, String(i + 1), x + 0.15, y + 0.14, 0.32, 0.32, { fontSize: 10.5, bold: true, color: st.nt, align: 'center', valign: 'middle' });
    T(s, t, x + 0.15, y + 0.52, fw - 0.3, 0.46, { fontSize: 12.5, bold: true, color: st.tx, valign: 'middle' });
    T(s, d, x + 0.15, y + 0.99, fw - 0.3, 0.38, { fontSize: 10, color: st.sub });
    if (col < 4) arrow(s, x + fw + 0.05, y + fh / 2, x + fw + fg - 0.05, y + fh / 2, C.greyT);
  });
  {
    const x5c = X0 + 4 * (fw + fg) + fw / 2; const x6c = X0 + fw / 2;
    s.addShape(SH.LINE, { x: x5c, y: 2.15 + fh, w: 0, h: 0.37, line: { color: C.greyT, width: 1.25 } });
    s.addShape(SH.LINE, { x: x6c, y: 3.94, w: x5c - x6c, h: 0, line: { color: C.greyT, width: 1.25 } });
    arrow(s, x6c, 3.94, x6c, 4.27, C.greyT);
  }
  let lgx = X0;
  [['Input', C.grey, C.greyB], ['AI-assisted (planned)', C.teal], ['Safeguard', C.ink], ['Human', C.coral]].forEach(([t, f, l]) => {
    box(s, lgx, 6.1, 0.26, 0.26, { fill: f, line: l, r: 0.04 });
    T(s, t, lgx + 0.36, 6.06, 2.2, 0.34, { fontSize: 11, color: C.slate, valign: 'middle' });
    lgx += 0.36 + t.length * 0.085 + 0.45;
  });
  T(s, 'Steps 9 and 10 are always done by people.', 7.733, 6.06, 5, 0.34, { fontSize: 11, bold: true, color: C.coral, align: 'right', valign: 'middle' });
  notes(s, n, 4,
    '«هذا هو الـFlow المقترح من البداية للنهاية في عشر خطوات. نبدأ بمتطلبات الوظيفة وبيانات المرشح (Inputs). ثم خطوات يساعد فيها الـAI: استخراج الأدلة، ذكاء المهارات والخبرة، ذكاء التقييمات، ذكاء المقابلات، ثم التحليل القابل للتفسير. بعدها خطوة حماية: فحوص الثقة والعدالة. وأخيرًا خطوتان بشريتان بالكامل: مراجعة الـRecruiter، ثم القرار البشري.»',
    'الألوان توضح من يقوم بماذا: رمادي = مدخلات، أخضر مزرق = بمساعدة AI، داكن = ضمانات، برتقالي = بشر.',
    'لا توجد مرحلة منفذة. اطلب من كل تخصص أن يحدد أين يقع عمله على هذا الـFlow: «أنا أعمل على أي خطوة؟»',
    '«لنفصّل أول جزء: كيف يفهم NestHire الوظيفة؟»');
  footer(s, n);

  // 10 — JOB INTELLIGENCE ----------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '03 · INTELLIGENCE', title: 'Job Intelligence', chip: ['PLANNED', 'planned'],
    lede: 'How NestHire should understand a job before it looks at any candidate.',
  });
  box(s, X0, 2.12, 2.25, 3.98, { fill: C.ink, r: 0.1 });
  await iconImg(s, 'LuFileText', X0 + 0.3, 2.45, 0.6, C.mint);
  T(s, 'Job Description', X0 + 0.3, 3.2, 1.8, 0.7, { fontSize: 17, bold: true, color: C.white });
  T(s, 'Unstructured text written by the hiring team.', X0 + 0.3, 3.95, 1.75, 1.0, { fontSize: 11.5, color: C.onDark });
  const jel = [
    ['LuListChecks', 'Requirements', 'Conditions the role must meet'],
    ['LuPuzzle', 'Skills', 'Technical and professional skills'],
    ['LuLayers', 'Experience', 'Type and depth of experience'],
    ['LuClipboardCheck', 'Responsibilities', 'What the person will actually do'],
    ['LuTarget', 'Competencies', 'Capabilities the role demands'],
  ];
  for (let i = 0; i < jel.length; i++) {
    const [ic, t, d] = jel[i];
    const y = 2.12 + i * 0.82;
    box(s, 3.3, y, 3.75, 0.7, { fill: C.tint, r: 0.06 });
    await iconImg(s, ic, 3.45, y + 0.19, 0.32, C.teal);
    T(s, t, 3.95, y + 0.07, 3.0, 0.3, { fontSize: 14, bold: true, color: C.tealD, valign: 'middle' });
    T(s, d, 3.95, y + 0.37, 3.0, 0.28, { fontSize: 10.5, color: C.slate, valign: 'middle' });
    arrow(s, X0 + 2.28, y + 0.35, 3.27, y + 0.35, C.teal);
  }
  s.addShape(SH.RIGHT_ARROW, { x: 7.2, y: 3.85, w: 0.45, h: 0.5, fill: { color: C.teal } });
  T(s, 'Structured Job Profile', 7.85, 2.12, 4.9, 0.4, { fontSize: 17, bold: true, color: C.ink });
  T(s, 'Used later to:', 7.85, 2.52, 4.9, 0.3, { fontSize: 11.5, color: C.slate });
  const uses = [
    ['Set the baseline', 'Every candidate is analyzed against the same requirements.'],
    ['Drive explainable matching', 'Show which requirements are supported, partial or missing.'],
    ['Compare consistently', 'Candidates are compared on the same structured criteria.'],
  ];
  uses.forEach(([t, d], i) => {
    const y = 2.92 + i * 0.9;
    s.addShape(SH.OVAL, { x: 7.85, y: y + 0.05, w: 0.38, h: 0.38, fill: { color: C.teal } });
    T(s, String(i + 1), 7.85, y + 0.05, 0.38, 0.38, { fontSize: 12, bold: true, color: C.white, align: 'center', valign: 'middle' });
    T(s, [
      { text: t, options: { fontSize: 13.5, bold: true, color: C.ink, breakLine: true } },
      { text: d, options: { fontSize: 11, color: C.slate } },
    ], 8.4, y, 4.33, 0.8);
  });
  box(s, 7.85, 5.68, 4.883, 0.82, { fill: C.amberBg, r: 0.08 });
  T(s, [
    { text: 'NEEDS CONFIRMATION  ', options: { bold: true, fontSize: 9.5, charSpacing: 1 } },
    { text: 'How requirements are weighted (must-have vs nice-to-have) and who reviews the extracted profile.', options: { fontSize: 11 } },
  ], 8.05, 5.68, 4.5, 0.82, { color: C.amberTx, valign: 'middle' });
  notes(s, n, 2,
    '«قبل أن ننظر لأي مرشح، يجب أن نفهم الوظيفة. الوصف الوظيفي نص غير منظّم. يُفترض أن يحوّله NestHire إلى ملف وظيفي منظّم: المتطلبات، المهارات، الخبرة، المسؤوليات، والكفاءات. هذا الملف يصبح الأساس الذي نقارن عليه كل المرشحين.»',
    'جودة تحليل المرشحين لاحقًا تعتمد على جودة فهم الوظيفة أولًا.',
    'سؤال مفتوح مهم: كيف نوزن المتطلبات (Must-have مقابل Nice-to-have)؟ ومن يراجع الملف المستخرج قبل استخدامه؟ — Needs Confirmation.',
    '«والآن الطرف الآخر: كيف نفهم المرشح؟»');
  footer(s, n);

  // 11 — CANDIDATE INTELLIGENCE ----------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '03 · INTELLIGENCE', title: 'Candidate Intelligence', chip: ['TARGET DESIGN', 'target'],
    lede: 'How NestHire should build an evidence-based understanding of each candidate.',
  });
  const cin = [
    ['LuFileText', 'CV'], ['LuFileCode', 'Projects'], ['LuBriefcase', 'Experience'], ['LuPuzzle', 'Skills'],
    ['LuFiles', 'Evidence (supporting material)'], ['LuClipboardCheck', 'Assessments'], ['LuMic', 'Interviews'],
  ];
  const conv = 4.21;
  for (let i = 0; i < cin.length; i++) {
    const [ic, t] = cin[i];
    const y = 2.12 + i * 0.605; const yc = y + 0.25;
    box(s, X0, y, 2.9, 0.5, { fill: C.white, line: C.line, r: 0.25 });
    await iconImg(s, ic, X0 + 0.17, y + 0.1, 0.3, C.teal);
    T(s, t, X0 + 0.6, y, 2.25, 0.5, { fontSize: 12, bold: true, color: C.ink, valign: 'middle' });
    if (Math.abs(yc - conv) < 0.01) {
      s.addShape(SH.LINE, { x: 3.5, y: yc, w: 1.05, h: 0, line: { color: C.greyB, width: 1 } });
    } else {
      s.addShape(SH.LINE, { x: 3.5, y: Math.min(yc, conv), w: 1.05, h: Math.abs(conv - yc), flipV: yc > conv, line: { color: C.greyB, width: 1 } });
    }
  }
  box(s, 4.55, 2.12, 4.2, 4.18, { fill: C.ink, r: 0.1 });
  T(s, 'Candidate Evidence Profile', 4.85, 2.35, 3.6, 0.8, { fontSize: 20, bold: true, color: C.white });
  T(s, 'One structured view per candidate', 4.85, 3.15, 3.6, 0.3, { fontSize: 11, color: C.onDark2 });
  const prof = ['Skills, each linked to its evidence', 'Experience in its context', 'Assessment and interview signals', 'Gaps and missing information', 'Confidence for each finding'];
  for (let i = 0; i < prof.length; i++) {
    const y = 3.6 + i * 0.5;
    await iconImg(s, 'LuCircleCheck', 4.85, y + 0.07, 0.26, C.mint);
    T(s, prof[i], 5.22, y, 3.4, 0.4, { fontSize: 12.5, color: C.white, valign: 'middle' });
  }
  T(s, 'Why it matters', 9.05, 2.12, 3.68, 0.35, { fontSize: 15, bold: true, color: C.ink });
  T(s, [
    { text: 'A view built from evidence, not a copy of the CV.', options: { bullet: true, breakLine: true } },
    { text: 'Feeds explainable matching against the job profile.', options: { bullet: true, breakLine: true } },
    { text: 'Makes gaps visible, so people know what to check.', options: { bullet: true } },
  ], 9.05, 2.55, 3.68, 2.3, { fontSize: 12, color: C.slate, paraSpaceAfter: 8 });
  box(s, 9.05, 5.12, 3.683, 1.18, { fill: C.amberBg, r: 0.08 });
  T(s, [
    { text: 'NEEDS CONFIRMATION', options: { bold: true, fontSize: 9.5, charSpacing: 1, breakLine: true } },
    { text: 'Accepted input types, formats and data sources. Nothing here is implemented.', options: { fontSize: 11 } },
  ], 9.25, 5.12, 3.3, 1.18, { color: C.amberTx, valign: 'middle' });
  notes(s, n, 2,
    '«على الجانب الآخر نجمع كل ما يخص المرشح: السيرة الذاتية، المشاريع، الخبرة، المهارات، أدلة داعمة أخرى، نتائج التقييمات، والمقابلات. كل هذا يتجمع في Candidate Evidence Profile: مهارات مرتبطة بأدلتها، خبرة في سياقها، إشارات التقييم والمقابلة، الفجوات والمعلومات الناقصة، ومستوى الثقة لكل استنتاج.»',
    'الملف مبني على الأدلة، وليس نسخة من السيرة الذاتية.',
    'هذا تصميم مستهدف (Target Design) وليس نظامًا منفذًا. أنواع المدخلات والصيغ ومصادر البيانات تحتاج تأكيدًا.',
    '«وهذا يقودنا إلى المفهوم الأساسي: Evidence-Based Employment.»');
  footer(s, n);

  // 12 — EVIDENCE-BASED EMPLOYMENT -------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '03 · CORE CONCEPT', title: 'Evidence-Based Employment', chip: ['CORE CONCEPT', 'ink'],
    lede: 'Every conclusion NestHire shows must trace from a claim, through evidence, to a decision made by people.',
  });
  const ladder = [
    ['CLAIM', 'What the candidate states.', '“I have 3 years of Python experience.”', C.slate],
    ['EVIDENCE', 'Material that supports or contradicts the claim.', 'Project repositories, role history, an assessment result.', C.teal],
    ['INFERENCE', 'What the system concludes from the evidence.', '“Python skill is supported by 2 projects and 1 assessment.”', C.teal],
    ['CONFIDENCE', 'How reliable that conclusion is, given the evidence.', '“Medium — interview evidence not yet available.”', C.teal],
    ['DECISION', 'What the hiring team decides to do.', '“Advance to technical interview.”', C.coral],
  ];
  const lw = (CW - 4 * 0.3) / 5;
  ladder.forEach(([t, def, ex, col], i) => {
    const x = X0 + i * (lw + 0.3);
    box(s, x, 2.12, lw, 3.3, { fill: C.white, line: C.line, square: true, shadow: true });
    box(s, x, 2.12, lw, 0.68, { fill: col, square: true });
    T(s, `${i + 1}  ${t}`, x + 0.18, 2.12, lw - 0.3, 0.68, { fontSize: 15, bold: true, color: C.white, valign: 'middle', charSpacing: 1 });
    T(s, def, x + 0.18, 2.95, lw - 0.36, 0.85, { fontSize: 13, bold: true, color: C.ink });
    T(s, 'EXAMPLE', x + 0.18, 3.95, lw - 0.36, 0.25, { fontSize: 9, bold: true, color: C.muted, charSpacing: 2 });
    T(s, ex, x + 0.18, 4.22, lw - 0.36, 1.1, { fontSize: 12, italic: true, color: C.slate });
    if (i < 4) s.addShape(SH.ISOSCELES_TRIANGLE, { x: x + lw + 0.09, y: 2.36, w: 0.12, h: 0.2, rotate: 90, fill: { color: C.greyT } });
  });
  const bands = [
    [0, 1, 'CANDIDATE', C.grey, C.slate],
    [1, 3, 'AI ASSISTS — organizes evidence, infers, rates confidence', C.tint, C.tealD],
    [4, 1, 'HUMAN DECIDES', C.coralT, C.coral],
  ];
  bands.forEach(([start, span, t, f, tc]) => {
    const x = X0 + start * (lw + 0.3);
    const w = span * lw + (span - 1) * 0.3;
    box(s, x, 5.62, w, 0.5, { fill: f, r: 0.06 });
    T(s, t, x, 5.62, w, 0.5, { fontSize: 10.5, bold: true, color: tc, align: 'center', valign: 'middle', charSpacing: 1 });
  });
  note(s, 'Examples are illustrative only — not real data and not product output.');
  notes(s, n, 4,
    '«هذه أهم شريحة مفاهيمية. خمس كلمات يجب أن نستخدمها جميعًا بنفس المعنى: Claim — ما يقوله المرشح. Evidence — ما يدعم هذا الادعاء أو ينفيه. Inference — ما يستنتجه النظام من الأدلة. Confidence — مدى موثوقية هذا الاستنتاج. Decision — ما يقرره فريق التوظيف. [اقرأ المثال التوضيحي من اليسار لليمين].»',
    'كل نتيجة يعرضها NestHire يجب أن تكون قابلة للتتبع: من الادعاء، إلى الدليل، إلى الاستنتاج، إلى الثقة، إلى قرار بشري.',
    'هذه المصطلحات ستدخل في الـData Model والـAPI والواجهة. Backend و AI و ML و UI/UX يجب أن يستخدموها بنفس التعريف بالضبط. المثال توضيحي فقط وليس مخرجات منتج.',
    '«كيف يظهر هذا للمستخدم؟ من خلال Explainable Matching.»');
  footer(s, n);

  // 13 — EXPLAINABLE MATCHING ------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '03 · INTELLIGENCE', title: 'Explainable Matching', chip: ['PLANNED', 'planned'],
    lede: 'A score alone is not an answer. NestHire should help people understand every analysis it shows.',
  });
  box(s, X0, 2.12, 3.6, 4.38, { fill: C.grey, r: 0.1 });
  T(s, 'SCORE ONLY', X0 + 0.3, 2.35, 3, 0.3, { fontSize: 10, bold: true, color: C.slate, charSpacing: 2 });
  T(s, '78%', X0, 2.8, 3.6, 1.2, { fontSize: 66, bold: true, color: C.greyT, align: 'center', valign: 'middle' });
  T(s, 'Match score', X0, 4.0, 3.6, 0.35, { fontSize: 13, color: C.slate, align: 'center' });
  await iconImg(s, 'LuX', X0 + 0.3, 4.75, 0.34, C.coral);
  T(s, 'Says how much — never why.', X0 + 0.75, 4.7, 2.7, 0.45, { fontSize: 14, bold: true, color: C.ink, valign: 'middle' });
  T(s, 'Illustrative number only.', X0 + 0.3, 5.95, 3, 0.3, { fontSize: 9.5, italic: true, color: C.muted });
  s.addShape(SH.RIGHT_ARROW, { x: 4.36, y: 4.06, w: 0.45, h: 0.5, fill: { color: C.teal } });
  const xq = [
    ['LuCircleHelp', 'Why did this analysis appear?', 'The reasoning behind the result.'],
    ['LuListChecks', 'Which requirements are supported?', 'A requirement-by-requirement view.'],
    ['LuLink', 'What is the evidence?', 'Each finding links to its source.'],
    ['LuTriangleAlert', 'What information is missing?', 'Gaps are shown, not hidden.'],
    ['LuGauge', 'What is the confidence level?', 'How reliable the evidence is.'],
    ['LuUserCheck', 'Where is human review needed?', 'Clear flags for people to check.'],
  ];
  const qw = (7.783 - 0.5) / 3;
  for (let i = 0; i < xq.length; i++) {
    const [ic, q, a] = xq[i];
    const x = 4.95 + (i % 3) * (qw + 0.25);
    const y = 2.12 + Math.floor(i / 3) * 2.28;
    box(s, x, y, qw, 2.1, { fill: C.white, line: C.line, shadow: true });
    await iconCircle(s, ic, x + 0.22, y + 0.22, 0.52, C.tint, C.teal);
    T(s, q, x + 0.22, y + 0.88, qw - 0.44, 0.62, { fontSize: 14, bold: true, color: C.ink, valign: 'middle' });
    T(s, a, x + 0.22, y + 1.52, qw - 0.44, 0.45, { fontSize: 11, color: C.slate });
  }
  notes(s, n, 2,
    '«رقم مثل 78% لا يقول لماذا. NestHire يجب أن يجيب عن ستة أسئلة لكل تحليل: لماذا ظهر هذا التحليل؟ ما المتطلبات المدعومة؟ ما الأدلة؟ ما المعلومات الناقصة؟ ما مستوى الثقة؟ وأين نحتاج مراجعة بشرية؟»',
    'الشرح جزء من المنتج نفسه، وليس إضافة نضعها في النهاية.',
    'الرقم 78% توضيحي فقط. هذه الأسئلة الستة مرشحة لتصبح Acceptance Criteria لوحدة Explainability.',
    '«ومن بين هذه الأسئلة، سؤال الثقة يحتاج قاعدة واضحة جدًا.»');
  footer(s, n);

  // 14 — CONFIDENCE ≠ CANDIDATE QUALITY --------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '03 · CORE RULE', title: 'Confidence ≠ Candidate Quality', chip: ['CORE RULE', 'ink'],
    lede: 'A rule every discipline must respect — in models, in the interface, and in how we talk about results.',
  });
  box(s, X0, 2.1, 7.3, 1.6, { fill: C.ink, r: 0.1 });
  T(s, 'CONFIDENCE SCORE', X0 + 0.4, 2.3, 6, 0.3, { fontSize: 10.5, bold: true, color: C.mint, charSpacing: 2 });
  T(s, '= Reliability of the available evidence', X0 + 0.4, 2.65, 6.7, 0.8, { fontSize: 25, bold: true, color: C.white, valign: 'middle' });
  box(s, 8.2, 2.1, 4.533, 1.6, { fill: C.grey, line: C.greyB, dash: 'dash', r: 0.1 });
  T(s, 'IT IS NOT', 8.55, 2.3, 3, 0.3, { fontSize: 10.5, bold: true, color: C.coral, charSpacing: 2 });
  T(s, 'A Candidate Quality Score', 8.55, 2.65, 4.0, 0.8, { fontSize: 21, bold: true, color: C.greyT, strike: 'sngStrike', valign: 'middle' });
  T(s, 'LOW CONFIDENCE MAY MEAN…', X0, 4.0, 6, 0.3, { fontSize: 10.5, bold: true, color: C.teal, charSpacing: 2 });
  const low = [
    ['LuCircleHelp', 'Missing information', 'Key details are not in the data.'],
    ['LuFileSearch', 'Weak evidence', 'Claims are not well supported yet.'],
    ['LuDatabase', 'Insufficient data', 'Too little input to judge reliably.'],
    ['LuUserCheck', 'Human review', 'A person should look before acting.'],
  ];
  for (let i = 0; i < low.length; i++) {
    const [ic, t, d] = low[i];
    const x = X0 + i * (2.808 + 0.3);
    box(s, x, 4.38, 2.808, 1.2, { fill: C.white, line: C.line, shadow: true });
    await iconCircle(s, ic, x + 0.2, 4.6, 0.5, C.tint, C.teal);
    T(s, t, x + 0.85, 4.55, 1.85, 0.4, { fontSize: 13.5, bold: true, color: C.ink, valign: 'middle' });
    T(s, d, x + 0.85, 4.97, 1.85, 0.5, { fontSize: 10.5, color: C.slate });
  }
  box(s, X0, 5.82, CW, 0.72, { fill: C.coralT, r: 0.08 });
  await iconImg(s, 'LuTriangleAlert', X0 + 0.25, 6.0, 0.36, C.coral);
  T(s, [
    { text: '…not necessarily a weak candidate. ', options: { bold: true, color: C.coral } },
    { text: 'Low confidence means: gather more evidence or involve a person — never a verdict on the candidate.', options: { color: C.ink } },
  ], X0 + 0.8, 5.82, CW - 1.0, 0.72, { fontSize: 14, valign: 'middle' });
  notes(s, n, 3,
    '«قاعدة لا نقاش فيها: Confidence Score يقيس موثوقية الأدلة المتوفرة — وليس جودة المرشح. الثقة المنخفضة قد تعني معلومات ناقصة، أو أدلة ضعيفة، أو بيانات غير كافية، أو حاجة لمراجعة بشرية. ولا تعني بالضرورة أن المرشح ضعيف.»',
    'الثقة المنخفضة = اجمع أدلة أكثر أو أشرك إنسانًا. وليست حكمًا على الشخص.',
    'هذه القاعدة تؤثر على كل التخصصات: ML في طريقة حساب الثقة، UI/UX في طريقة عرضها (لا نعرضها أبدًا كتقييم للمرشح)، Backend في طريقة تخزينها، والتسويق في طريقة الحديث عنها.',
    '«وهذه القاعدة جزء من مبدأ أكبر…»');
  footer(s, n);

  // 15 — AI ASSISTS. HUMANS DECIDE. ------------------------------------------
  s = pres.addSlide(); n++;
  s.background = { color: C.ink };
  T(s, '04 · PRINCIPLES', X0, 0.42, 8, 0.28, { fontSize: 10.5, bold: true, color: C.mint, charSpacing: 3 });
  T(s, 'AI Assists. Humans Decide.', X0, 0.72, 11, 0.85, { fontSize: 40, bold: true, color: C.white, valign: 'middle' });
  T(s, 'One of NestHire’s most important principles. It shapes the product, the models and the interface.', X0, 1.6, 11.5, 0.4,
    { fontSize: 14, color: C.onDark });
  box(s, X0, 2.3, 6.0, 4.25, { fill: C.ink2, r: 0.1 });
  await iconImg(s, 'LuSparkles', X0 + 0.35, 2.52, 0.34, C.mint);
  T(s, 'AI HELPS WITH', X0 + 0.8, 2.52, 4, 0.34, { fontSize: 12.5, bold: true, color: C.mint, valign: 'middle', charSpacing: 2 });
  const aiHelps = [
    ['LuChartBar', 'Analysis', 'Structured analysis against the job requirements'],
    ['LuFileSearch', 'Extraction', 'Pulling evidence from CVs, projects and other inputs'],
    ['LuScale', 'Comparison', 'Consistent comparison on the same criteria'],
    ['LuMessageSquare', 'Explanation', 'Showing reasons, evidence, gaps and confidence'],
    ['LuFolderKanban', 'Evidence organization', 'Keeping evidence linked and easy to review'],
  ];
  for (let i = 0; i < aiHelps.length; i++) {
    const [ic, t, d] = aiHelps[i];
    const y = 3.05 + i * 0.68;
    await iconCircle(s, ic, X0 + 0.35, y + 0.06, 0.46, C.teal, C.white);
    T(s, [
      { text: t, options: { fontSize: 15, bold: true, color: C.white, breakLine: true } },
      { text: d, options: { fontSize: 11, color: C.onDark2 } },
    ], X0 + 1.0, y, 4.85, 0.6, { valign: 'middle' });
  }
  s.addShape(SH.RIGHT_ARROW, { x: 6.78, y: 4.17, w: 0.62, h: 0.55, fill: { color: C.mint } });
  box(s, 7.583, 2.3, 5.15, 4.25, { fill: C.coral, r: 0.1 });
  await iconImg(s, 'LuUserCheck', 7.93, 2.52, 0.34, C.white);
  T(s, 'HUMANS DECIDE', 8.38, 2.52, 4, 0.34, { fontSize: 12.5, bold: true, color: C.white, valign: 'middle', charSpacing: 2 });
  T(s, 'The final hiring decision remains with the human.', 7.93, 3.0, 4.5, 1.35, { fontSize: 24, bold: true, color: C.white });
  T(s, [
    { text: 'Reviews the analysis and the evidence', options: { bullet: true, breakLine: true } },
    { text: 'Can question or override any AI output', options: { bullet: true, breakLine: true } },
    { text: 'Owns the decision and its outcome', options: { bullet: true } },
  ], 7.93, 4.55, 4.5, 1.6, { fontSize: 13.5, color: C.white, paraSpaceAfter: 8 });
  notes(s, n, 2,
    '«AI Assists. Humans Decide. الـAI يساعد في التحليل، والاستخراج، والمقارنة، والتفسير، وتنظيم الأدلة. لكن قرار التوظيف النهائي يبقى دائمًا للإنسان: الإنسان يراجع التحليل والأدلة، ويمكنه أن يعترض على أي مخرج من الـAI أو يتجاوزه، وهو المسؤول عن القرار.»',
    'لا توجد في NestHire أي خطوة يتخذ فيها الـAI قرار التوظيف.',
    'إذا لاحظ أي شخص أثناء التصميم أو التطوير أن ميزة ما تجعل الـAI يقرر بدلًا من الإنسان — يجب أن يرفع ذلك فورًا. (النقاط الثلاث على اليمين مشتقة من مبدأ Human Oversight.)',
    '«هذا المبدأ جزء من مجموعة مبادئ Responsible AI.»');
  footer(s, n, true);

  // 16 — RESPONSIBLE AI ------------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '04 · PRINCIPLES', title: 'Responsible AI',
    lede: 'The principles NestHire must be built on. They apply to every module, model and screen.',
  });
  const prin = [
    ['LuEye', 'Explainability', 'Every analysis comes with its reasons.'],
    ['LuInfo', 'Transparency', 'Clear about which data and evidence were used.'],
    ['LuUserCheck', 'Human Oversight', 'People review and decide; AI never decides alone.'],
    ['LuScale', 'Fairness', 'Checks to detect and reduce unfair outcomes.'],
    ['LuFileSearch', 'Evidence-Based Evaluation', 'Judge on evidence, not keywords or assumptions.'],
    ['LuLock', 'Privacy', 'Candidate data handled responsibly.'],
    ['LuShieldCheck', 'Security', 'Data and access protected by design.'],
  ];
  const tw = 3.6;
  for (let i = 0; i < prin.length; i++) {
    const [ic, t, d] = prin[i];
    const x = X0 + (i % 2) * (tw + 0.3);
    const y = 2.12 + Math.floor(i / 2) * 1.12;
    box(s, x, y, tw, 0.98, { fill: C.tint, r: 0.08 });
    await iconCircle(s, ic, x + 0.2, y + 0.25, 0.48, C.teal, C.white);
    T(s, t, x + 0.85, y + 0.12, tw - 1.0, 0.34, { fontSize: 13.5, bold: true, color: C.ink, valign: 'middle' });
    T(s, d, x + 0.85, y + 0.47, tw - 1.0, 0.45, { fontSize: 10.5, color: C.slate });
  }
  {
    const x = X0 + tw + 0.3; const y = 2.12 + 3 * 1.12;
    box(s, x, y, tw, 0.98, { fill: C.amberBg, r: 0.08 });
    T(s, [
      { text: 'NEEDS CONFIRMATION', options: { bold: true, fontSize: 9.5, charSpacing: 1, breakLine: true } },
      { text: 'Policy details: data retention, access, consent, audits.', options: { fontSize: 10.5 } },
    ], x + 0.2, y, tw - 0.4, 0.98, { color: C.amberTx, valign: 'middle' });
  }
  box(s, 8.4, 2.12, 4.333, 4.34, { fill: C.coralT, r: 0.1 });
  await iconImg(s, 'LuBan', 8.7, 2.38, 0.36, C.coral);
  T(s, 'NestHire does not use', 9.15, 2.36, 3.4, 0.4, { fontSize: 16, bold: true, color: C.ink, valign: 'middle' });
  const notUsed = [
    ['LuSmile', 'Emotion recognition'], ['LuScanFace', 'Face analysis'], ['LuScanEye', 'Gaze tracking'],
    ['LuAudioLines', 'Voice personality analysis'], ['LuFingerprint', 'Biometric evaluation'],
  ];
  for (let i = 0; i < notUsed.length; i++) {
    const [ic, t] = notUsed[i];
    const y = 3.0 + i * 0.56;
    await iconImg(s, ic, 8.72, y + 0.07, 0.3, C.coral);
    T(s, t, 9.2, y, 3.3, 0.44, { fontSize: 14, bold: true, color: C.ink, valign: 'middle' });
  }
  T(s, 'As stated in the kickoff brief — to be written into the Responsible AI policy.', 8.7, 5.85, 3.8, 0.5,
    { fontSize: 10, italic: true, color: C.slate });
  notes(s, n, 2,
    '«سبعة مبادئ: Explainability و Transparency و Human Oversight و Fairness و Evidence-Based Evaluation و Privacy و Security. وعلى اليمين: ما لن يستخدمه NestHire: التعرف على المشاعر، تحليل الوجه، تتبع النظر، تحليل الشخصية من الصوت، والتقييم البيومتري.»',
    'هذه المبادئ قيود تصميم يجب احترامها في كل ميزة، وليست شعارات.',
    'القائمة مأخوذة من ملخص المشروع، ويجب تحويلها إلى سياسة Responsible AI مكتوبة. تفاصيل الخصوصية والأمان (مدة الاحتفاظ بالبيانات، الصلاحيات، الموافقة، المراجعة) — Needs Confirmation.',
    '«كيف سنبني كل هذا تقنيًا؟»');
  footer(s, n);

  // 17 — PROPOSED SYSTEM ARCHITECTURE ----------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '05 · ARCHITECTURE', title: 'Proposed System Architecture', chip: ['PROPOSED ARCHITECTURE', 'proposed'],
    lede: 'Target layering for NestHire. Nothing here is built; the technologies listed are proposals to confirm in Sprint 1.',
  });
  const layers = [
    ['Client Layer', 'Web and mobile apps', ['Web', 'Mobile'], 'white'],
    ['API Layer', 'Single entry point for all clients', ['FastAPI'], 'tint'],
    ['Application Layer', 'Jobs, candidates, workflow, admin rules', ['Business Logic'], 'white'],
    ['AI / ML Layer', 'Evidence, intelligence, explanations', ['AI Modules', 'ML Models', 'LLM Integration'], 'teal'],
    ['Data Layer', 'Relational data and vector search', ['PostgreSQL', 'pgvector'], 'tint'],
    ['Supporting Infrastructure', 'Shared platform services', ['Redis', 'Storage', 'Auth', 'Docker'], 'grey'],
  ];
  const AW = 8.05;
  layers.forEach(([name, desc, techs, kind], i) => {
    const y = 2.08 + i * 0.74;
    const fill = { white: C.white, tint: C.tint, teal: C.teal, grey: C.grey }[kind];
    const dark = kind === 'teal';
    box(s, X0, y, AW, 0.64, { fill, line: dark ? null : C.line, r: 0.06 });
    T(s, name, X0 + 0.2, y, 1.95, 0.64, { fontSize: 13, bold: true, color: dark ? C.white : C.ink, valign: 'middle' });
    T(s, desc, X0 + 2.2, y, 2.25, 0.64, { fontSize: 10.5, color: dark ? 'D5F0EC' : C.slate, valign: 'middle' });
    let tx = X0 + AW - 0.15;
    for (let k = techs.length - 1; k >= 0; k--) {
      const w = 0.24 + techs[k].length * 0.078;
      tx -= w;
      box(s, tx, y + 0.16, w, 0.32, { fill: dark ? C.tealD : C.white, line: dark ? null : C.greyB, r: 0.16 });
      T(s, techs[k], tx, y + 0.16, w, 0.32, { fontSize: 9.5, bold: true, color: dark ? C.white : C.ink, align: 'center', valign: 'middle' });
      tx -= 0.08;
    }
  });
  box(s, 8.95, 2.08, 3.783, 2.45, { fill: C.white, line: C.line, r: 0.08 });
  T(s, 'WHO OWNS EACH LAYER', 9.15, 2.2, 3.4, 0.3, { fontSize: 10, bold: true, color: C.teal, charSpacing: 2 });
  const owners = [
    ['Client', 'Frontend · Mobile · UI/UX'], ['API & Application', 'Backend'], ['AI / ML', 'AI Eng · ML Eng · AI Integration'],
    ['Data', 'Backend · ML Engineering'], ['Infrastructure', 'Backend · Team Lead'],
  ];
  owners.forEach(([l, r], i) => {
    T(s, [
      { text: `${l}: `, options: { bold: true, color: C.ink } },
      { text: r, options: { color: C.slate } },
    ], 9.15, 2.56 + i * 0.38, 3.45, 0.36, { fontSize: 10.5, valign: 'middle' });
  });
  box(s, 8.95, 4.68, 3.783, 1.82, { fill: C.amberBg, r: 0.08 });
  T(s, 'TO CONFIRM IN SPRINT 1', 9.15, 4.8, 3.4, 0.3, { fontSize: 10, bold: true, color: C.amberTx, charSpacing: 1 });
  T(s, [
    { text: 'Web and mobile frameworks', options: { bullet: true, breakLine: true } },
    { text: 'LLM provider and integration approach', options: { bullet: true, breakLine: true } },
    { text: 'Hosting and deployment target', options: { bullet: true, breakLine: true } },
    { text: 'Storage and authentication approach', options: { bullet: true } },
  ], 9.15, 5.12, 3.45, 1.3, { fontSize: 10.5, color: C.amberTx, paraSpaceAfter: 3 });
  notes(s, n, 4,
    '«هذه معمارية مقترحة من ست طبقات: Client (Web و Mobile)، API (FastAPI كمقترح)، Application (منطق الأعمال)، AI/ML (وحدات AI، نماذج ML، تكامل LLM)، Data (PostgreSQL مع pgvector)، والبنية الداعمة (Redis و Storage و Authentication و Docker). على اليمين: من يملك كل طبقة، وما القرارات التقنية التي يجب تأكيدها في Sprint 1.»',
    'كل تخصص يعرف طبقته وحدودها والواجهات التي يتعامل معها.',
    'لا شيء من هذا منفّذ. التقنيات المذكورة مقترحات من ملخص المشروع، وسيتم اعتمادها رسميًا في Architecture Decision Records خلال Sprint 1. ملكية الطبقات على اليمين مسودة للنقاش.',
    '«من سيبني هذه الطبقات؟ لننتقل إلى الفريق.»');
  footer(s, n);

  // 18 — TEAM STRUCTURE ------------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '06 · TEAM', title: 'Team Structure', chip: ['NAMES: NEEDS CONFIRMATION', 'confirm'],
    lede: 'Roles from the kickoff brief. Names will be added once the team roster is confirmed.',
  });
  box(s, 5.167, 2.05, 3.0, 0.82, { fill: C.ink, r: 0.08 });
  T(s, [
    { text: 'LEADERSHIP', options: { fontSize: 9, bold: true, color: C.mint, charSpacing: 2, breakLine: true } },
    { text: 'Team Lead', options: { fontSize: 15, bold: true, color: C.white, breakLine: true } },
    { text: 'Name: TBC', options: { fontSize: 10, color: C.onDark2 } },
  ], 5.167, 2.05, 3.0, 0.82, { align: 'center', valign: 'middle' });
  const tg = [
    ['PRODUCT', 1.9, [['LuCompass', 'Product', 'Role scope: TBC']]],
    ['DESIGN', 1.9, [['LuPalette', 'UI/UX', 'Name: TBC']]],
    ['ENGINEERING', 3.0, [['LuMonitor', 'Frontend', 'Name: TBC'], ['LuServer', 'Backend', 'Name: TBC'], ['LuSmartphone', 'Mobile', 'Name: TBC']]],
    ['INTELLIGENCE', 3.0, [['LuPlug', 'AI Integration', 'Name: TBC'], ['LuBrain', 'AI Engineering', 'Name: TBC'], ['LuCpu', 'ML Engineering', 'Name: TBC']]],
    ['GROWTH', 1.733, [['LuMegaphone', 'Marketing', 'Name: TBC']]],
  ];
  let gx = X0;
  const centers = [];
  for (const [gname, w, roles] of tg) {
    centers.push(gx + w / 2);
    box(s, gx, 3.45, w, 0.42, { fill: C.tint, r: 0.06 });
    T(s, gname, gx, 3.45, w, 0.42, { fontSize: 10, bold: true, color: C.tealD, align: 'center', valign: 'middle', charSpacing: 2 });
    for (let k = 0; k < roles.length; k++) {
      const [ic, r, nm] = roles[k];
      const y = 3.97 + k * 0.82;
      box(s, gx, y, w, 0.72, { fill: C.white, line: C.line, shadow: true });
      await iconImg(s, ic, gx + 0.15, y + 0.2, 0.32, C.teal);
      T(s, r, gx + 0.58, y + 0.1, w - 0.68, 0.3, { fontSize: 12.5, bold: true, color: C.ink, valign: 'middle' });
      T(s, nm, gx + 0.58, y + 0.4, w - 0.68, 0.25, { fontSize: 9.5, color: r === 'Product' ? C.amberTx : C.muted, valign: 'middle' });
    }
    gx += w + 0.15;
  }
  s.addShape(SH.LINE, { x: 6.667, y: 2.87, w: 0, h: 0.33, line: { color: C.greyB, width: 1.25 } });
  s.addShape(SH.LINE, { x: centers[0], y: 3.2, w: centers[4] - centers[0], h: 0, line: { color: C.greyB, width: 1.25 } });
  centers.forEach((c) => s.addShape(SH.LINE, { x: c, y: 3.2, w: 0, h: 0.25, line: { color: C.greyB, width: 1.25 } }));
  note(s, 'Roles only — no names, headcount or seniority were provided. Whether Product is a dedicated role or part of the Team Lead role needs confirmation.');
  notes(s, n, 2,
    '«هيكل الفريق حسب التخصصات: القيادة (Team Lead)، المنتج، التصميم (UI/UX)، الهندسة (Frontend و Backend و Mobile)، الذكاء (AI Integration و AI Engineering و ML Engineering)، والنمو (Marketing).»',
    'كل تخصص له مكان واضح في الهيكل وخط تواصل مباشر مع Team Lead.',
    'الأسماء غير مدرجة في هذا الإصدار لأنها لم تتوفر في المصادر — أكملها قبل الاجتماع أو خلاله. هل دور Product مستقل أم يتولاه Team Lead؟ Needs Confirmation.',
    '«لننتقل من الهيكل إلى المسؤوليات: من يملك ماذا؟»');
  footer(s, n);

  // 19 — WHO OWNS WHAT? (1/2) ------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '06 · OWNERSHIP', title: 'Who Owns What? — Product & Platform', chip: ['DRAFT · CONFIRM TODAY', 'confirm'],
    lede: 'Ownership at the level of responsibilities — detailed tasks come from the plan after this meeting.',
  });
  const ownCols = [1.75, 2.9, 3.0, 2.25, 2.233];
  const ownHead = ['ROLE', 'MAIN RESPONSIBILITY', 'MAIN DELIVERABLES', 'DEPENDS ON', 'WORKS CLOSELY WITH'];
  table(s, X0, 2.05, ownCols, ownHead, [
    ['Team Lead\n(+ Product: TBC)', 'Direction, priorities and coordination; removes blockers', 'Roadmap, sprint plans, task board, decision log', 'Status and blockers from every role', 'Everyone'],
    ['UI/UX', 'User journeys and interface design for every user group', 'Journeys, wireframes, design system, prototypes', 'Confirmed users and scope; official brand assets', 'Frontend · Mobile · Marketing'],
    ['Frontend', 'Web client for the hiring organization and admins', 'Web screens, UI components, API integration', 'UI/UX designs; Backend API contracts', 'UI/UX · Backend · AI Integration'],
    ['Backend', 'API, business logic, data model and authentication', 'API endpoints and contracts, DB schema, API docs', 'Product requirements; AI/ML interfaces', 'Frontend · Mobile · AI Integration'],
    ['Mobile', 'Mobile client (scope: Needs Confirmation)', 'Mobile screens, API integration', 'Mobile scope decision; designs; Backend API', 'UI/UX · Backend'],
  ], { rowH: 0.84, fontSize: 11 });
  notes(s, n, 3,
    '«لكل دور: المسؤولية الأساسية، المخرجات، ما يعتمد عليه، ومن يعمل معه عن قرب. [مرّ على الصفوف الخمسة: Team Lead و UI/UX و Frontend و Backend و Mobile].»',
    'لا توجد مسؤولية بلا مالك، ولا مخرج بلا تخصص مسؤول عنه.',
    'هذه مسودة ملكية وليست قائمة مهام. اطلب من كل شخص أن يؤكد سطره أو يصححه الآن، وسجّل التعديلات مباشرة.',
    '«والآن تخصصات الذكاء والتسويق.»');
  footer(s, n);

  // 20 — WHO OWNS WHAT? (2/2) ------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '06 · OWNERSHIP', title: 'Who Owns What? — Intelligence & Growth', chip: ['DRAFT · CONFIRM TODAY', 'confirm'],
    lede: 'Three AI roles work on one pipeline — their boundaries must be explicit.',
  });
  table(s, X0, 2.05, ownCols, ownHead, [
    ['AI Integration', 'Connect AI/ML capabilities to the platform; LLM integration', 'AI service interfaces, LLM integration layer, AI↔API contracts', 'Backend API; outputs of AI and ML modules', 'Backend · AI Eng · ML Eng'],
    ['AI Engineering', 'AI modules: evidence extraction, analysis, explanations', 'Extraction and analysis modules; explanation outputs; quality checks', 'Job and candidate data model; LLM access', 'AI Integration · ML Eng · Backend'],
    ['ML Engineering', 'ML models: matching and ranking, embeddings, confidence and fairness evaluation', 'Models, evaluation reports, embedding pipeline (pgvector, proposed)', 'Data availability; evidence schema', 'AI Eng · AI Integration · Backend'],
    ['Marketing', 'Brand, positioning and launch readiness', 'Official brand kit, messaging, launch materials (timing TBC)', 'Product vision and roadmap', 'Team Lead · UI/UX'],
  ], { rowH: 0.86, fontSize: 11 });
  box(s, X0, 6.0, CW, 0.6, { fill: C.ink, r: 0.08 });
  await iconImg(s, 'LuSplit', X0 + 0.25, 6.13, 0.34, C.mint);
  T(s, [
    { text: 'Agree today:  ', options: { bold: true, color: C.mint } },
    { text: 'where AI Integration ends and AI Engineering / ML Engineering begin — written down, to avoid overlap and gaps.', options: { color: C.white } },
  ], X0 + 0.75, 6.0, CW - 1.0, 0.6, { fontSize: 13, valign: 'middle' });
  notes(s, n, 2,
    '«AI Integration يربط قدرات AI/ML بالمنصة ويتولى تكامل الـLLM. AI Engineering يبني وحدات استخراج الأدلة والتحليل والتفسير. ML Engineering يبني نماذج المطابقة والترتيب والـEmbeddings وتقييم الثقة والعدالة. Marketing يتولى الهوية والرسائل والجاهزية للإطلاق.»',
    'ثلاثة أدوار AI تعمل على نفس الـPipeline — تحتاج حدودًا مكتوبة وواضحة.',
    'اتفقوا اليوم على الحدود بين AI Integration و AI Engineering و ML Engineering. التداخل هنا يسبب تكرارًا في العمل أو فجوات لا يملكها أحد. تقسيم المسؤوليات في الجدول مسودة.',
    '«الآن بعد أن عرفنا من يملك ماذا: كيف سنبني NestHire على مراحل؟»');
  footer(s, n);

  // 21 — HOW WE WILL BUILD NESTHIRE ------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '07 · EXECUTION', title: 'How We Will Build NestHire', chip: ['PROPOSED PLAN', 'proposed'],
    lede: 'Eight proposed phases — foundation first, then the platform, then the intelligence layers, then integration and release.',
  });
  const phases = [
    ['Foundation', ['Confirm stack and architecture', 'Repo, workflow, CI', 'Data model and design system'], 'Team Lead · Backend · UI/UX'],
    ['Core Platform', ['Jobs and candidates', 'Recruitment workflow', 'Admin, auth, clients'], 'Backend · Frontend · Mobile'],
    ['Candidate Intelligence', ['Job intelligence', 'Evidence extraction', 'Candidate evidence profile'], 'AI Eng · ML Eng · AI Integration'],
    ['Assessment & Interview Intelligence', ['Assessment evidence', 'Interview evidence', 'Link to the profile'], 'AI Eng · ML Eng'],
    ['Explainability & Ranking', ['Explainable analysis', 'Confidence and fairness checks', 'Ranking'], 'ML Eng · AI Eng'],
    ['Integration', ['End-to-end flow', 'AI ↔ API ↔ clients', 'Recruiter review screens'], 'AI Integration · Backend · Frontend'],
    ['Testing', ['System and AI quality tests', 'Fairness and security checks', 'Fixes'], 'All roles'],
    ['Deployment', ['Release environment', 'Docker-based deploy (proposed)', 'Launch readiness'], 'Backend · Team Lead · Marketing'],
  ];
  const phw = 1.385; const phg = (CW - 8 * phw) / 7;
  const pcx = (i) => X0 + i * (phw + phg) + phw / 2;
  s.addShape(SH.LINE, { x: pcx(0), y: 2.3, w: pcx(7) - pcx(0), h: 0, line: { color: C.greyB, width: 1.5 } });
  phases.forEach(([t, items, leads], i) => {
    const x = X0 + i * (phw + phg);
    const first = i === 0;
    s.addShape(SH.OVAL, { x: pcx(i) - 0.22, y: 2.08, w: 0.44, h: 0.44, fill: { color: first ? C.coral : C.white }, line: { color: first ? C.coral : C.teal, width: 1.5 } });
    T(s, String(i + 1), pcx(i) - 0.22, 2.08, 0.44, 0.44, { fontSize: 12, bold: true, color: first ? C.white : C.teal, align: 'center', valign: 'middle' });
    box(s, x, 2.75, phw, 3.3, { fill: first ? C.ink : C.white, line: first ? null : C.line, shadow: !first });
    T(s, first ? 'PHASE 1 · NEXT' : `PHASE ${i + 1}`, x + 0.12, 2.88, phw - 0.24, 0.24, { fontSize: 8.5, bold: true, color: first ? C.mint : C.teal, charSpacing: 1 });
    T(s, t, x + 0.12, 3.14, phw - 0.24, 0.72, { fontSize: 12, bold: true, color: first ? C.white : C.ink, valign: 'top' });
    T(s, items.map((it, k) => ({ text: it, options: { bullet: { indent: 10 }, breakLine: k < items.length - 1 } })),
      x + 0.1, 3.88, phw - 0.18, 1.45, { fontSize: 9.5, color: first ? C.onDark : C.slate, paraSpaceAfter: 3 });
    T(s, leads, x + 0.12, 5.38, phw - 0.24, 0.6, { fontSize: 8.5, bold: true, color: first ? C.mint : C.tealD, valign: 'bottom' });
  });
  box(s, X0, 6.22, CW, 0.42, { fill: C.tint, r: 0.08 });
  await iconImg(s, 'LuRepeat', X0 + 0.18, 6.29, 0.28, C.teal);
  T(s, [
    { text: 'Continuous in every phase: ', options: { bold: true, color: C.tealD } },
    { text: 'testing · code review · documentation', options: { color: C.ink } },
  ], X0 + 0.6, 6.22, 7, 0.42, { fontSize: 12, valign: 'middle' });
  chip(s, X0 + CW - 0.15, 6.29, 'DATES & COPILOT PHASE: NEEDS CONFIRMATION', 'confirm', { alignRight: true, size: 8 });
  notes(s, n, 3,
    '«ثماني مراحل مقترحة: 1) Foundation، 2) Core Platform، 3) Candidate Intelligence، 4) Assessment & Interview Intelligence، 5) Explainability & Ranking، 6) Integration، 7) Testing، 8) Deployment. Sprint 1 يبدأ من المرحلة الأولى.»',
    'نبني الأساس أولًا، ثم المنصة، ثم طبقات الذكاء، ثم التكامل والإطلاق.',
    'الاختبار والمراجعة والتوثيق مستمرة في كل مرحلة — المرحلة 7 هي اختبار النظام الكامل وليست أول مرة نختبر فيها. التواريخ وموقع Recruiter Copilot في المراحل — Needs Confirmation. محتوى كل مرحلة مسودة مقترحة.',
    '«داخل كل مرحلة، كيف سنعمل يوميًا؟»');
  footer(s, n);

  // 22 — HOW WE WORK AS A TEAM -----------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '07 · WAY OF WORKING', title: 'How We Work as a Team', chip: ['PROPOSED CONVENTIONS', 'proposed'],
    lede: 'Every piece of work follows the same path — and lives in GitHub.',
  });
  const wf = ['Requirement', 'Epic', 'Task', 'Assignment', 'Development', 'Review', 'Testing', 'Integration', 'Done'];
  const chg = 0.22; const chw = (CW - 8 * chg) / 9; const chs = chw + chg;
  wf.forEach((t, i) => {
    const x = X0 + i * chs;
    const col = i < 4 ? C.ink : i < 8 ? C.teal : C.coral;
    box(s, x, 2.1, chw, 0.78, { fill: col, r: 0.08 });
    T(s, t, x + 0.04, 2.1, chw - 0.08, 0.78, { fontSize: 10, bold: true, color: C.white, align: 'center', valign: 'middle' });
    if (i < 8) arrow(s, x + chw + 0.02, 2.49, x + chs - 0.02, 2.49, C.greyT);
  });
  [['PLAN', 0, 4], ['BUILD', 4, 4], ['SHIP', 8, 1]].forEach(([t, st, sp]) => {
    const x = X0 + st * chs;
    T(s, t, x, 2.98, (sp - 1) * chs + chw, 0.25, { fontSize: 9, bold: true, color: C.muted, align: 'center', charSpacing: 3 });
  });
  const tools = [
    ['LuGitBranch', 'Git', 'All code under version control — no work outside the repo.'],
    ['LuFolderKanban', 'GitHub', 'Single source of truth for code, issues and reviews.'],
    ['LuSplit', 'Branches', 'main stays stable; one branch per task (feature/<issue>-<name>).'],
    ['LuGitPullRequest', 'Pull Requests', 'Every change merges through a PR linked to its issue.'],
    ['LuMessagesSquare', 'Code Review', 'At least one approval before merge.'],
    ['LuListChecks', 'Issues', 'Every task is an issue with owner, priority and DoD.'],
    ['LuBookOpen', 'Documentation', 'README, API docs and decisions live in the repo.'],
    ['LuTestTube', 'Testing', 'Tests ship with the code; CI checks before merge (setup TBC).'],
  ];
  for (let i = 0; i < tools.length; i++) {
    const [ic, t, d] = tools[i];
    const x = X0 + (i % 4) * (2.808 + 0.3);
    const y = 3.45 + Math.floor(i / 4) * 1.6;
    box(s, x, y, 2.808, 1.45, { fill: C.white, line: C.line, shadow: true });
    await iconCircle(s, ic, x + 0.2, y + 0.2, 0.46, C.tint, C.teal);
    T(s, t, x + 0.8, y + 0.2, 1.9, 0.46, { fontSize: 14, bold: true, color: C.ink, valign: 'middle' });
    T(s, d, x + 0.2, y + 0.78, 2.45, 0.62, { fontSize: 10.5, color: C.slate });
  }
  notes(s, n, 3,
    '«كل عمل يمر بنفس المسار: Requirement → Epic → Task → Assignment → Development → Review → Testing → Integration → Done. والأدوات: Git و GitHub كمصدر واحد للحقيقة، فرع لكل مهمة، Pull Request مرتبط بالـIssue، مراجعة واحدة على الأقل قبل الدمج، توثيق داخل المستودع، واختبارات مع الكود.»',
    'لا يوجد عمل خارج هذا المسار — إذا لم يكن في GitHub فهو غير موجود.',
    'هذه أعراف مقترحة: اتفقوا عليها اليوم أو عدّلوها، وبعدها تصبح ملزمة للجميع. إعداد CI وأداة إدارة المهام يحتاجان تأكيدًا.',
    '«كيف تتحول الخطة إلى مهام فعلية؟»');
  footer(s, n);

  // 23 — TASK MANAGEMENT -----------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '07 · EXECUTION', title: 'Task Management: From Plan to Tasks', chip: ['PROPOSED', 'proposed'],
    lede: 'Right after this meeting, the NestHire plan becomes a task board. Every task carries the same fields.',
  });
  const chain = ['Modules', 'Epics', 'Tasks', 'Owners', 'Priority', 'Dependencies', 'Deadline', 'Definition of Done'];
  const cnw = 1.29; const cng = (CW - 8 * cnw) / 7;
  chain.forEach((t, i) => {
    const x = X0 + i * (cnw + cng);
    const col = i < 3 ? C.ink : i < 7 ? C.teal : C.coral;
    box(s, x, 2.08, cnw, 0.78, { fill: col, r: 0.08 });
    T(s, t, x + 0.05, 2.08, cnw - 0.1, 0.78, { fontSize: 11, bold: true, color: C.white, align: 'center', valign: 'middle' });
    if (i < 7) arrow(s, x + cnw + 0.03, 2.47, x + cnw + cng - 0.03, 2.47, C.greyT);
  });
  box(s, X0, 3.2, 6.9, 3.35, { fill: C.white, line: C.line, shadow: true });
  chip(s, X0 + 0.3, 3.4, 'ILLUSTRATIVE EXAMPLE', 'grey');
  T(s, 'Define the structured job requirements schema', X0 + 0.3, 3.78, 6.3, 0.4, { fontSize: 15, bold: true, color: C.ink });
  const fields = [
    ['MODULE', 'Jobs · Job Intelligence'], ['EPIC', 'Structured job profile'],
    ['OWNER', 'Backend (with AI Engineering)'], ['PRIORITY', 'P1 — High'],
    ['DEPENDS ON', 'Core data model draft'], ['DEADLINE', 'Set in sprint planning'],
  ];
  fields.forEach(([l, v], i) => {
    const x = X0 + 0.3 + (i % 2) * 3.25;
    const y = 4.3 + Math.floor(i / 2) * 0.56;
    T(s, l, x, y, 3.1, 0.22, { fontSize: 8.5, bold: true, color: C.muted, charSpacing: 1 });
    T(s, v, x, y + 0.22, 3.1, 0.3, { fontSize: 12, color: C.ink });
  });
  T(s, 'DEFINITION OF DONE', X0 + 0.3, 5.98, 3.1, 0.22, { fontSize: 8.5, bold: true, color: C.muted, charSpacing: 1 });
  T(s, 'Schema reviewed, documented and merged', X0 + 0.3, 6.2, 6.2, 0.3, { fontSize: 12, color: C.ink });
  box(s, 7.8, 3.2, 4.933, 3.35, { fill: C.ink, r: 0.1 });
  T(s, 'DEFINITION OF DONE — PROPOSED', 8.1, 3.42, 4.4, 0.3, { fontSize: 10, bold: true, color: C.mint, charSpacing: 1 });
  const dod = ['Acceptance criteria met', 'Merged through a reviewed pull request', 'Tests written and passing', 'Documentation updated', 'Issue closed and shown at sprint review'];
  for (let i = 0; i < dod.length; i++) {
    const y = 3.8 + i * 0.46;
    await iconImg(s, 'LuCircleCheck', 8.1, y + 0.07, 0.28, C.mint);
    T(s, dod[i], 8.5, y, 4.1, 0.42, { fontSize: 13, color: C.white, valign: 'middle' });
  }
  T(s, '“Done” means all five.', 8.1, 6.14, 4.4, 0.28, { fontSize: 11, italic: true, color: C.onDark2 });
  notes(s, n, 2,
    '«بعد الاجتماع مباشرة، تتحول الخطة إلى: Modules → Epics → Tasks، وكل مهمة لها: Owner و Priority و Dependencies و Deadline و Definition of Done. [اعرض البطاقة التوضيحية]. والمهمة لا تُعتبر Done إلا إذا حققت الشروط الخمسة على اليمين.»',
    'هذه هي النقطة التي ننتقل فيها من التخطيط إلى التنفيذ.',
    'مهمة بدون Owner أو بدون Definition of Done لا تدخل الـSprint. البطاقة مثال توضيحي فقط.',
    '«فما هو أول Sprint؟»');
  footer(s, n);

  // 24 — FIRST DEVELOPMENT SPRINT --------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '07 · FIRST SPRINT', title: 'First Development Sprint', chip: ['PROPOSED', 'proposed'],
    lede: 'Sprint 1 turns the plan into a confirmed, buildable foundation. It maps to Phase 1 — Foundation.',
  });
  box(s, X0, 2.08, 5.2, 4.47, { fill: C.ink, r: 0.1 });
  T(s, 'SPRINT 1 · FOUNDATION', X0 + 0.35, 2.3, 4.5, 0.3, { fontSize: 10.5, bold: true, color: C.mint, charSpacing: 2 });
  T(s, 'OBJECTIVE', X0 + 0.35, 2.75, 4.5, 0.25, { fontSize: 9, bold: true, color: C.onDark2, charSpacing: 2 });
  T(s, 'Confirm the architecture, set up how we build, and define the data and design foundations every later phase depends on.',
    X0 + 0.35, 3.02, 4.5, 1.6, { fontSize: 17, bold: true, color: C.white });
  const facts = [['Duration', 'Needs Confirmation'], ['Starts', 'After roles are assigned'], ['Involves', 'Every discipline'], ['Ends with', 'Sprint review and walkthrough']];
  facts.forEach(([l, v], i) => {
    const y = 4.82 + i * 0.4;
    T(s, l, X0 + 0.35, y, 1.4, 0.34, { fontSize: 11, bold: true, color: C.mint, valign: 'middle' });
    T(s, v, X0 + 1.8, y, 3.1, 0.34, { fontSize: 11.5, color: i === 0 ? 'F7D774' : C.white, valign: 'middle' });
  });
  T(s, 'EXPECTED DELIVERABLES', 6.1, 2.08, 6, 0.3, { fontSize: 10, bold: true, color: C.teal, charSpacing: 2 });
  const deliv = [
    ['LuLayers', 'Architecture confirmed', 'Stack decisions recorded in the repo'],
    ['LuGitBranch', 'Repo and workflow ready', 'Branching, PR and issue templates'],
    ['LuDatabase', 'Core data model draft', 'Job, Candidate, Evidence and more'],
    ['LuPalette', 'Design direction', 'User journeys and low-fi wireframes'],
    ['LuFileSearch', 'Evidence spec', 'Evidence and confidence definitions'],
    ['LuFlag', 'Open decisions owned', 'Each with an owner and a date'],
  ];
  const dw = (6.633 - 0.25) / 2;
  for (let i = 0; i < deliv.length; i++) {
    const [ic, t, d] = deliv[i];
    const x = 6.1 + (i % 2) * (dw + 0.25);
    const y = 2.45 + Math.floor(i / 2) * 1.05;
    box(s, x, y, dw, 0.92, { fill: C.tint, r: 0.08 });
    await iconCircle(s, ic, x + 0.18, y + 0.21, 0.5, C.teal, C.white);
    T(s, t, x + 0.85, y + 0.12, dw - 0.95, 0.34, { fontSize: 12.5, bold: true, color: C.ink, valign: 'middle' });
    T(s, d, x + 0.85, y + 0.47, dw - 0.95, 0.34, { fontSize: 10.5, color: C.slate, valign: 'middle' });
  }
  box(s, 6.1, 5.68, 6.633, 0.87, { fill: C.white, line: C.teal, lineW: 1.25, r: 0.08 });
  T(s, [
    { text: 'SPRINT IS DONE WHEN  ', options: { bold: true, color: C.teal, fontSize: 9.5, charSpacing: 1, breakLine: true } },
    { text: 'every deliverable is reviewed, merged or published in the repo, and walked through at the Sprint 1 review.', options: { color: C.ink, fontSize: 12 } },
  ], 6.35, 5.68, 6.2, 0.87, { valign: 'middle' });
  notes(s, n, 2,
    '«هدف Sprint 1: تأكيد المعمارية، تجهيز طريقة البناء، وتعريف أساس البيانات والتصميم الذي تعتمد عليه كل المراحل اللاحقة. المخرجات المتوقعة ستة: معمارية مؤكدة، مستودع وسير عمل جاهز، مسودة نموذج البيانات، اتجاه التصميم، مواصفات الأدلة والثقة، وقرارات مفتوحة لكل منها مالك.»',
    'Sprint 1 لا يهدف إلى ميزات يراها المستخدم، بل إلى أساس صحيح يمنع إعادة العمل لاحقًا.',
    'مدة الـSprint تحتاج تأكيدًا وتُحدَّد في Sprint Planning.',
    '«لننظر إلى المهام المقترحة.»');
  footer(s, n);

  // 25 — SPRINT 1 BACKLOG ----------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '07 · FIRST SPRINT', title: 'Sprint 1 — Proposed Backlog', chip: ['PROPOSED · OWNERS BY ROLE', 'proposed'],
    lede: 'Each task links to the proposed architecture or product flow. Names are assigned after this meeting.',
  });
  table(s, X0, 2.0, [0.45, 4.6, 2.55, 1.75, 2.783], ['#', 'TASK', 'OWNER (ROLE)', 'DEPENDS ON', 'DELIVERABLE'], [
    ['1', 'Confirm tech stack and record architecture decisions', 'Team Lead · Backend · AI Integration', 'Slide 17', 'Architecture decision records'],
    ['2', 'Set up GitHub repo, branching, PR and issue templates', 'Team Lead · Backend', '—', 'Repo + contribution guide'],
    ['3', 'Draft core data model: Job, Requirement, Candidate, Evidence, Assessment, Interview, Decision', 'Backend · AI Eng · ML Eng', 'Slides 9, 12', 'ER diagram + schema draft'],
    ['4', 'Scaffold API service and authentication approach', 'Backend', '#1', 'Running API skeleton'],
    ['5', 'Map user journeys and low-fidelity wireframes', 'UI/UX', 'User groups confirmed', 'Journeys + wireframes'],
    ['6', 'Scaffold web client; decide mobile scope', 'Frontend · Mobile', '#1, #5', 'Client skeletons + scope decision'],
    ['7', 'Specify evidence schema and confidence definition', 'AI Eng · ML Eng', '#3', 'Evidence and confidence spec'],
    ['8', 'Define AI/ML evaluation and fairness-check approach', 'ML Eng · AI Eng', '#7', 'Evaluation plan'],
    ['9', 'Assess LLM integration options and data-privacy constraints', 'AI Integration', '#1', 'Integration options memo'],
    ['10', 'Collect official brand assets and guidelines', 'Marketing · UI/UX', '—', 'Brand kit shared with team'],
  ], { rowH: 0.43, headH: 0.38, fontSize: 10, boldCol: 1 });
  notes(s, n, 4,
    '«عشر مهام مقترحة، كل منها مرتبطة بالمعمارية أو بالـFlow. [مرّ على المهام]. لاحظوا التبعيات: المهام 4 و 6 و 9 تعتمد على تأكيد الـStack في المهمة 1، ومواصفات الأدلة (7) تعتمد على نموذج البيانات (3)، وخطة التقييم (8) تعتمد على مواصفات الأدلة (7).»',
    'المهام 1 و 2 و 3 هي المسار الحرج — يجب أن تبدأ أولًا.',
    'الملّاك هنا أدوار وليسوا أشخاصًا؛ الأسماء تُسنَد بعد الاجتماع. المهام مقترحة وقابلة للتعديل في Sprint Planning.',
    '«لكي ينجح هذا، نحتاج قواعد عمل واضحة.»');
  footer(s, n);

  // 26 — TEAM EXPECTATIONS ---------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '07 · WAY OF WORKING', title: 'Team Expectations',
    lede: 'Firm rules, professional standards. They apply to everyone, from day one.',
  });
  const rules = [
    ['LuClipboardCheck', 'Own your tasks', 'If it is assigned to you, you drive it.'],
    ['LuCalendar', 'Meet deadlines', 'If a date is at risk, say so early — not on the day.'],
    ['LuMessageSquare', 'Communicate fast', 'Reply quickly and keep the team informed.'],
    ['LuTriangleAlert', 'Never sit on a blocker', 'Raise it as soon as it appears.'],
    ['LuBookOpen', 'Document your work', 'If it is not written down, it is not done.'],
    ['LuGitBranch', 'Use GitHub properly', 'Issues, branches and pull requests — every time.'],
    ['LuGitPullRequest', 'Review code seriously', 'Give real reviews, and ask for them.'],
    ['LuHandshake', 'Collaborate across disciplines', 'Design, engineering and AI build one product.'],
    ['LuCircleCheck', 'Own it until it is closed', 'Done means merged, tested and documented.'],
    ['LuFlag', 'Escalate to the Team Lead', 'When something is at risk, the Team Lead hears it first.'],
  ];
  for (let i = 0; i < rules.length; i++) {
    const [ic, t, d] = rules[i];
    const x = X0 + Math.floor(i / 5) * (5.917 + 0.3);
    const y = 2.08 + (i % 5) * 0.9;
    box(s, x, y, 5.917, 0.8, { fill: i % 5 === 3 ? C.coralT : C.tint, r: 0.08 });
    await iconCircle(s, ic, x + 0.18, y + 0.16, 0.48, i % 5 === 3 ? C.coral : C.teal, C.white);
    T(s, t, x + 0.85, y + 0.09, 4.9, 0.32, { fontSize: 14, bold: true, color: C.ink, valign: 'middle' });
    T(s, d, x + 0.85, y + 0.42, 4.9, 0.3, { fontSize: 11, color: C.slate, valign: 'middle' });
  }
  notes(s, n, 3,
    '«عشر قواعد [اقرأها]. أهمها: لا تجلس على الـBlocker، وأبلغ مبكرًا إذا كان موعد في خطر، و Done يعني merged و tested و documented.»',
    'هذه توقعات مهنية تنطبق على الجميع بلا استثناء — بمن فيهم قائد الفريق.',
    'الإبلاغ المبكر عن مشكلة ليس فشلًا؛ إخفاؤها هو الفشل.',
    '«قبل أن نختم، هناك قرارات مفتوحة يجب أن نغلقها.»');
  footer(s, n);

  // 27 — OPEN DECISIONS ------------------------------------------------------
  s = pres.addSlide(); n++;
  header(s, {
    kicker: '08 · OPEN DECISIONS', title: 'Open Decisions — Needs Confirmation', chip: ['NEEDS CONFIRMATION', 'confirm'],
    lede: 'This deck was built from the kickoff brief only. These items must be confirmed before or during Sprint 1.',
  });
  table(s, X0, 2.0, [3.6, 3.9, 2.85, 1.783], ['DECISION', 'WHY IT MATTERS', 'OWNER (ROLE)', 'CLOSE BY'], [
    ['Official logo and brand guidelines', 'Deck, design system and UI depend on it', 'Marketing · UI/UX', 'Before Sprint 1 planning'],
    ['Team roster: names ↔ roles', 'Ownership and task assignment', 'Team Lead', 'Before Sprint 1 planning'],
    ['Tech stack: web, mobile, LLM provider, hosting', 'Sprint 1 scaffolding and architecture records', 'Team Lead · Backend · AI Integration', 'Sprint 1'],
    ['Mobile scope for the first release', 'Mobile planning and design effort', 'Team Lead', 'Sprint 1'],
    ['Candidate-facing experience scope', 'User journeys and frontend scope', 'Team Lead · UI/UX', 'Sprint 1'],
    ['Recruiter Copilot scope and phase', 'AI roadmap and module boundaries', 'Team Lead · AI Engineering', 'Sprint 1'],
    ['First-release (MVP) module subset', 'Defines what “first release” means', 'Team Lead · all leads', 'Sprint 1'],
    ['Timeline and sprint length', 'Planning, deadlines and phase dates', 'Team Lead', 'Before Sprint 1 planning'],
    ['Privacy, security and Responsible AI policy', 'Trust and data handling', 'Team Lead · Backend · ML Eng', 'Sprint 1 (draft)'],
    ['Task tracker (e.g. GitHub Projects)', 'One place for every task', 'Team Lead', 'Before Sprint 1 planning'],
  ], { rowH: 0.43, headH: 0.38, fontSize: 10.5 });
  notes(s, n, 3,
    '«هذا العرض بُني من ملخص المشروع فقط، لذلك هناك عشرة قرارات تحتاج تأكيدًا. لكل قرار مالك وموعد.»',
    'لا يبقى قرار مفتوح بلا مالك.',
    'حاول إسناد مالك لكل قرار قبل نهاية هذا الاجتماع. أي قرار بدون مالك اليوم سيصبح Blocker غدًا.',
    '«إذًا، ماذا يحدث بعد هذا الاجتماع؟»');
  footer(s, n);

  // 28 — WHAT HAPPENS AFTER THIS MEETING? ------------------------------------
  s = pres.addSlide(); n++;
  s.background = { color: C.ink };
  T(s, '08 · NEXT STEPS', X0, 0.42, 8, 0.28, { fontSize: 10.5, bold: true, color: C.mint, charSpacing: 3 });
  T(s, 'What Happens After This Meeting?', X0, 0.7, 11, 0.7, { fontSize: 30, bold: true, color: C.white, valign: 'middle' });
  const nxt = [['TODAY', 'Understand'], ['AFTER MEETING', 'Assign'], ['NEXT', 'Build'], ['THEN', 'Review'], ['THEN', 'Integrate'], ['THEN', 'Test'], ['FINALLY', 'Release']];
  const ncw = CW / 7;
  const ncx = (i) => X0 + ncw / 2 + i * ncw;
  s.addShape(SH.LINE, { x: ncx(0), y: 2.05, w: ncx(6) - ncx(0), h: 0, line: { color: '2E5566', width: 2 } });
  nxt.forEach(([l, v], i) => {
    const today = i === 0;
    s.addShape(SH.OVAL, { x: ncx(i) - 0.2, y: 1.85, w: 0.4, h: 0.4, fill: { color: today ? C.coral : C.ink }, line: { color: today ? C.coral : C.mint, width: 1.5 } });
    T(s, l, ncx(i) - ncw / 2, 2.4, ncw, 0.28, { fontSize: 9.5, bold: true, color: today ? 'F28C6B' : C.mint, align: 'center', charSpacing: 1 });
    T(s, v, ncx(i) - ncw / 2, 2.68, ncw, 0.4, { fontSize: 16, bold: true, color: C.white, align: 'center' });
  });
  T(s, 'Today we align. After today we build.', X0, 3.55, CW, 0.75, { fontSize: 36, bold: true, color: C.white, align: 'center', valign: 'middle' });
  T(s, 'AI Assists. Humans Decide.', X0, 4.3, CW, 0.5, { fontSize: 22, bold: true, color: C.mint, align: 'center', valign: 'middle' });
  T(s, 'IMMEDIATELY AFTER THIS MEETING', X0, 5.08, CW, 0.28, { fontSize: 9.5, bold: true, color: C.onDark2, charSpacing: 2 });
  const acts = ['Confirm names ↔ roles', 'Create Sprint 1 issues with owners and Definition of Done', 'Assign an owner to every open decision', 'Hold Sprint 1 planning'];
  acts.forEach((t, i) => {
    const x = X0 + i * (2.808 + 0.3);
    box(s, x, 5.42, 2.808, 1.15, { fill: C.ink2, r: 0.08 });
    T(s, String(i + 1).padStart(2, '0'), x + 0.22, 5.58, 0.6, 0.35, { fontSize: 15, bold: true, color: C.mint });
    T(s, t, x + 0.22, 5.92, 2.4, 0.6, { fontSize: 12, color: C.white });
  });
  notes(s, n, 2,
    '«اليوم: نفهم. بعد الاجتماع: نُسند المهام. ثم نبني، ونراجع، وندمج، ونختبر، وأخيرًا نطلق. والخطوات الفورية أربع: تأكيد الأسماء والأدوار، إنشاء Issues للـSprint 1 بمالك و Definition of Done، إسناد مالك لكل قرار مفتوح، وعقد Sprint Planning.»',
    'Today we align. After today we build.',
    'AI Assists. Humans Decide. — هذا المبدأ يرافقنا في كل قرار نتخذه في المنتج.',
    'الختام: افتح باب الأسئلة (10–15 دقيقة)، وراجع الـParking Lot، ثم ارجع إلى الأسئلة الثمانية في الشريحة 2 واطلب من 2–3 أعضاء الإجابة عنها باختصار للتأكد من أن الجميع على نفس الصفحة.');
  footer(s, n, true);

  if (n !== TOTAL) throw new Error(`Slide count ${n} != TOTAL ${TOTAL}`);
}

// ---------------------------------------------------------------------------
// Post-process speaker notes: one right-to-left Arabic paragraph per line,
// with the section headings in bold.
// ---------------------------------------------------------------------------
async function rtlNotes(buf) {
  const zip = await JSZip.loadAsync(buf);
  const re = /<a:p><a:r><a:rPr lang="en-US" dirty="0"\/><a:t>([\s\S]*?)<\/a:t><\/a:r><a:endParaRPr lang="en-US" dirty="0"\/><\/a:p>/;
  const files = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
  for (const f of files) {
    const xml = await zip.file(f).async('string');
    const m = xml.match(re);
    if (!m) throw new Error(`Unexpected notes XML in ${f}`);
    const paras = m[1].split(/\r?\n/).map((line) => {
      const pPr = '<a:pPr algn="r" rtl="1"/>';
      if (!line.trim()) return `<a:p>${pPr}<a:endParaRPr lang="ar-SA" dirty="0"/></a:p>`;
      const bold = /^\d\)|^الوقت المقترح|^تحضير|^خطة الوقت|^الختام/.test(line) ? ' b="1"' : '';
      return `<a:p>${pPr}<a:r><a:rPr lang="ar-SA"${bold} dirty="0"/><a:t>${line}</a:t></a:r></a:p>`;
    }).join('');
    zip.file(f, xml.replace(re, paras));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

(async () => {
  await build();
  const raw = await pres.write({ outputType: 'nodebuffer' });
  const out = await rtlNotes(raw);
  fs.writeFileSync(OUT, out);
  console.log(`Wrote ${OUT} (${TOTAL} slides, ${(out.length / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
