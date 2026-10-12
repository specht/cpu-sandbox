// Tasks in the browser: the bar above the editor shows the task of the open
// program and checks it; a failed case can be loaded into the machine to
// debug it. Class progress shows every student's best attempt per task and,
// per task, how the working solutions compare in cycles and bytes.
import { taskById, taskOf, checkSource, place, levelOf } from '/src/tasks.js';
import { $, el, icon, grouped } from './util.js';
import { request } from './catalog.js';

const mark = pass => icon(pass ? 'circle-check' : 'circle-x');

export class TaskPanel {
  /**
   * host: { source(), language(), tryCase(task, testCase), openProgram({ group, file }), groupOf() }
   */
  constructor(host) {
    this.host = host;
    this.task = null;
    this.result = null;
    this.trying = null;
    $('task-check').addEventListener('click', () => this.check());
    $('task-case-clear').addEventListener('click', () => this.tryCase(null));
    $('check-close').addEventListener('click', () => $('check-dialog').close());
    $('progress-open').addEventListener('click', () => this.openProgress());
    $('progress-close').addEventListener('click', () => $('progress-dialog').close());
    $('progress-refresh').addEventListener('click', () => this.loadProgress());
    $('task-more').addEventListener('click', () => {
      const open = $('task-bar').classList.toggle('expanded');
      $('task-more').setAttribute('aria-expanded', String(open));
    });
  }

  /** Called whenever the source changes: shows the bar if the program names a task. */
  update(source) {
    const t = taskById(taskOf(source) ?? '');
    // The addresses in the text depend on the CPU level: 0x80 on 8 and 8S, 0x8000 on 8X.
    if (t) {
      const text = place(t.text, levelOf(source, this.host.language()));
      if ($('task-description').textContent !== text) $('task-description').textContent = text;
    }
    if (t !== this.task) {
      this.task = t;
      this.result = null;
      if (this.trying && this.trying.task !== t) {
        // Another task (or none): its cases do not belong here. The caller restarts the machine anyway.
        this.trying = null;
        $('task-case').hidden = true;
        this.host.tryCase(null, { restart: false });
      }
      $('task-bar').hidden = !t;
      if (t) $('task-title').textContent = t.title;
    }
    if (this.result && this.result.source !== source) { this.result = null; this.renderSummary(); }
  }

  renderSummary() {
    const chip = $('task-result'), r = this.result;
    chip.hidden = !r;
    if (!r) return;
    const all = !r.error && r.passed === r.total;
    chip.className = `task-result ${all ? 'passed' : 'failed'}`;
    chip.replaceChildren(mark(all), r.error ? 'Does not build' : `${r.passed}/${r.total}`);
    chip.title = all ? `All cases pass · ${grouped(r.cycles)} cycles · ${r.bytes} bytes` : 'Open the results with Check';
  }

  check() {
    if (!this.task) return;
    const source = this.host.source();
    const result = checkSource(source, this.host.language());
    this.result = { ...result, source };
    this.renderSummary();
    this.showResults();
  }

  showResults() {
    const r = this.result, t = this.task;
    $('check-title').textContent = `Check: ${t.title}`;
    const body = [];
    if (r.error) body.push(el('p', { class: 'check-error' }, mark(false), ` The program does not build: ${r.error}`));
    else {
      const all = r.passed === r.total;
      body.push(el('p', { class: `check-summary ${all ? 'passed' : 'failed'}` }, mark(all),
        all ? ` All ${r.total} cases pass.` : ` ${r.passed} of ${r.total} cases pass.`,
        all ? el('span', { class: 'muted' }, ` ${grouped(r.cycles)} cycles in all · ${r.bytes} bytes of program${r.language === 'c' ? ` (the compiler made ${r.instructions} instructions)` : ` (${r.instructions} instructions)`}. Can you make it faster or smaller? Class progress compares the solutions, in assembly and in C.`) : null));
      body.push(el('ol', { class: 'check-cases' }, r.results.map((c, i) => el('li', { class: c.pass ? 'passed' : 'failed' },
        mark(c.pass),
        el('div', { class: 'check-case' },
          el('b', {}, c.name),
          c.pass ? el('span', { class: 'muted' }, `${grouped(c.cycles)} cycles`) : el('span', { class: 'check-message' }, c.message)),
        el('button', { type: 'button', class: 'subtle', title: 'Load this case into the machine: its input goes into RAM (or the keyboard), then Run or step', onclick: () => { this.tryCase(t.cases[i]); $('check-dialog').close(); } }, 'Try it')))));
    }
    $('check-body').replaceChildren(...body);
    $('check-dialog').showModal();
  }

  /** Loads a case into the machine (or clears it with null). */
  tryCase(testCase) {
    this.trying = testCase ? { task: this.task, testCase } : null;
    $('task-case').hidden = !testCase;
    if (testCase) $('task-case-name').textContent = testCase.name;
    this.host.tryCase(testCase);
  }

  // ------------------------------------------------------------ class progress

  async openProgress() {
    $('progress-dialog').showModal();
    await this.loadProgress();
  }

  async loadProgress() {
    $('progress-status').textContent = 'Checking every program of the class…';
    try {
      this.progress = await request('/api/progress');
      $('progress-status').textContent = this.progress.students.length
        ? 'A program takes part when its first lines say "; Task: name" (or "// Task: name" in C). Click a task to compare the solutions.'
        : 'There are no student folders yet.';
      this.renderProgress();
    } catch (error) {
      $('progress-status').textContent = error.message;
    }
  }

  renderProgress() {
    const { tasks, students } = this.progress, mine = this.host.groupOf();
    // Two header rows: the chapters, then the tasks with short titles (the full title on hover).
    const chapters = [];
    for (const t of tasks) {
      if (chapters.at(-1)?.name === t.chapter) chapters.at(-1).span++;
      else chapters.push({ name: t.chapter, span: 1 });
    }
    const groups = el('tr', { class: 'progress-chapters' }, el('th', {}),
      chapters.map(c => el('th', { colspan: c.span, scope: 'colgroup' }, c.name === 'C' ? 'C on MiniCPU 8X' : c.name)));
    const head = el('tr', {}, el('th', { scope: 'col', class: 'progress-student' }, 'Student'), tasks.map(t => el('th', { scope: 'col', class: chapters.some(c => c.name === t.chapter && tasks.find(x => x.chapter === t.chapter) === t) ? 'chapter-start' : '' },
      el('button', { type: 'button', class: `progress-task${t.id === this.compare ? ' selected' : ''}`, title: `${t.title}${t.language === 'c' ? ' (a C task)' : ''}: compare the solutions`, onclick: () => { this.compare = t.id; this.renderProgress(); } },
        t.short ?? t.title))));
    const first = new Set(chapters.map(c => tasks.find(t => t.chapter === c.name).id));
    const rows = students.map(s => el('tr', { class: s.id === mine ? 'mine' : '' }, el('th', { scope: 'row' }, s.id), tasks.map(t => {
      const c = s.cells[t.id], edge = first.has(t.id) ? ' chapter-start' : '';
      if (!c) return el('td', { class: `progress-cell missing${edge}` }, '—');
      const all = !c.error && c.passed === c.total;
      const title = c.error ? `${c.file}: does not build` : `${c.file}: ${c.passed}/${c.total} cases${all ? ` · ${grouped(c.cycles)} cycles · ${c.bytes} bytes` : ''}${c.attempts > 1 ? ` · best of ${c.attempts} programs` : ''}`;
      const other = c.other && !c.other.error && c.other.passed === c.other.total ? c.other : null;
      return el('td', { class: `progress-cell ${all ? 'passed' : 'started'}${edge}`, title },
        el('button', { type: 'button', onclick: () => { $('progress-dialog').close(); this.host.openProgram({ group: s.id, file: c.file }); } },
          all ? icon('check') : null, all ? '' : `${c.passed}/${c.total}`,
          all && (c.language === 'c' || other) ? el('span', { class: 'language-tag' }, other ? 'asm + C' : 'C') : null));
    })));
    $('progress-head').replaceChildren(groups, head);
    $('progress-body').replaceChildren(...rows);
    this.renderComparison();
  }

  /** The working solutions of one task, fastest first; the smallest gets its own mark. */
  renderComparison() {
    const box = $('progress-compare'), t = this.progress.tasks.find(task => task.id === this.compare);
    box.hidden = !t;
    if (!t) return;
    const solutions = this.progress.students
      .flatMap(s => [s.cells[t.id], s.cells[t.id]?.other].filter(Boolean).map(c => ({ student: s.id, ...c })))
      .filter(c => c.file && !c.error && c.passed === c.total)
      .sort((a, b) => a.cycles - b.cycles || a.bytes - b.bytes);
    const smallest = Math.min(...solutions.map(c => c.bytes));
    box.replaceChildren(
      el('h3', {}, icon('trophy'), ` ${t.title}: ${solutions.length ? 'the working solutions' : 'no working solution yet'}`),
      solutions.length ? el('table', { class: 'compare-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Student'), el('th', {}, 'Language'), el('th', {}, 'Program'), el('th', { class: 'num' }, 'Cycles (all cases)'), el('th', { class: 'num' }, 'Bytes'))),
        el('tbody', {}, solutions.map((c, i) => el('tr', { class: c.student === this.host.groupOf() ? 'mine' : '' },
          el('td', {}, String(i + 1)), el('td', {}, c.student), el('td', {}, c.language === 'c' ? 'C' : 'Assembly'),
          el('td', {}, el('button', { type: 'button', class: 'link', onclick: () => { $('progress-dialog').close(); this.host.openProgram({ group: c.student, file: c.file }); } }, c.file)),
          el('td', { class: `num${i === 0 ? ' best' : ''}` }, grouped(c.cycles)),
          el('td', { class: `num${c.bytes === smallest ? ' best' : ''}` }, String(c.bytes)))))) : null,
      el('p', { class: 'muted' }, 'Fewer cycles: the program is faster. Fewer bytes: it is smaller. Often one costs the other — a table or an unrolled loop is fast but big. C is quicker to write, but the compiler makes more and slower instructions than careful assembly; a better algorithm can still win.'));
  }
}

export { taskOf, taskById };
