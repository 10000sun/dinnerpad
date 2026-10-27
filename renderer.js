const $ = (id) => document.getElementById(id);
const N = 25;
const players = new Map(); // 패드 번호 -> 재생 중인 Audio
const pads = [];
let cfg, soundsUrl, sinkId = '', sel = -1, capturing = false, failed = new Set(), draft;

const say = (msg) => { $('status').textContent = msg || ''; };

function warn() {
  say(failed.size ? `단축키 등록 실패(다른 프로그램이 쓰는 조합일 수 있음): 패드 ${[...failed].map((i) => i + 1).join(', ')}` : '');
}

function render() {
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
  const a = players.get(i);
  if (a) { a.pause(); players.delete(i); }
  pads[i].classList.remove('on');
}

function play(i) {
  const p = cfg.pads[i];
  if (!p) return;
  stopPad(i);
  const a = new Audio(soundsUrl + encodeURIComponent(p.file));
  players.set(i, a);
  const fail = (e) => { stopPad(i); say(`재생 실패: ${p.name} (${e && e.message || '알 수 없는 오류'})`); };
  a.onended = () => { if (players.get(i) === a) stopPad(i); };
  a.onerror = () => fail(a.error);
  pads[i].classList.add('on');
  (sinkId ? a.setSinkId(sinkId) : Promise.resolve()).then(() => a.play()).catch(fail);
}

async function loadDevices() {
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const select = $('device');
  select.replaceChildren(new Option('시스템 기본', ''));
  all.forEach((d, i) => select.add(new Option(d.label || `출력 장치 ${i + 1}`, d.deviceId)));
  // 저장된 장치를 id, 그다음 이름으로 찾는다. 없으면 기본 장치로 재생하되 설정은 그대로 둔다
  const want = cfg.device;
  const hit = want.id && ([...select.options].find((o) => o.value === want.id) || [...select.options].find((o) => o.value && o.text === want.label));
  sinkId = hit ? hit.value : '';
  select.value = sinkId;
  if (want.id && !hit) say('저장된 출력 장치를 찾을 수 없어 기본 장치로 재생합니다.');
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

$('edit').onclick = () => (sel < 0 ? say('패드를 먼저 선택하세요.') : openEdit());

$('del').onclick = () => {
  if (!cfg.pads[sel]) return say('삭제할 패드를 선택하세요.');
  if (!confirm(`"${cfg.pads[sel].name}" 패드를 삭제할까요? 사운드 파일도 함께 지워집니다.`)) return;
  stopPad(sel);
  cfg.pads[sel] = null;
  commit();
};

$('key').onclick = async () => {
  if (!cfg.pads[sel]) return say('사운드가 있는 패드를 먼저 선택하세요.');
  capturing = true;
  $('key').textContent = '키를 누르세요 (Esc 취소 · Backspace 해제)';
  $('key').blur();
  say('');
  await dp.hotkeys(false);
};

$('stop').onclick = () => [...players.keys()].forEach(stopPad);

$('device').onchange = (e) => {
  sinkId = e.target.value;
  const o = e.target.selectedOptions[0];
  cfg.device = sinkId ? { id: sinkId, label: o.text } : { id: '', label: '' };
  commit();
};

document.addEventListener('keydown', (e) => {
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
    el.innerHTML = '<span class="n"></span><span class="k"></span>';
    el.onclick = () => {
      if (capturing) endCapture(null);
      select(i);
      play(i);
    };
    $('grid').append(el);
    pads.push(el);
  }
  await loadDevices();
  render();
  warn();
  dp.onPlay(play);
  navigator.mediaDevices.addEventListener('devicechange', loadDevices);
})();
