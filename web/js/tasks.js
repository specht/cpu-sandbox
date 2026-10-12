// Tasks in the browser: the bar above the editor shows the task of the open
// program and checks it; a failed case can be loaded into the machine to
// debug it. Class progress shows every student's best attempt per task and,
// per task, how the working solutions compare in cycles and bytes.
import { taskById, taskOf, checkSource } from '/src/tasks.js';
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
      if (t) {
        $('task-title').textContent = t.title;
        $('task-description').textContent = t.text;
      }
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
        all ? el('span', { class: 'muted' }, ` ${grouped(r.cycles)} cycles in all · ${r.bytes} bytes of program. Can you make it faster or smaller? Class progress compares the solutions.`) : null));
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
    const head = el('tr', {}, el('th', { scope: 'col' }, 'Student'), tasks.map(t => el('th', { scope: 'col' },
      el('button', { type: 'button', class: `progress-task${t.id === this.compare ? ' selected' : ''}`, title: `${t.title}: compare the solutions`, onclick: () => { this.compare = t.id; this.renderProgress(); } }, t.title))));
    const rows = students.map(s => el('tr', { class: s.id === mine ? 'mine' : '' }, el('th', { scope: 'row' }, s.id), tasks.map(t => {
      const c = s.cells[t.id];
      if (!c) return el('td', { class: 'progress-cell missing' }, '—');
      const all = !c.error && c.passed === c.total;
      const title = c.error ? `${c.file}: does not build` : `${c.file}: ${c.passed}/${c.total} cases${all ? ` · ${grouped(c.cycles)} cycles · ${c.bytes} bytes` : ''}${c.attempts > 1 ? ` · best of ${c.attempts} programs` : ''}`;
      return el('td', { class: `progress-cell ${all ? 'passed' : 'started'}`, title },
        el('button', { type: 'button', onclick: () => { $('progress-dialog').close(); this.host.openProgram({ group: s.id, file: c.file }); } },
          all ? icon('check') : null, all ? '' : `${c.passed}/${c.total}`));
    })));
    $('progress-head').replaceChildren(head);
    $('progress-body').replaceChildren(...rows);
    this.renderComparison();
  }

  /** The working solutions of one task, fastest first; the smallest gets its own mark. */
  renderComparison() {
    const box = $('progress-compare'), t = this.progress.tasks.find(task => task.id === this.compare);
    box.hidden = !t;
    if (!t) return;
    const solutions = this.progress.students
      .map(s => ({ student: s.id, ...s.cells[t.id] }))
      .filter(c => c.file && !c.error && c.passed === c.total)
      .sort((a, b) => a.cycles - b.cycles || a.bytes - b.bytes);
    const smallest = Math.min(...solutions.map(c => c.bytes));
    box.replaceChildren(
      el('h3', {}, icon('trophy'), ` ${t.title}: ${solutions.length ? 'the working solutions' : 'no working solution yet'}`),
      solutions.length ? el('table', { class: 'compare-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Student'), el('th', {}, 'Program'), el('th', { class: 'num' }, 'Cycles (all cases)'), el('th', { class: 'num' }, 'Bytes'))),
        el('tbody', {}, solutions.map((c, i) => el('tr', { class: c.student === this.host.groupOf() ? 'mine' : '' },
          el('td', {}, String(i + 1)), el('td', {}, c.student),
          el('td', {}, el('button', { type: 'button', class: 'link', onclick: () => { $('progress-dialog').close(); this.host.openProgram({ group: c.student, file: c.file }); } }, c.file)),
          el('td', { class: `num${i === 0 ? ' best' : ''}` }, grouped(c.cycles)),
          el('td', { class: `num${c.bytes === smallest ? ' best' : ''}` }, String(c.bytes)))))) : null,
      el('p', { class: 'muted' }, 'Fewer cycles: the program is faster. Fewer bytes: it is smaller. Often one costs the other — a table or an unrolled loop is fast but big.'));
  }
}

export { taskOf, taskById };
