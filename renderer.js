const SIGNAL_URL = 'wss://sharecrow-signal.onrender.com/ws';

const resolutions = [
  { value: '1440p', label: '1440p', width: 2560, height: 1440 },
  { value: '1080p', label: '1080p', width: 1920, height: 1080 },
  { value: '720p', label: '720p', width: 1280, height: 720 },
];
const fpsOptions = [
  { value: 60, label: '60 fps' },
  { value: 30, label: '30 fps' },
];

let selectedResolution = resolutions[1];
let selectedFps = 30;

let ws = null;
let localStream = null;
let isCreator = false;
let statsInterval = null;

// Mapeamento de conexões para suportar múltiplos viewers: { peerId: RTCPeerConnection }
let peerConnections = {};

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localEmpty = document.getElementById('localEmpty');
const remoteEmpty = document.getElementById('remoteEmpty');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const localControls = document.getElementById('localControls');
const remoteControls = document.getElementById('remoteControls');
const createRoomBtn = document.getElementById('createRoomBtn');
const createHint = document.getElementById('createHint');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const codeInput = document.getElementById('codeInput');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const errorText = document.getElementById('errorText');
const localFullscreenBtn = document.getElementById('localFullscreenBtn');
const remoteFullscreenBtn = document.getElementById('remoteFullscreenBtn');
const remoteMuteBtn = document.getElementById('remoteMuteBtn');
const remoteVolumeSlider = document.getElementById('remoteVolumeSlider');
const remoteQualityBadge = document.getElementById('remoteQualityBadge');
const localFrame = document.getElementById('localFrame');
const remoteFrame = document.getElementById('remoteFrame');
const roomCountBadge = document.getElementById('roomCountBadge');
const roomCountText = document.getElementById('roomCountText');

// Elementos do Modal de Seleção
const sourceModal = document.getElementById('sourceModal');
const sourceList = document.getElementById('sourceList');
const closeModalBtn = document.getElementById('closeModalBtn');

function renderQualityPicker() {
  const resContainer = document.getElementById('resolutionOptions');
  resContainer.innerHTML = '';
  resolutions.forEach((res) => {
    const btn = document.createElement('button');
    btn.className = 'quality-btn' + (res.value === selectedResolution.value ? ' active' : '');
    btn.textContent = res.label;
    btn.onclick = () => { selectedResolution = res; renderQualityPicker(); };
    resContainer.appendChild(btn);
  });

  const fpsContainer = document.getElementById('fpsOptions');
  fpsContainer.innerHTML = '';
  fpsOptions.forEach((fps) => {
    const btn = document.createElement('button');
    btn.className = 'quality-btn' + (fps.value === selectedFps ? ' active' : '');
    btn.textContent = fps.label;
    btn.onclick = () => { selectedFps = fps.value; renderQualityPicker(); };
    fpsContainer.appendChild(btn);
  });
}
renderQualityPicker();

function setStatus(streaming) {
  statusText.textContent = streaming ? 'transmitindo' : 'em repouso';
  statusBadge.classList.toggle('live', streaming);
}

function updateRoomCount(count) {
  if (count > 0) {
    roomCountText.textContent = count;
    roomCountBadge.style.display = 'flex';
  } else {
    roomCountBadge.style.display = 'none';
  }
}

function showError(msg) {
  errorText.textContent = msg;
}

// --- Seletor de Telas / Janelas ---
startBtn.onclick = async () => {
  showError('');
  try {
    if (!window.electronAPI || !window.electronAPI.getSources) {
      showError('API do Electron não foi carregada. Verifique o preload.js.');
      return;
    }

    const sources = await window.electronAPI.getSources();
    sourceList.innerHTML = '';

    sources.forEach((source) => {
      const item = document.createElement('div');
      item.className = 'source-item';
      item.innerHTML = `
        <img src="${source.thumbnail}" alt="${source.name}" />
        <span title="${source.name}">${source.name}</span>
      `;
      item.onclick = () => startCapture(source.id);
      sourceList.appendChild(item);
    });

    sourceModal.style.display = 'flex';
  } catch (err) {
    console.error('Erro ao buscar janelas:', err);
    showError('Erro ao listar fontes de vídeo: ' + err.message);
  }
};

closeModalBtn.onclick = () => {
  sourceModal.style.display = 'none';
};

async function startCapture(sourceId) {
  sourceModal.style.display = 'none';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'desktop' },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: selectedResolution.width,
          maxHeight: selectedResolution.height,
          maxFrameRate: selectedFps,
        },
      },
    });

    localVideo.srcObject = localStream;
    localEmpty.style.display = 'none';
    localControls.style.display = 'flex';
    createRoomBtn.disabled = false;
    createHint.style.display = 'none';
    setStatus(true);

    localStream.getVideoTracks()[0].onended = () => stopBroadcast(true);
  } catch (err) {
    console.error('Erro ao capturar fonte selecionada:', err);
    showError('Não foi possível capturar a janela/áudio: ' + err.message);
  }
}

stopBtn.onclick = () => stopBroadcast(true);

function stopBroadcast(notifyPeer) {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  localEmpty.style.display = 'flex';
  localControls.style.display = 'none';
  setStatus(false);
  updateRoomCount(0);

  if (notifyPeer && ws && ws.readyState === WebSocket.OPEN) {
    sendSignal({ type: 'relay', payload: { kind: 'stream-ended' } });
  }

  // Fecha todas as conexões ativas
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
}

function resetRemoteView() {
  remoteVideo.srcObject = null;
  remoteEmpty.style.display = 'flex';
  remoteControls.style.display = 'none';
  remoteQualityBadge.style.display = 'none';
  stopStatsPolling();
}

// --- Configuração WebRTC (STUN) ---
const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[peerId] = pc;

  // Se for o criador, injeta as trilhas locais na conexão deste peer específico
  if (isCreator && localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    // Usado se você for o espectador recebendo a stream do criador
    remoteVideo.srcObject = event.streams[0];
    remoteEmpty.style.display = 'none';
    remoteControls.style.display = 'flex';
    remoteVideo.play().catch((err) => console.warn('Autoplay bloqueado:', err));
    startStatsPolling();
  };

  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      delete peerConnections[peerId];
      if (!isCreator) resetRemoteView();
    }
  };

  return pc;
}

function waitIceGatheringComplete(connection) {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (connection.iceGatheringState === 'complete') {
        connection.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    }
    connection.addEventListener('icegatheringstatechange', check);
  });
}

function startStatsPolling() {
  stopStatsPolling();
  statsInterval = setInterval(async () => {
    const activePc = Object.values(peerConnections)[0];
    if (!activePc) return;
    const stats = await activePc.getStats();
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        const h = report.frameHeight;
        const fps = Math.round(report.framesPerSecond || 0);
        if (h) {
          remoteQualityBadge.textContent = `${h}p · ${fps}fps`;
          remoteQualityBadge.style.display = 'block';
        }
      }
    });
  }, 2000);
}

function stopStatsPolling() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = null;
}

// --- Volume ---
remoteMuteBtn.onclick = () => {
  remoteVideo.muted = !remoteVideo.muted;
  remoteMuteBtn.textContent = remoteVideo.muted ? '🔇' : '🔊';
};
remoteVolumeSlider.oninput = () => {
  remoteVideo.volume = remoteVolumeSlider.value / 100;
  if (remoteVideo.volume > 0 && remoteVideo.muted) {
    remoteVideo.muted = false;
    remoteMuteBtn.textContent = '🔊';
  }
};

// --- Sinalização (WebSocket) ---
function connectSignal() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(SIGNAL_URL);
    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(err);
    ws.onmessage = (event) => handleSignalMessage(JSON.parse(event.data));
  });
}

function sendSignal(msg) {
  ws.send(JSON.stringify(msg));
}

async function handleSignalMessage(msg) {
  switch (msg.type) {
    case 'created':
      roomCodeDisplay.textContent = msg.code;
      roomCodeDisplay.style.display = 'block';
      updateRoomCount(1); // Só você na sala inicialmente
      break;
    case 'room_update':
      // O servidor avisa quantas pessoas estão na sala
      updateRoomCount(msg.count);
      break;
    case 'peer_joined':
      // msg.peerId identifica o novo espectador que entrou
      if (isCreator) {
        await createAndSendOfferToPeer(msg.peerId);
      }
      break;
    case 'peer_left':
      if (peerConnections[msg.peerId]) {
        peerConnections[msg.peerId].close();
        delete peerConnections[msg.peerId];
      }
      break;
    case 'relay':
      await handleRelay(msg.peerId, msg.payload);
      break;
    case 'error':
      showError(msg.message);
      break;
  }
}

createRoomBtn.onclick = async () => {
  showError('');
  try {
    await connectSignal();
    isCreator = true;
    sendSignal({ type: 'create' });
  } catch (err) {
    showError('Erro ao conectar no servidor de sinalização: ' + err.message);
  }
};

joinRoomBtn.onclick = async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return;

  showError('');
  try {
    await connectSignal();
    isCreator = false;
    sendSignal({ type: 'join', code });
  } catch (err) {
    showError('Erro ao conectar no servidor de sinalização: ' + err.message);
  }
};

async function createAndSendOfferToPeer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGatheringComplete(pc);

  sendSignal({
    type: 'relay',
    targetPeerId: peerId,
    payload: { sdp_type: 'offer', sdp: pc.localDescription },
  });
}

async function handleRelay(peerId, payload) {
  if (payload.kind === 'stream-ended') {
    resetRemoteView();
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    return;
  }

  const { sdp_type, sdp } = payload;

  if (sdp_type === 'offer') {
    // Se você for o espectador, recebe a oferta do criador
    const pc = createPeerConnection('creator');
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceGatheringComplete(pc);

    sendSignal({
      type: 'relay',
      payload: { sdp_type: 'answer', sdp: pc.localDescription },
    });
  } else if (sdp_type === 'answer') {
    // Se você for o criador, recebe a resposta do espectador específico
    const pc = peerConnections[peerId];
    if (pc) {
      await pc.setRemoteDescription(sdp);
    }
  }
}

localFullscreenBtn.onclick = () => localFrame.requestFullscreen();
remoteFullscreenBtn.onclick = () => remoteFrame.requestFullscreen();