// 复习视图：AI 出题（选择题）+ 本地闪卡兜底，答题结果写入复习调度。
import type { HighlightItem } from '../../lib/types';
import { dueItems, getReviewStats, recordResult, type ReviewStats } from '../../lib/review';
import type { OptionsCtx } from './ctx';

interface QuizQuestion {
  highlightId?: string;
  type?: string;          // 仅 'choice'（选择题）
  prompt?: string;
  options?: string[];
  answer?: number;        // 正确选项下标（0-3）
  explanation?: string;
}

interface DueEntry {
  item: HighlightItem;
  pageUrl: string;
  pageTitle: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function renderReview(root: HTMLElement, ctx: OptionsCtx): Promise<void> {
  const stats = await getReviewStats();
  const all: DueEntry[] = [];
  for (const p of ctx.getCache()) {
    for (const h of p.highlights) all.push({ item: h, pageUrl: p.url, pageTitle: p.title });
  }
  const due = dueItems(all.map((e) => e.item), stats);
  const dueIds = new Set(due.map((d) => d.id));
  renderHome(root, ctx, all.filter((e) => dueIds.has(e.item.id)), all.length, stats);
}

/* ----------------------- 首页 ----------------------- */
function renderHome(
  root: HTMLElement, ctx: OptionsCtx, due: DueEntry[], total: number, stats: ReviewStats
) {
  root.innerHTML = '';

  const card = el('div', 'panel');
  const reviewed = Object.keys(stats).length;
  card.appendChild(el('div', 'panel-title', '每日复习'));
  const desc = due.length
    ? `今天有 ${due.length} 条高亮到期，来练练手吧。`
    : total
      ? '今天的复习任务都完成了，明天再来。'
      : '还没有高亮数据，先去网页上划几条吧。';
  card.appendChild(el('p', 'panel-desc', desc));

  const statRow = el('div', 'stat-row');
  statRow.appendChild(statCell(String(due.length), '待复习'));
  statRow.appendChild(statCell(String(total), '总高亮'));
  statRow.appendChild(statCell(String(reviewed), '已练过'));
  card.appendChild(statRow);

  const btns = el('div', 'btn-row');
  const aiBtn = el('button', 'btn primary', 'AI 出题复习');
  aiBtn.disabled = !due.length;
  aiBtn.addEventListener('click', () => void startAiQuiz(root, ctx, due));
  const cardBtn = el('button', 'btn', '闪卡复习');
  cardBtn.disabled = !due.length;
  cardBtn.addEventListener('click', () => runFlashcards(root, ctx, due.slice(0, 20)));
  btns.appendChild(aiBtn);
  btns.appendChild(cardBtn);
  card.appendChild(btns);

  card.appendChild(el('p', 'panel-tip', 'AI 出题需要先在上方配置 AI 服务；闪卡模式离线可用。'));
  root.appendChild(card);
}

function statCell(num: string, label: string): HTMLDivElement {
  const cell = el('div', 'stat-cell');
  cell.appendChild(el('div', 'stat-num', num));
  cell.appendChild(el('div', 'stat-label', label));
  return cell;
}

/* ----------------------- AI 出题 ----------------------- */
async function startAiQuiz(root: HTMLElement, ctx: OptionsCtx, due: DueEntry[]) {
  root.innerHTML = '';
  const loading = el('div', 'panel');
  loading.appendChild(el('p', 'panel-desc', 'AI 正在出题，请稍候…'));
  root.appendChild(loading);

  const resp = await ctx.send<{ ok: boolean; quiz?: { questions?: QuizQuestion[] }; error?: string }>({
    type: 'aiQuiz',
    items: due.slice(0, 12).map((e) => ({
      id: e.item.id,
      exact: e.item.exact,
      note: e.item.note,
      insight: e.item.insight,
      title: e.item.title
    }))
  });

  const questions = resp && resp.ok && resp.quiz && Array.isArray(resp.quiz.questions)
    ? resp.quiz.questions.filter(
        (q) =>
          q &&
          q.prompt &&
          Array.isArray(q.options) &&
          q.options.length > 0 &&
          typeof q.answer === 'number' &&
          q.answer >= 0 &&
          q.answer < q.options.length
      )
    : [];

  if (!questions.length) {
    root.innerHTML = '';
    const card = el('div', 'panel');
    card.appendChild(el('div', 'panel-title', 'AI 出题失败'));
    card.appendChild(el('p', 'panel-desc', (resp && resp.error) || '服务不可用或返回格式异常。'));
    const btns = el('div', 'btn-row');
    const fallback = el('button', 'btn primary', '改用闪卡复习');
    fallback.addEventListener('click', () => runFlashcards(root, ctx, due.slice(0, 20)));
    const back = el('button', 'btn', '返回');
    back.addEventListener('click', () => void renderReview(root, ctx));
    btns.appendChild(fallback);
    btns.appendChild(back);
    card.appendChild(btns);
    root.appendChild(card);
    return;
  }

  runQuiz(root, ctx, due, questions);
}

/* ----------------------- 答题流程 ----------------------- */
function runQuiz(root: HTMLElement, ctx: OptionsCtx, due: DueEntry[], questions: QuizQuestion[]) {
  let index = 0;
  let score = 0;

  const next = () => {
    if (index >= questions.length) {
      renderDone(root, ctx, due, score, questions.length);
      return;
    }
    renderQuestion(root, questions[index]!, index, questions.length, async (correct) => {
      const q = questions[index]!;
      if (q.highlightId) await recordResult(q.highlightId, correct);
      if (correct) score++;
      index++;
      next();
    });
  };
  next();
}

function renderQuestion(
  root: HTMLElement,
  q: QuizQuestion,
  index: number,
  total: number,
  onDone: (correct: boolean) => void
) {
  root.innerHTML = '';
  const card = el('div', 'panel');
  card.appendChild(el('div', 'quiz-progress', `第 ${index + 1} / ${total} 题`));
  card.appendChild(el('div', 'quiz-prompt', q.prompt || ''));

  const feedback = el('div', 'quiz-feedback');
  feedback.hidden = true;

  const finish = (correct: boolean) => {
    feedback.hidden = false;
    feedback.className = 'quiz-feedback ' + (correct ? 'ok' : 'bad');
    feedback.textContent = (correct ? '✓ 回答正确。' : '✗ 回答错误。') + (q.explanation ? ' ' + q.explanation : '');
    const nextBtn = el('button', 'btn primary', index + 1 >= total ? '查看结果' : '下一题');
    nextBtn.addEventListener('click', () => onDone(correct));
    feedback.appendChild(document.createTextNode(' '));
    feedback.appendChild(nextBtn);
  };

  if (!Array.isArray(q.options) || !q.options.length) {
    // 正常不会走到这里（startAiQuiz 已过滤非选择题）；兜底提示，避免空白卡片
    card.appendChild(el('div', 'quiz-feedback bad', '题目数据异常，已跳过。'));
    const skip = el('button', 'btn primary', index + 1 >= total ? '查看结果' : '下一题');
    skip.addEventListener('click', () => onDone(false));
    card.appendChild(skip);
    root.appendChild(card);
    return;
  }

  const opts = el('div', 'quiz-options');
  q.options.forEach((opt, i) => {
    const btn = el('button', 'quiz-option', opt);
    btn.addEventListener('click', () => {
      const correct = i === Number(q.answer);
      opts.querySelectorAll('button').forEach((b, j) => {
        (b as HTMLButtonElement).disabled = true;
        if (j === Number(q.answer)) b.classList.add('right');
      });
      if (!correct) btn.classList.add('wrong');
      finish(correct);
    });
    opts.appendChild(btn);
  });
  card.appendChild(opts);

  card.appendChild(feedback);
  root.appendChild(card);
}

/* ----------------------- 闪卡流程 ----------------------- */
function runFlashcards(root: HTMLElement, ctx: OptionsCtx, entries: DueEntry[]) {
  let index = 0;
  let known = 0;

  const next = () => {
    if (index >= entries.length) {
      renderDone(root, ctx, entries, known, entries.length);
      return;
    }
    renderCard(root, entries[index]!, index, entries.length, async (correct) => {
      await recordResult(entries[index]!.item.id, correct);
      if (correct) known++;
      index++;
      next();
    });
  };
  next();
}

function renderCard(
  root: HTMLElement,
  entry: DueEntry,
  index: number,
  total: number,
  onDone: (known: boolean) => void
) {
  root.innerHTML = '';
  const card = el('div', 'panel');
  card.appendChild(el('div', 'quiz-progress', `第 ${index + 1} / ${total} 张`));

  const face = el('div', 'flashcard');
  const front = el('div', 'flashcard-front', entry.item.exact);
  const back = el('div', 'flashcard-back');
  back.hidden = true;
  back.appendChild(el('div', 'flashcard-note', entry.item.note || '（还没有笔记）'));
  if (entry.item.insight) back.appendChild(el('div', 'flashcard-insight', entry.item.insight));
  const src = el('div', 'flashcard-src', entry.pageTitle || entry.pageUrl);
  back.appendChild(src);
  face.appendChild(front);
  face.appendChild(back);
  face.addEventListener('click', () => {
    back.hidden = !back.hidden;
    front.classList.toggle('dim', !back.hidden);
  });
  card.appendChild(face);

  const btns = el('div', 'btn-row center');
  const noBtn = el('button', 'btn danger', '不认识');
  const okBtn = el('button', 'btn primary', '认识');
  noBtn.addEventListener('click', () => onDone(false));
  okBtn.addEventListener('click', () => onDone(true));
  btns.appendChild(noBtn);
  btns.appendChild(okBtn);
  card.appendChild(btns);
  card.appendChild(el('p', 'panel-tip', '点击卡片翻面查看笔记。'));
  root.appendChild(card);
}

/* ----------------------- 结算页 ----------------------- */
function renderDone(root: HTMLElement, ctx: OptionsCtx, due: DueEntry[], score: number, total: number) {
  root.innerHTML = '';
  const card = el('div', 'panel done');
  card.appendChild(el('div', 'done-score', `${score} / ${total}`));
  const pct = total ? Math.round((score / total) * 100) : 0;
  const praise = pct >= 80 ? '太棒了，掌握得很牢。' : pct >= 50 ? '不错，错题记得再看看。' : '别灰心，错的多复习几轮就记住了。';
  card.appendChild(el('p', 'panel-desc', `本轮正确率 ${pct}%。${praise}`));
  const btns = el('div', 'btn-row center');
  const again = el('button', 'btn', '再来一组');
  again.addEventListener('click', () => runFlashcards(root, ctx, due.slice(0, 20)));
  const back = el('button', 'btn primary', '返回');
  back.addEventListener('click', () => void renderReview(root, ctx));
  btns.appendChild(again);
  btns.appendChild(back);
  card.appendChild(btns);
  root.appendChild(card);
}
