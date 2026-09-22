import { getLocale } from '../../ui/i18n';
import './controls.css';

export interface ReplayControlsState {
  open: boolean; choosing: boolean; active: boolean; running: boolean;
  busy: boolean; ready: boolean; browsingHistory: boolean; supported: boolean;
  cutoff: number | null; end: number | null; speed: number;
}
interface ReplayControlsOptions {
  container: HTMLElement; trigger: HTMLButtonElement;
  getState(): ReplayControlsState;
  onTogglePanel(): void; onChoose(): void; onPlay(): void; onStep(): void;
  onSpeed(speed: number): void; onExit(): void; refreshSelects(): void;
}
const speeds = [.25, .5, 1, 2, 5, 10];
const messages = {
  en: {
    title: 'Replay controls', replay: 'Replay', open: 'Open replay controls', close: 'Close replay controls',
    choose: 'Choose start', reselect: 'Reselect start', selecting: 'Selecting start…',
    chooseHint: 'Click a candle to replay through it. Esc cancels selection.',
    startHint: 'Choose a candle for historical bar replay.', samplePlaying: 'Playing sample updates',
    samplePlay: 'Play sample updates', play: 'Play bar replay',
    pause: 'Pause', step: 'Next bar', speed: 'Replay speed', speedHint: 'Choose a starting candle to change replay speed.',
    exit: 'Exit replay', exitHint: 'Exit replay and return to current data', ended: 'Reached available data',
    loading: 'Loading replay…', waiting: 'Waiting for chart data', paused: 'Paused', playing: 'Playing bar replay',
    history: 'Return to replay position to continue.', latest: 'Return to Latest to play sample updates.', cutoff: 'Replay cutoff',
    unavailable: 'Historical bar replay is unavailable for this data source.',
  },
  'zh-CN': {
    title: '回放控制', replay: '回放', open: '打开回放控制', close: '关闭回放控制',
    choose: '选择起点', reselect: '重选起点', selecting: '正在选择起点…',
    chooseHint: '点击一根 K 线，回放至该根为止。Esc 取消选择。',
    startHint: '选择一根 K 线以开始历史回放。', samplePlaying: '正在播放样本更新',
    samplePlay: '播放样本更新', play: '播放 K 线回放',
    pause: '暂停', step: '下一根', speed: '回放速度', speedHint: '选择起点后可调整回放速度。',
    exit: '退出回放', exitHint: '退出回放并返回当前数据', ended: '已到达可用数据末尾',
    loading: '正在加载回放…', waiting: '等待图表数据', paused: '已暂停', playing: '正在回放 K 线',
    history: '请返回回放位置后继续。', latest: '请先返回最新，再播放样本更新。', cutoff: '回放截止时间',
    unavailable: '当前数据源不支持历史 K 线回放。',
  },
};
const formats = {
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }),
  'zh-CN': new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }),
};

/** Presentation reads host replay state; market lifetimes and clocks remain outside this module. */
export function createReplayControls(options: ReplayControlsOptions) {
  const { container, trigger } = options, doc = container.ownerDocument;
  const events = new AbortController(), listener = { signal: events.signal };
  container.classList.add('replay-toolbar');
  if (!container.id) container.id = 'replay-controls';
  container.setAttribute('role', 'region'); trigger.setAttribute('aria-controls', container.id);
  const group = doc.createElement('div'); group.className = 'replay-actions'; group.setAttribute('role', 'group');
  function button(name: string, action: () => void) {
    const node = doc.createElement('button'); node.type = 'button'; node.dataset.replayAction = name;
    node.addEventListener('click', action, listener); group.append(node); return node;
  }
  const choose = button('choose', options.onChoose), play = button('play', options.onPlay), step = button('step', options.onStep);
  const speedLabel = doc.createElement('label'), caption = doc.createElement('span'), speed = doc.createElement('select');
  speedLabel.className = 'replay-speed'; speed.id = 'replay-speed';
  for (const value of speeds) { const item = doc.createElement('option'); item.value = String(value); item.textContent = `${value}×`; speed.append(item); }
  speedLabel.append(caption, speed); group.append(speedLabel);
  speed.addEventListener('change', () => { const value = Number(speed.value); if (speeds.includes(value)) options.onSpeed(value); }, listener);
  const exit = button('exit', options.onExit), close = button('close', options.onTogglePanel);
  close.className = 'replay-close'; close.textContent = '×';
  const detail = doc.createElement('div'); detail.className = 'replay-detail';
  const status = doc.createElement('span'); status.className = 'replay-status'; status.setAttribute('role', 'status');
  const cutoff = doc.createElement('time'); cutoff.className = 'replay-cutoff';
  detail.append(status, cutoff); container.append(group, detail);
  trigger.addEventListener('click', options.onTogglePanel, listener);
  let selectKey = '', disposed = false;
  function label(node: HTMLButtonElement, text: string) { node.textContent = text; node.title = text; node.setAttribute('aria-label', text); }
  function refresh(): void {
    if (disposed) return;
    const state = options.getState(), locale = getLocale(), text = messages[locale];
    const ended = state.active && state.cutoff !== null && state.end !== null && state.cutoff >= state.end;
    container.hidden = !state.open; container.setAttribute('aria-label', text.title); group.setAttribute('aria-label', text.title);
    trigger.disabled = !state.ready && !state.open && !state.active;
    trigger.setAttribute('aria-expanded', String(state.open)); trigger.setAttribute('aria-pressed', String(state.open || state.active));
    trigger.classList.toggle('active', state.open || state.active);
    trigger.title = state.open ? text.close : text.open; trigger.setAttribute('aria-label', trigger.title);
    const headerLabel = trigger.querySelector('#header-replay-label'), headerIcon = trigger.querySelector('#header-replay-icon');
    if (headerLabel) headerLabel.textContent = text.replay;
    if (headerIcon) headerIcon.textContent = '↶';
    label(choose, state.choosing ? text.selecting : state.active ? text.reselect : text.choose);
    choose.disabled = !state.supported || state.busy || !state.ready; choose.setAttribute('aria-pressed', String(state.choosing));
    if (!state.supported) choose.title = text.unavailable;
    label(play, state.running ? text.pause : state.active ? text.play : text.samplePlay);
    play.disabled = !state.ready || state.choosing || state.browsingHistory || (!state.running && (state.busy || ended));
    play.setAttribute('aria-pressed', String(state.running));
    label(step, text.step); step.disabled = !state.active || state.running || state.busy || !state.ready || state.choosing || state.browsingHistory || ended;
    caption.textContent = text.speed; speed.setAttribute('aria-label', text.speed); speed.value = String(state.speed);
    speed.disabled = !state.active || state.busy || state.choosing;
    speed.title = state.active ? text.speed : text.speedHint;
    label(exit, text.exit); exit.title = text.exitHint; exit.setAttribute('aria-label', text.exitHint); exit.hidden = !state.active;
    close.title = text.close; close.setAttribute('aria-label', text.close);
    status.textContent = state.choosing ? text.chooseHint : state.busy ? text.loading : !state.ready ? text.waiting
      : state.browsingHistory ? (state.active ? text.history : text.latest) : ended ? text.ended
        : state.active ? (state.running ? text.playing : text.paused) : !state.supported
          ? `${state.running ? `${text.samplePlaying} · ` : ''}${text.unavailable}` : state.running ? text.samplePlaying : text.startHint;
    const time = state.active && state.cutoff !== null && Number.isFinite(new Date(state.cutoff).getTime()) ? state.cutoff : null;
    cutoff.hidden = time === null;
    if (time !== null) { cutoff.dateTime = new Date(time).toISOString(); cutoff.textContent = `${text.cutoff}: ${formats[locale].format(time)} UTC`; }
    const key = `${locale}:${state.speed}:${speed.disabled}`;
    if (selectKey !== key) { selectKey = key; options.refreshSelects(); }
  }
  refresh();
  return { refresh, dispose() { disposed = true; events.abort(); group.remove(); detail.remove(); } };
}
