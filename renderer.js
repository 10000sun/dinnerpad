const $ = (id) => document.getElementById(id);
const N = 25;
const NAME = { output: '출력 장치', input: '입력 장치' };
const players = new Map(); // 패드 번호 -> 재생 중인 Audio
const pads = [];
// 장치 id. output은 ''(시스템 기본), input은 null(사용 안 함)
const sinks = { output: '', input: null };
let cfg, soundsUrl, sel = -1, capturing = false, failed = new Set(), draft;
let voice = null; // 내 마이크 -> 마이크로 보낼 장치로 흘려보내는 중인 오디오 그래프
let voiceJob = Promise.resolve();

const say = (msg) => { $('status').textContent = msg || ''; };

// 내 마이크는 입력 장치가 골라져 있고 켜져 있을 때만 섞는다
const voiceOn = () => sinks.input !== null && cfg.micOn;

function warn() {
  if (!cfg.hotkeys) return say('전역 단축키가 꺼져 있습니다.');
  say(failed.size ?`단축키 등록 실패(다른 프로그램이 쓰는 조합일 수 있음): 패드 ${[...failed].map((i) => i + 1).join(', ')}` : '');
}

function render() {
  $('tg-mic').setAttribute('aria-pressed', voiceOn());
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
  const a = players.get(i);
  if (a) { a.pause(); players.delete(i); }
  pads[i].classList.remove('on');
}

function play(i) {
  const p = cfg.pads[i];
  if (!p) return;
  stopPad(i);
  const a = new Audio(soundsUrl + encodeURIComponent(p.file));
  a.volume = cfg.volume.output / 100;
  players.set(i, a);
  const fail = (e) => { stopPad(i); say(`재생 실패: ${p.name} (${(e && e.message) || '알 수 없는 오류'})`); };
  a.onended = () => { if (players.get(i) === a) stopPad(i); };
  a.onerror = () => fail(a.error);
  pads[i].classList.add('on');
  (sinks.output ? a.setSinkId(sinks.output) : Promise.resolve()).then(() => a.play()).catch(fail);
}

// 목록을 채우고 저장된 장치를 id, 그다음 이름으로 찾아 고른다. 못 찾으면 null
// (설정은 그대로 두고 이번 실행에서만 쓰지 않는다)
function fill(select, list, none, want) {
  select.replaceChildren(new Option(none, ''));
  list.forEach((d, i) => select.add(new Option(d.label || `장치 ${i + 1}`, d.deviceId)));
  const hit = want.id && ([...select.options].find((o) => o.value === want.id) || [...select.options].find((o) => o.value && o.text === want.label));
  select.value = hit ? hit.value : '';
  return hit ? hit.value : null;
}

async function loadDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const outs = devs.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const ins = devs
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
    .map((d) => (d.deviceId === 'default' ? { deviceId: 'default', label: '시스템 기본 마이크' } : d));
  const output = fill($('dev-output'), outs, '시스템 기본', cfg.output);
  sinks.output = output || '';
  sinks.input = fill($('dev-input'), ins, '사용 안 함', cfg.input);
  render();
  const lost = [];
  if (cfg.output.id && !output) lost.push(NAME.output);
  if (cfg.input.id && !sinks.input) lost.push(NAME.input);
  if (lost.length) say(`${lost.join(', ')}를 찾을 수 없습니다. ${lost.includes(NAME.output) ? '시스템 기본 장치로 재생합니다.' : ''}`);
  syncVoice();
}

// 입력 장치(내 마이크)를 출력 장치로 흘려보낸다. 같은 장치로 나가는 패드 소리와는 Windows가 섞어 준다
async function startVoice() {
  const key = voiceOn() ? sinks.input + '|' + sinks.output : '';
  if (voice && voice.key === key) return;
  if (voice) {
    voice.stream.getTracks().forEach((t) => t.stop());
    await voice.ctx.close();
    voice = null;
  }
  if (!key) return;
  try {
    // 디스코드 등이 따로 처리하므로 브라우저의 음성 보정은 끈다
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: sinks.input }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext({ latencyHint: 'interactive', sinkId: sinks.output });
    const gain = ctx.createGain();
    gain.gain.value = cfg.volume.voice / 100;
    ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
    voice = { key, ctx, stream, gain };
  } catch (e) {
    say(`입력 장치를 시작하지 못했습니다: ${e.message}`);
  }
}
const syncVoice = () => (voiceJob = voiceJob.then(startVoice));

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
  if (sinks.input === null) {
    say('설정 탭에서 입력 장치를 먼저 고르세요.');
    return false; // 저장하면 안내가 지워지므로 건너뛴다
  }
  cfg.micOn = !cfg.micOn;
  syncVoice();
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
for (const k of ['output', 'input']) {
  $('dev-' + k).onchange = (e) => {
    const v = e.target.value;
    sinks[k] = v || (k === 'output' ? '' : null);
    cfg[k] = v ? { id: v, label: e.target.selectedOptions[0].text } : { id: '', label: '' };
    syncVoice(); // 내 마이크나 흘러갈 곳이 바뀐다
    commit();
  };
}
for (const k of ['output', 'voice']) {
  const r = $('vol-' + k);
  r.oninput = () => {
    cfg.volume[k] = +r.value;
    $('out-' + k).textContent = r.value + '%';
    if (k === 'output') players.forEach((a) => { a.volume = r.value / 100; });
    else if (voice) voice.gain.gain.value = r.value / 100;
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
  for (const k of ['output', 'voice']) {
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
    syncVoice(); // 트레이 메뉴에서 내 마이크를 켜고 끌 수 있다
  });
  navigator.mediaDevices.addEventListener('devicechange', loadDevices);
})();
