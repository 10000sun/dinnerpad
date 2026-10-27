const $ = (id) => document.getElementById(id);
const N = 25;
const KINDS = ['monitor', 'mic'];
const NAME = { monitor: '내가 들을 장치', mic: '마이크로 보낼 장치' };
const players = new Map(); // 패드 번호 -> 재생 중인 Audio 집합
const pads = [];
// setSinkId에 넘길 값. monitor는 ''(시스템 기본), mic은 null(사용 안 함)
const sinks = { monitor: '', mic: null };
let cfg, soundsUrl, sel = -1, capturing = false, failed = new Set(), draft;

const say = (msg) => { $('status').textContent = msg || ''; };

// 마이크 전송은 장치가 골라져 있고 켜져 있을 때만 동작한다
const active = (k) => sinks[k] !== null && (k !== 'mic' || cfg.micOn);

function warn() {
  if (!cfg.hotkeys) return say('전역 단축키가 꺼져 있습니다.');
  say(failed.size ?`단축키 등록 실패(다른 프로그램이 쓰는 조합일 수 있음): 패드 ${[...failed].map((i) => i + 1).join(', ')}` : '');
}

function render() {
  $('tg-mic').setAttribute('aria-pressed', active('mic'));
  $('tg-hotkeys').setAttribute('aria-pressed', cfg.hotkeys);
  $('tg-top').setAttribute('aria-pressed', cfg.alwaysOnTop);
  $('grid').classList.toggle('nohk', !cfg.hotkeys);
  pads.forEach((el, i) => {
    const p = cfg.pads[i];
    el.classList.toggle('empty', !p);
    el.classList.toggle('sel', i === sel);
    el.classList.toggle('fail', failed.has(i));
    if (p) el.style.setProperty('--c', p.color); else el.style.removeProperty('--c');
    el.querySelector('.n').textContent = p ? p.name : '';
    el.querySelector('.k').textContent = p && p.key ? Accel.label(p.key) : '';
    el.querySelector('.k').hidden = !(p && p.key);
  });
}

async function commit() {
  failed = new Set(await dp.save(cfg));
  render();
  warn();
}

function stopPad(i) {
  const s = players.get(i);
  if (s) { s.forEach((a) => a.pause()); s.clear(); players.delete(i); }
  pads[i].classList.remove('on');
}

function play(i) {
  const p = cfg.pads[i];
  if (!p) return;
  stopPad(i);
  const url = soundsUrl + encodeURIComponent(p.file);
  const set = new Set();
  players.set(i, set);
  const drop = (a, e) => {
    set.delete(a);
    a.pause();
    say(`${NAME[a.k]} 재생 실패: ${p.name} (${(e && e.message) || '알 수 없는 오류'})`);
    if (!set.size && players.get(i) === set) stopPad(i);
  };
  const items = KINDS.filter(active).map((k) => {
    const a = new Audio(url);
    a.k = k;
    a.volume = cfg.volume[k] / 100;
    a.onended = () => { set.delete(a); if (!set.size && players.get(i) === set) stopPad(i); };
    a.onerror = () => drop(a, a.error);
    set.add(a);
    return a;
  });
  pads[i].classList.add('on');
  // 장치를 모두 지정한 뒤에 같이 재생해 두 소리의 시작 시점을 맞춘다
  Promise.all(items.map(async (a) => {
    try { if (sinks[a.k]) await a.setSinkId(sinks[a.k]); } catch (e) { drop(a, e); }
  })).then(() => items.forEach((a) => set.has(a) && a.play().catch((e) => drop(a, e))));
}

async function loadDevices() {
  const all = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const lost = [];
  for (const k of KINDS) {
    const select = $('dev-' + k);
    select.replaceChildren(new Option(k === 'monitor' ? '시스템 기본' : '사용 안 함', ''));
    all.forEach((d, i) => select.add(new Option(d.label || `출력 장치 ${i + 1}`, d.deviceId)));
    // 저장된 장치를 id, 그다음 이름으로 찾는다. 없으면 설정은 그대로 두고 이번 실행에서만 쓰지 않는다
    const want = cfg[k];
    const hit = want.id && ([...select.options].find((o) => o.value === want.id) || [...select.options].find((o) => o.value && o.text === want.label));
    select.value = hit ? hit.value : '';
    sinks[k] = hit ? hit.value : k === 'monitor' ? '' : null;
    if (want.id && !hit) lost.push(NAME[k]);
  }
  render();
  if (lost.length) say(`${lost.join(', ')}를 찾을 수 없습니다. ${lost.includes(NAME.monitor) ? '시스템 기본 장치로 재생합니다.' : ''}`);
}

function select(i) {
  sel = i;
  render();
}

async function endCapture(key) {
  capturing = false;
  $('key').textContent = '단축키';
  if (key !== null) cfg.pads[sel].key = key;
  await commit(); // 저장하면서 전역 단축키를 다시 등록한다
}

function openEdit() {
  const p = cfg.pads[sel];
  draft = p ? { ...p } : { name: '', file: '', color: '#3b82f6', key: '' };
  $('name').value = draft.name;
  $('color').value = draft.color;
  $('file').textContent = draft.file ? '등록됨' : '없음';
  $('dlg').returnValue = '';
  $('dlg').showModal();
}

const doEdit = () => (sel < 0 ? say('패드를 먼저 선택하세요.') : openEdit());

function doDelete() {
  if (!cfg.pads[sel]) return say('삭제할 패드를 선택하세요.');
  if (!confirm(`"${cfg.pads[sel].name}" 패드를 삭제할까요? 사운드 파일도 함께 지워집니다.`)) return;
  stopPad(sel);
  cfg.pads[sel] = null;
  commit();
}

async function doKey() {
  if (!cfg.pads[sel]) return say('사운드가 있는 패드를 먼저 선택하세요.');
  capturing = true;
  $('key').textContent = '입력 중…';
  $('key').blur();
  say('키 조합을 누르세요 · Esc 취소 · Backspace 해제');
  await dp.hotkeys(false);
}

// 편집 창
$('pick').onclick = async () => {
  const r = await dp.pick();
  if (!r) return;
  draft.file = r.file;
  if (!$('name').value) $('name').value = r.name;
  $('file').textContent = r.name;
};
$('cancel').onclick = () => $('dlg').close('cancel');
$('ok').onclick = (e) => {
  if (!draft.file) { e.preventDefault(); $('file').textContent = '사운드를 선택하세요'; }
};
$('dlg').onclose = () => {
  if ($('dlg').returnValue !== 'ok') return;
  cfg.pads[sel] = { ...draft, name: $('name').value.trim() || `패드 ${sel + 1}`, color: $('color').value };
  commit();
};

$('edit').onclick = doEdit;
$('del').onclick = doDelete;
$('key').onclick = doKey;
$('stop').onclick = () => [...players.keys()].forEach(stopPad);

// 상단 바 토글
const toggle = (fn) => () => {
  if (capturing) endCapture(null);
  if (fn() !== false) commit();
};
$('tg-mic').onclick = toggle(() => {
  if (sinks.mic === null) return say('설정 탭에서 마이크로 보낼 장치를 먼저 고르세요.') && false;
  cfg.micOn = !cfg.micOn;
});
$('tg-hotkeys').onclick = toggle(() => { cfg.hotkeys = !cfg.hotkeys; });
$('tg-top').onclick = toggle(() => { cfg.alwaysOnTop = !cfg.alwaysOnTop; });

// 우클릭 메뉴
const ACT = { edit: doEdit, del: doDelete, key: doKey };
const hideMenu = () => { $('menu').hidden = true; };
function showMenu(x, y) {
  const m = $('menu');
  const has = !!cfg.pads[sel];
  m.querySelector('[data-act=del]').disabled = !has;
  m.querySelector('[data-act=key]').disabled = !has;
  m.hidden = false;
  m.style.left = Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 4)) + 'px';
}
$('menu').onclick = (e) => {
  const act = e.target.dataset.act;
  hideMenu();
  if (act) ACT[act]();
};
document.addEventListener('click', hideMenu);
window.addEventListener('blur', hideMenu);

// 탭
document.querySelectorAll('.tab').forEach((b) => {
  b.onclick = () => {
    if (capturing) endCapture(null);
    hideMenu();
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === b));
    $('v-pads').hidden = b.dataset.tab !== 'pads';
    $('v-settings').hidden = b.dataset.tab !== 'settings';
  };
});

// 설정: 장치와 볼륨
for (const k of KINDS) {
  $('dev-' + k).onchange = (e) => {
    const v = e.target.value;
    sinks[k] = v || (k === 'monitor' ? '' : null);
    cfg[k] = v ? { id: v, label: e.target.selectedOptions[0].text } : { id: '', label: '' };
    commit();
  };
  const r = $('vol-' + k);
  r.oninput = () => {
    cfg.volume[k] = +r.value;
    $('out-' + k).textContent = r.value + '%';
    players.forEach((s) => s.forEach((a) => { if (a.k === k) a.volume = r.value / 100; }));
  };
  r.onchange = commit;
}

$('closeAction').onchange = (e) => {
  cfg.closeAction = e.target.value;
  commit();
};

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') hideMenu();
  if (!capturing) return;
  e.preventDefault();
  if (e.code === 'Escape') return endCapture(null);
  if (e.code === 'Backspace') return endCapture('');
  const key = Accel.fromEvent(e);
  if (!key) return; // 수정키만 눌렀거나 지원하지 않는 키
  const dup = cfg.pads.findIndex((p, i) => p && i !== sel && p.key === key);
  if (dup >= 0) return say(`이미 패드 ${dup + 1}에 지정된 단축키입니다.`);
  endCapture(key);
});

// 입력 대기 중 다른 창으로 가면 전역 단축키가 해제된 채 남지 않도록 취소한다
window.addEventListener('blur', () => capturing && endCapture(null));

(async () => {
  const s = await dp.state();
  cfg = s.config;
  soundsUrl = s.soundsUrl;
  failed = new Set(s.failed);
  for (let i = 0; i < N; i++) {
    const el = document.createElement('button');
    el.className = 'pad';
    el.innerHTML = '<span class="i"></span><span class="n"></span><span class="k"></span>';
    el.querySelector('.i').textContent = i + 1;
    el.onclick = () => {
      if (capturing) endCapture(null);
      select(i);
      play(i);
    };
    el.oncontextmenu = (e) => {
      e.preventDefault();
      if (capturing) endCapture(null);
      select(i);
      showMenu(e.clientX, e.clientY);
    };
    $('grid').append(el);
    pads.push(el);
  }
  for (const k of KINDS) {
    $('vol-' + k).value = cfg.volume[k];
    $('out-' + k).textContent = cfg.volume[k] + '%';
  }
  $('closeAction').value = cfg.closeAction;
  $('ver').textContent = 'v' + s.version;
  $('repo').textContent = s.repoUrl.replace('https://', '');
  $('repo').onclick = (e) => { e.preventDefault(); dp.openRepo(); };
  const auto = await dp.autostart();
  $('autostart').checked = auto.enabled;
  $('autostart').disabled = !auto.supported;
  if (!auto.supported) $('autostart-hint').textContent = '설치형·포터블 버전에서만 사용할 수 있습니다.';
  $('autostart').onchange = async (e) => { e.target.checked = await dp.setAutostart(e.target.checked); };
  render();
  warn();
  await loadDevices();
  dp.onPlay(play);
  // 메인 프로세스가 바꾼 값("다시 묻지 않기", 트레이 메뉴 토글)을 반영한다
  dp.onPatch(({ failed: f, ...rest }) => {
    Object.assign(cfg, rest);
    if (f) failed = new Set(f);
    $('closeAction').value = cfg.closeAction;
    render();
    warn();
  });
  navigator.mediaDevices.addEventListener('devicechange', loadDevices);
})();
