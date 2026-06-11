// ==========================================================
// 📱 RawData Mobile Viewer - app.js
// 動きのプログラム（JavaScript）
// ==========================================================

let currentFiles = [];
let currentIndex = -1;
let currentCamera = 'front';
let currentMode = 'front'; // 'front', 'rear', 'map'
let telemetryData = [];
let isTransitioning = false;
let targetTime = -1;
let currentSpeed = 1.0;
let isSelectDone = false;
let clickTimeout = null;

// 地図オブジェクト
let map = null;
let carMarker = null;

const player = document.getElementById('player');
const seekBar = document.getElementById('seek-bar');
const currTimeDisp = document.getElementById('curr-time');
const totalTimeDisp = document.getElementById('total-time');

const btnCamera = document.getElementById('btn-camera');
const btnExport = document.getElementById('btn-export');
const btnSelect = document.getElementById('btn-select');
const speedSelect = document.getElementById('speed-select');

const loadingPanel = document.getElementById('loading-panel');
const listBoxContainer = document.getElementById('list-box-container');
const playlistContainer = document.getElementById('playlist-container');

const placeholder = document.getElementById('placeholder');
const hudTop = document.getElementById('hud-top');
const hudBottom = document.getElementById('hud-bottom');
const mapDiv = document.getElementById('map');
const videoContainer = document.querySelector('.video-container');

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// 🗺️ 地図 (Leaflet + OpenStreetMap) の初期化
function initMap() {
    if (map) return;
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    });
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);
    
    // クールな光る防犯カメラアイコンピン
    const carIcon = L.divIcon({
        html: '<div style="font-size: 28px; filter: drop-shadow(0 0 8px var(--accent));">🚖</div>',
        className: 'custom-div-icon',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
    
    carMarker = L.marker([35.6895, 139.6917], { icon: carIcon }).addTo(map);
}

// GPS座標のNMEA表記（度分: DDMM.MMMM）を十進法（度数）に極上デコードする関数
function parseNmeaCoords(coord_str, is_lon = false) {
    const val = parseFloat(coord_str);
    if (isNaN(val) || val === 0) return 0;
    const deg_len = is_lon ? 3 : 2;
    const deg = Math.floor(val / 100);
    const min_val = val - (deg * 100);
    return deg + (min_val / 60);
}

// 📸 フロント ➔ 🎥 リア ➔ 🗺️ 地図の3段ループ切替トグル！
function rotateViewMode() {
    const prevCamera = currentCamera;
    
    if (currentMode === 'front') {
        // フロントからリアへ
        currentMode = 'rear';
        currentCamera = 'rear';
        btnCamera.className = 'nav-btn rear-active';
        btnCamera.innerText = '🎥 リア映像';
        mapDiv.style.display = 'none';
        player.style.display = 'block';
    } else if (currentMode === 'rear') {
        // リアから地図へ
        currentMode = 'map';
        btnCamera.className = 'nav-btn map-active';
        btnCamera.innerText = '🗺️ 運行地図 (GPS)';
        player.style.display = 'none';
        mapDiv.style.display = 'block';
        
        // 地図の初期化を遅延実行（表示されてからサイズ計算させるため）
        setTimeout(() => {
            initMap();
            map.invalidateSize();
        }, 100);
    } else {
        // 地図からフロントへ
        currentMode = 'front';
        currentCamera = 'front';
        btnCamera.className = 'nav-btn front-active';
        btnCamera.innerText = '📸 フロント映像';
        mapDiv.style.display = 'none';
        player.style.display = 'block';
    }
    
    // 再生中の動画ソースを切り替え
    if (currentIndex >= 0 && currentMode !== 'map') {
        const cTime = player.currentTime;
        const wasPlaying = !player.paused;
        player.src = `/stream/${currentFiles[currentIndex]}?camera=${currentCamera}`;
        player.currentTime = cTime;
        if (wasPlaying) player.play().catch(e => console.log(e));
    }
}

let currentBrowserPath = "";

async function openFolderModal(targetPath = "") {
    const overlay = document.getElementById('folder-modal-overlay');
    overlay.style.display = 'flex';
    
    try {
        const res = await fetch(`/api/list_dirs?path=${encodeURIComponent(targetPath)}`);
        const data = await res.json();
        
        if (data.error) {
            alert("フォルダの読み込みに失敗しました: " + data.error);
            return;
        }
        
        currentBrowserPath = data.current_path;
        document.getElementById('current-path-display').innerText = currentBrowserPath;
        
        const listContainer = document.getElementById('folder-list');
        listContainer.innerHTML = '';
        
        data.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'folder-item';
            div.innerHTML = `<span style="font-size: 1.2em;">📁</span> <span>${item.name}</span>`;
            div.onclick = () => {
                openFolderModal(item.path);
            };
            listContainer.appendChild(div);
        });
    } catch (e) {
        console.error(e);
    }
}

function closeFolderModal() {
    document.getElementById('folder-modal-overlay').style.display = 'none';
}

async function confirmFolderSelection() {
    closeFolderModal();
    const btnSelect = document.getElementById('btn-select');
    const loadingPanel = document.getElementById('loading-panel');
    const placeholder = document.getElementById('placeholder');
    const hudTop = document.getElementById('hud-top');
    const hudBottom = document.getElementById('hud-bottom');
    
    const startInput = document.getElementById('time-start').value;
    const endInput = document.getElementById('time-end').value;
    
    if (startInput && endInput) {
        // スナイプモード（抽出）
        await doSnipeExtraction(startInput, endInput, loadingPanel, placeholder, hudTop, hudBottom);
    } else {
        alert("⚠️ 警告：開始時間または終了時間が指定されていません。必ず時間を指定してください。");
    }
}

// プレビューモードは熱暴走・ストレージ容量オーバー防止のため完全に廃止されました。

async function doSnipeExtraction(startInput, endInput, loadingPanel, placeholder, hudTop, hudBottom) {
    const startTimeStr = startInput.replace(/[-T:]/g, "") + "00";
    const endTimeStr = endInput.replace(/[-T:]/g, "") + "00";
    
    document.getElementById('loading-msg').innerText = "塊からスナイプ抽出中... (超高速)";
    loadingPanel.style.display = 'flex';
    
    try {
        const res = await fetch('/api/extract_by_time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                raw_path: currentBrowserPath,
                start_time: startTimeStr,
                end_time: endTimeStr
            })
        });
        
        const data = await res.json();
        loadingPanel.style.display = 'none';
        
        if (!data.success) {
            alert("抽出に失敗しました: " + data.error);
            return;
        }
        
        alert(`スナイプ抽出完了！\n${data.extracted} 個の動画データを一撃で抜き出しました。`);
        
        placeholder.style.display = 'none';
        player.style.opacity = '1';
        hudTop.style.opacity = '1';
        hudBottom.style.opacity = '1';
        isSelectDone = true;
        
        listBoxContainer.style.display = 'flex';
        loadPlaylist();
    } catch(e) {
        loadingPanel.style.display = 'none';
        console.error(e);
        alert("エラーが発生しました: " + e);
    }
}

function runSelectAnimation() {
    const startTimeInput = document.getElementById('time-start').value;
    const endTimeInput = document.getElementById('time-end').value;
    
    if (!startTimeInput || !endTimeInput) {
        alert("⚠️ 警告：データ量が極めて巨大なため、すべての映像をロードするプレビュー機能は廃止されました。\n機器の熱暴走や容量オーバーを防ぐため、必ず「開始時間」と「終了時間」を上部で指定してから「ファイル指定」を押してください。");
        return;
    }

    // フルスクリーン化されている場合、ボタンタップのタイミングで横画面ロックを再試行（確実化）
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(e => console.log(e));
    }
    
    const btnSelect = document.getElementById('btn-select');
    btnSelect.style.transform = 'scale(0.95)';
    setTimeout(async () => {
        btnSelect.style.transform = 'scale(1)';
        openFolderModal(""); // 空文字を渡してデフォルトパスから開始
    }, 200);
}

// ファイル名を表示リストにそのまま表示！
function renderPlaylist() {
    playlistContainer.innerHTML = '';
    currentFiles.forEach((filename, index) => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.id = 'item-' + index;
        
        // 「.dat」を取り除いたスッキリした名前
        const cleanName = filename.replace('.dat', '');
        
        div.innerHTML = `
            <div style="display: flex; align-items: center;">
                <input type="checkbox" id="chk-${index}" class="save-checkbox" onclick="event.stopPropagation(); updateSelectAllButtonText();">
                <span style="margin-left: 10px;">${cleanName}</span>
            </div>
        `;
        
        div.onclick = () => playVideo(index);
        playlistContainer.appendChild(div);
    });
    // プレイリスト描画時に全選択ボタンの状態を初期化・同期させる
    updateSelectAllButtonText();
}               

// 📦 プレイリスト内のチェックボックスをすべて選択（またはすべて解除）する関数
function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.save-checkbox');
    if (checkboxes.length === 0) return;
    
    // 全てチェックされているか確認
    const allChecked = Array.from(checkboxes).every(chk => chk.checked);
    
    // 全てチェックされているなら全解除、そうでなければ全選択
    checkboxes.forEach(chk => {
        chk.checked = !allChecked;
    });
    
    updateSelectAllButtonText();
}

// 🏷️ チェックボックスの選択状況に応じて「全選択 / 全解除」ボタンの表示を自動切り替えする関数
function updateSelectAllButtonText() {
    const btnToggleAll = document.getElementById('btn-toggle-all');
    if (!btnToggleAll) return;
    
    const checkboxes = document.querySelectorAll('.save-checkbox');
    if (checkboxes.length === 0) {
        btnToggleAll.innerText = "全選択";
        btnToggleAll.style.background = "rgba(80, 80, 80, 0.8)";
        btnToggleAll.style.borderColor = "#555";
        return;
    }
    
    const allChecked = Array.from(checkboxes).every(chk => chk.checked);
    if (allChecked) {
        btnToggleAll.innerText = "全解除";
        btnToggleAll.style.background = "rgba(255, 59, 48, 0.8)";
        btnToggleAll.style.borderColor = "#c01a11";
        btnToggleAll.style.padding = "3px 8px";
        btnToggleAll.style.fontSize = "0.7em";
    } else {
        btnToggleAll.innerText = "全選択";
        btnToggleAll.style.background = "rgba(80, 80, 80, 0.8)";
        btnToggleAll.style.borderColor = "#555";
        btnToggleAll.style.padding = "3px 8px";
        btnToggleAll.style.fontSize = "0.7em";
    }
}


async function loadPlaylist() {
    try {
        const response = await fetch('/api/videos');
        const data = await response.json();
        if (data.videos && data.videos.length > 0) {
            // 若い順（古い日付・時間が上に来るように昇順ソート）
            currentFiles = data.videos.sort(); 
            renderPlaylist();
            document.getElementById('btn-export').disabled = false;
            playVideo(0); 
        } else {
            currentFiles = [];
            renderPlaylist();
        }
    } catch (e) {}
}

async function fetchTelemetry(filename) {
    try {
        const res = await fetch(`/api/telemetry?file=${encodeURIComponent(filename)}`);
        telemetryData = await res.json();
    } catch (e) { telemetryData = []; }
}

// アプリ起動時に強制的に横画面をロックするフォールバック + 開始時間と終了時間のスマート連動
document.addEventListener('DOMContentLoaded', () => {
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(e => console.log('Orientation lock failed or not supported:', e));
    }
    
    // 開始時間をセットしたら終了時間を自動的に「開始時間の5分後」に仮セットしてダイアルの初期位置を同期させる
    const startTimeInput = document.getElementById('time-start');
    const endTimeInput = document.getElementById('time-end');
    
    if (startTimeInput && endTimeInput) {
        startTimeInput.addEventListener('change', (e) => {
            const startVal = e.target.value;
            if (startVal) {
                // 開始時間の5分後を計算
                const startDate = new Date(startVal);
                startDate.setMinutes(startDate.getMinutes() + 5);
                
                // YYYY-MM-DDTHH:mm フォーマットに手動変換 (タイムゾーンのズレを防ぐためローカル処理)
                const yyyy = startDate.getFullYear();
                const mm = String(startDate.getMonth() + 1).padStart(2, '0');
                const dd = String(startDate.getDate()).padStart(2, '0');
                const hh = String(startDate.getHours()).padStart(2, '0');
                const min = String(startDate.getMinutes()).padStart(2, '0');
                
                endTimeInput.value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
            }
        });
    }
});

function playVideo(index, keepTime = false) {
    if (index < 0 || index >= currentFiles.length) return;
    isTransitioning = false;
    
    if (currentIndex >= 0) {
        document.getElementById('item-' + currentIndex)?.classList.remove('playing');
    }
    currentIndex = index;
    const activeItem = document.getElementById('item-' + currentIndex);
    if (activeItem) {
        activeItem.classList.add('playing');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const filename = currentFiles[index];
    const currentTime = keepTime ? player.currentTime : 0;
    targetTime = keepTime ? currentTime : -1;
    
    if (!keepTime) fetchTelemetry(filename);
    
    player.style.opacity = "0.5";
    player.src = `/stream/${encodeURIComponent(filename)}?camera=${currentCamera}`;
    player.playbackRate = currentSpeed;
    player.play().catch(e => console.log(e));
}

setInterval(() => {
    if (targetTime >= 0 && player.readyState >= 1) {
        player.currentTime = targetTime;
        player.style.opacity = "1";
        targetTime = -1;
    }
}, 50);

// 💾 SDカードへ保存 (チェックされた動画を結合してダウンロード保存)
async function exportToSD() {
    const checkboxes = document.querySelectorAll('.save-checkbox');
    const selectedIndexes = [];
    
    checkboxes.forEach((chk, idx) => {
        if (chk.checked) selectedIndexes.push(idx);
    });
    
    if (selectedIndexes.length === 0) {
        alert("保存したい動画のチェックボックスにチェックを入れてください。");
        return;
    }
    
    // 連続チェックのバリデーション
    selectedIndexes.sort((a, b) => a - b);
    let isContinuous = true;
    for (let i = 1; i < selectedIndexes.length; i++) {
        if (selectedIndexes[i] - selectedIndexes[i-1] !== 1) {
            isContinuous = false;
            break;
        }
    }
    if (!isContinuous) {
        alert("保存するファイルは連続した時間（チェックが連続）である必要があります。\nチェックが抜けている箇所がないか確認してください。");
        return;
    }
    
    // 出力ファイル名の生成
    const firstFile = currentFiles[selectedIndexes[0]].replace('.dat', '');
    const lastFile = currentFiles[selectedIndexes[selectedIndexes.length - 1]].replace('.dat', '');
    
    let out_filename = "";
    if (selectedIndexes.length === 1) {
        out_filename = `${firstFile}_${currentCamera}.mp4`;
    } else {
        const firstParts = firstFile.split('_');
        const lastParts = lastFile.split('_');
        
        const startDate = firstParts[0];
        const startTime = firstParts[1] || "";
        const endTime = lastParts[1] || "";
        
        out_filename = `${startDate}_${startTime}-${endTime}_${currentCamera}.mp4`;
    }
    
    // 結合するファイルのリストを作成
    const filesToMerge = selectedIndexes.map(idx => currentFiles[idx]);
    
    // ==========================================
    // 🗺️ 地図モードの場合は「ルートデータ(KML/CSV)」として出力
    // ==========================================
    if (currentMode === 'map') {
        const format = prompt("ルートデータを保存します。\n保存形式を「kml」または「csv」で入力してください。", "kml");
        if (format === null) return;
        const ext = format.toLowerCase().trim() === 'csv' ? 'csv' : 'kml';
        
        let route_filename = "";
        if (selectedIndexes.length === 1) {
            route_filename = `${firstFile}.${ext}`;
        } else {
            const firstParts = firstFile.split('_');
            const lastParts = lastFile.split('_');
            route_filename = `${firstParts[0]}_${firstParts[1] || ""}-${lastParts[1] || ""}.${ext}`;
        }
        
        const loadingPanel = document.getElementById('loading-panel');
        document.getElementById('loading-msg').innerText = "ルートデータを生成中... しばらくお待ちください";
        loadingPanel.style.display = 'flex';
        
        try {
            let allPoints = [];
            for (let filename of filesToMerge) {
                const res = await fetch(`/api/telemetry?file=${encodeURIComponent(filename)}`);
                const data = await res.json();
                const validPoints = data.filter(p => p.lat && p.lon && p.lat !== "" && p.lon !== "");
                allPoints.push(...validPoints);
            }
            
            let fileContent = "";
            if (ext === 'csv') {
                fileContent = "Time,Latitude,Longitude,Speed(km/h)\n";
                allPoints.forEach(p => {
                    const decLat = parseNmeaCoords(p.lat, false);
                    const decLon = parseNmeaCoords(p.lon, true);
                    fileContent += `${p.time},${decLat.toFixed(6)},${decLon.toFixed(6)},${p.speed}\n`;
                });
            } else {
                let coordsText = "";
                allPoints.forEach(p => {
                    const decLat = parseNmeaCoords(p.lat, false);
                    const decLon = parseNmeaCoords(p.lon, true);
                    coordsText += `${decLon.toFixed(6)},${decLat.toFixed(6)},0\n`;
                });
                
                fileContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${route_filename}</name>
    <Style id="routeStyle">
      <LineStyle>
        <color>ff0000ff</color> <!-- 赤色の線 -->
        <width>5</width>
      </LineStyle>
    </Style>
    <Placemark>
      <name>走行ルート</name>
      <styleUrl>#routeStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
${coordsText}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
            }
            
            loadingPanel.style.display = 'none';
            
            const blob = new Blob([fileContent], { type: ext === 'csv' ? 'text/csv' : 'application/vnd.google-earth.kml+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = route_filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            loadingPanel.style.display = 'none';
            alert("ルートデータの生成中にエラーが発生しました。");
            console.error(error);
        }
        
        return;
    }
    
    // ==========================================
    // 🎥 フロント/リアモードの場合は「動画」として出力
    // ==========================================
    const loadingPanel = document.getElementById('loading-panel');
    document.getElementById('loading-msg').innerText = "ファイルを結合中... しばらくお待ちください";
    loadingPanel.style.display = 'flex';
    
    try {
        const response = await fetch('/api/export_merged', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: filesToMerge,
                camera: currentCamera,
                out_filename: out_filename
            })
        });
        
        const data = await response.json();
        loadingPanel.style.display = 'none';
        
        if (data.success) {
            const a = document.createElement('a');
            a.href = data.url;
            a.download = out_filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            alert("ファイルの結合中にエラーが発生しました: " + data.error);
        }
    } catch (error) {
        loadingPanel.style.display = 'none';
        alert("サーバーとの通信に失敗しました。");
        console.error(error);
    }
}

function seekVideo(seconds) {
    let newTime = player.currentTime + seconds;
    if (newTime < 0) newTime = 0;
    if (newTime > player.duration) newTime = player.duration;
    player.currentTime = newTime;
}

function changeSpeed(speed) {
    currentSpeed = parseFloat(speed);
    player.playbackRate = currentSpeed;
}

// 📱 YouTube風 ダブルタップ/ダブルクリックジェスチャー操作の実装！
videoContainer.addEventListener('click', (e) => {
    if (e.target.closest('#hud-bottom') || 
        e.target.closest('#hud-top') || 
        e.target.closest('.sidebar') || 
        e.target.closest('#map') || 
        e.target.closest('#placeholder')) {
        return;
    }
    
    const rect = videoContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const isRightSide = clickX > (rect.width / 2);
    
    if (clickTimeout) {
        // 【ダブルタップ検知！】
        clearTimeout(clickTimeout);
        clickTimeout = null;
        
        if (isRightSide) {
            seekVideo(5);
            showRipple("▶▶ 5秒進む");
        } else {
            seekVideo(-5);
            showRipple("◀◀ 5秒戻る");
        }
    } else {
        // シングルタップ待機
        clickTimeout = setTimeout(() => {
            clickTimeout = null;
            if (isSelectDone) {
                if (player.paused) player.play();
                else player.pause();
            }
        }, 220);
    }
});

// タップ時に画面中央に浮かび上がるサイバーなインジケーター（Ripple）の演出
function showRipple(text) {
    const ripple = document.createElement('div');
    ripple.innerText = text;
    ripple.style.position = 'absolute';
    ripple.style.top = '50%';
    ripple.style.left = '50%';
    ripple.style.transform = 'translate(-50%, -50%)';
    ripple.style.background = 'rgba(0,0,0,0.85)';
    ripple.style.color = 'var(--accent)';
    ripple.style.border = '1px solid var(--accent)';
    ripple.style.padding = '12px 24px';
    ripple.style.borderRadius = '20px';
    ripple.style.fontFamily = 'monospace';
    ripple.style.fontSize = '1.3em';
    ripple.style.fontWeight = 'bold';
    ripple.style.zIndex = '999';
    ripple.style.pointerEvents = 'none';
    ripple.style.boxShadow = '0 0 15px var(--accent)';
    ripple.style.transition = 'opacity 0.4s, transform 0.4s';
    
    videoContainer.appendChild(ripple);
    
    setTimeout(() => {
        ripple.style.opacity = '0';
        ripple.style.transform = 'translate(-50%, -50%) scale(1.2)';
        setTimeout(() => ripple.remove(), 400);
    }, 250);
}

seekBar.addEventListener('input', () => { player.currentTime = seekBar.value; });

player.ontimeupdate = () => {
    const t = player.currentTime;
    
    if (player.duration) {
        seekBar.max = player.duration;
        seekBar.value = t;
        currTimeDisp.innerText = formatTime(t);
        totalTimeDisp.innerText = formatTime(player.duration);
    }
    
    if (player.duration > 0 && player.duration - t < 0.5) {
        if (!isTransitioning && currentIndex + 1 < currentFiles.length) {
            isTransitioning = true;
            setTimeout(() => { playVideo(currentIndex + 1); }, 100);
        }
    }

    if (!telemetryData || telemetryData.length === 0) return;
    
    let closest = telemetryData[0];
    for (let i = 0; i < telemetryData.length; i++) {
        if (telemetryData[i].offset <= t) closest = telemetryData[i];
        else break;
    }
    
    if (closest) {
        document.getElementById('disp-time').innerText = closest.time;
        document.getElementById('disp-speed').innerText = closest.speed;
        
        // 📡 NMEA度分（DDMM.MMMM）を十進数（度）に極上デコードしてHUDに表示！
        const latDec = parseNmeaCoords(closest.lat, false);
        const lonDec = parseNmeaCoords(closest.lon, true);
        if (latDec !== 0 && lonDec !== 0) {
            document.getElementById('disp-gps').innerText = latDec.toFixed(5) + ", " + lonDec.toFixed(5);
        } else {
            document.getElementById('disp-gps').innerText = "---.---, ---.---";
        }
        
        // 🗺️ 現在地が地図モードなら、 Leaflet 上の防犯カメラピンを滑らかに移動追従させる！
        if (currentMode === 'map' && latDec !== 0 && lonDec !== 0) {
            const newPos = [latDec, lonDec];
            if (carMarker) carMarker.setLatLng(newPos);
            if (map) map.setView(newPos, 16);
        }
    }
};

player.addEventListener('loadeddata', () => { player.style.opacity = "1"; });
