let map, carMarker, routePolyline;
let gpsData = [];
let videoDuration = 0;
let currentItem = null;
let currentCamera = 'front'; // 'front' or 'back'
let currentSpeed = 1.0; // Persists playback speed
let loadedItems = {}; // Contains the aggregated list of files
let isSeeking = false; // Flag to check if video is seeking

// UI Elements
const selectFilesBtn = document.getElementById('selectFilesBtn');
const fileSelector = document.getElementById('fileSelector');
const videoListEl = document.getElementById('videoList');
const videoPlayer = document.getElementById('dashcamVideo');
const currentInfo = document.getElementById('currentInfo');
const toggleCameraBtn = document.getElementById('toggleCameraBtn');
const exportBtn = document.getElementById('exportBtn');
const mergeExportBtn = document.getElementById('mergeExportBtn');
const cameraLabel = document.getElementById('cameraLabel');
const selectAllBtn = document.getElementById('selectAllBtn');
const skipBackBtn = document.getElementById('skipBackBtn');

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessage = document.getElementById('loadingMessage');
const loadingProgress = document.getElementById('loadingProgress');
const dragOverlay = document.getElementById('dragOverlay');

const speedOverlay = document.getElementById('speedOverlay');
const timeOverlay = document.getElementById('timeOverlay');
const dashboardSpeed = document.getElementById('dashboardSpeed');
const dashboardLocation = document.getElementById('dashboardLocation');
const dashboardTime = document.getElementById('dashboardTime');

let currentTileLayer;

// Tile Layer URLs & Options
const mapTiles = {
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        options: {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            maxZoom: 20,
            maxNativeZoom: 20
        }
    },
    street: {
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        options: {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            maxZoom: 20,
            maxNativeZoom: 18 // voyager goes up to 18 natives, will upscale to 20!
        }
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
            attribution: '&copy; Esri &copy; OpenStreetMap',
            maxZoom: 20,
            maxNativeZoom: 19 // esri world imagery goes up to 19 native, will upscale to 20!
        }
    }
};

// Init Map
function initMap() {
    map = L.map('map', {
        zoomControl: false, // Hide default zoom buttons for our custom styling
        maxZoom: 20
    }).setView([34.6937, 135.5023], 13);
    
    // Add default street layer
    currentTileLayer = L.tileLayer(mapTiles.street.url, mapTiles.street.options).addTo(map);

    const carIcon = L.divIcon({
        className: 'custom-car-icon',
        html: `<div style="background-color: #66fcf1; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px #66fcf1;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });

    carMarker = L.marker([34.6937, 135.5023], { icon: carIcon }).addTo(map);
    routePolyline = L.polyline([], { color: '#ff3366', weight: 4, opacity: 0.7 }).addTo(map);
}

// Fullscreen Drag & Drop counter to avoid glitches
let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
        dragOverlay.classList.add('active');
    }
});

window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
        dragOverlay.classList.remove('active');
    }
});

window.addEventListener('dragover', (e) => {
    e.preventDefault();
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove('active');
    handleFiles(e.dataTransfer.files);
});

// Trigger hidden file selector
selectFilesBtn.addEventListener('click', () => {
    fileSelector.click();
});

fileSelector.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

// Convert NMEA UTC time to Japan Standard Time (JST = UTC + 9 hours)
function convertUTCToJST(timeStr) {
    if (!timeStr) return '--:--:--';
    const parts = timeStr.split(':');
    if (parts.length !== 3) return timeStr;
    
    let hh = parseInt(parts[0], 10);
    const mm = parts[1];
    const ss = parts[2];
    
    hh = (hh + 9) % 24;
    return `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
}

// Core File Processing (RawData upload & local file matching)
async function handleFiles(files) {
    if (files.length === 0) return;

    const rawDataFiles = [];
    const localMediaFiles = [];

    for (let file of files) {
        if (file.name.endsWith(".dat")) {
            rawDataFiles.push(file);
        } else if (file.name.endsWith("_front.mp4") || file.name.endsWith("_back.mp4") || file.name.endsWith("_gps.json")) {
            localMediaFiles.push(file);
        }
    }

    // 1. Handle local MP4 / JSON files directly
    if (localMediaFiles.length > 0) {
        loadingOverlay.style.display = 'flex';
        loadingMessage.innerText = "ローカルファイルをロード中...";
        loadingProgress.innerText = "まとめてグループ化しています";

        for (let file of localMediaFiles) {
            const name = file.name;
            let prefix = "";
            let type = "";

            if (name.endsWith("_front.mp4")) {
                prefix = name.replace("_front.mp4", "");
                type = "front";
            } else if (name.endsWith("_back.mp4")) {
                prefix = name.replace("_back.mp4", "");
                type = "back";
            } else if (name.endsWith("_gps.json")) {
                prefix = name.replace("_gps.json", "");
                type = "gps";
            }

            if (!loadedItems[prefix]) {
                loadedItems[prefix] = {
                    id: prefix,
                    title: formatTitle(prefix),
                    isLocal: true,
                    front: null,
                    back: null,
                    gps: null
                };
            }
            loadedItems[prefix][type] = file;
        }
        
        loadingOverlay.style.display = 'none';
    }

    // 2. Handle RawData files by uploading to local server for instant extraction
    if (rawDataFiles.length > 0) {
        loadingOverlay.style.display = 'flex';
        
        for (let i = 0; i < rawDataFiles.length; i++) {
            const file = rawDataFiles[i];
            const prefix = file.name.replace(".dat", "");
            
            loadingMessage.innerText = `防犯カメラ生データ解析中 (${i + 1} / ${rawDataFiles.length})`;
            loadingProgress.innerText = `ファイル名: ${file.name}\n(この処理には通常2〜5秒かかります)`;
            currentInfo.innerText = `${file.name} (解析中...)`;

            try {
                const response = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
                    method: 'POST',
                    body: file
                });

                if (!response.ok) throw new Error("Upload failed");
                const data = await response.json();

                if (data.success) {
                    loadedItems[prefix] = {
                        id: prefix,
                        title: formatTitle(prefix),
                        isLocal: false,
                        front: data.front,
                        back: data.back,
                        gps: data.gps
                    };
                } else {
                    console.error("Failed to extract raw_data:", file.name);
                }
            } catch (err) {
                console.error("Server connection error for raw_data:", file.name);
            }
        }
        
        loadingOverlay.style.display = 'none';
    }

    renderVideoList();
}

function formatTitle(prefix) {
    const parts = prefix.split('_');
    if (parts.length >= 2) {
        const date = parts[0];
        const time = parts[1];
        return `${date.slice(0,4)}/${date.slice(4,6)}/${date.slice(6)} ${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4)}`;
    }
    return prefix;
}

function renderVideoList() {
    const keys = Object.keys(loadedItems).sort();
    
    if (selectAllBtn) {
        selectAllBtn.innerText = "すべて選択";
        selectAllBtn.classList.remove('active');
    }
    
    if (keys.length === 0) {
        videoListEl.innerHTML = `<div class="empty-list-message">ファイルが選択されていません</div>`;
        return;
    }

    videoListEl.innerHTML = '';
    keys.forEach(key => {
        const v = loadedItems[key];
        const item = document.createElement('div');
        item.className = 'video-item';
        if (currentItem && currentItem.id === v.id) {
            item.classList.add('active');
        }

        let badges = '';
        if (v.isLocal) {
            if (v.front) badges += `<span class="badge front">FRONT</span>`;
            if (v.back) badges += `<span class="badge rear">REAR</span>`;
            if (v.gps) badges += `<span class="badge gps">GPS</span>`;
        } else {
            badges += `<span class="badge raw-data">RawData</span>`;
            badges += `<span class="badge front">変換済</span>`;
        }

        item.innerHTML = `
            <input type="checkbox" class="video-select-checkbox" data-id="${v.id}">
            <div class="video-item-content">
                <div class="video-item-title">${v.title}</div>
                <div class="video-item-badges">${badges}</div>
            </div>
        `;

        // Handle item content click to load video
        item.querySelector('.video-item-content').addEventListener('click', () => {
            document.querySelectorAll('.video-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            loadVideoData(v);
        });

        // Handle checkbox click without triggering item selection
        const checkbox = item.querySelector('.video-select-checkbox');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            updateMergeButtonState();
            
            // Dynamic Select All Sync
            const checkboxes = videoListEl.querySelectorAll('.video-select-checkbox');
            const checkedCount = videoListEl.querySelectorAll('.video-select-checkbox:checked').length;
            if (checkboxes.length > 0 && checkedCount === checkboxes.length) {
                selectAllBtn.innerText = "選択を解除";
                selectAllBtn.classList.add('active');
            } else {
                selectAllBtn.innerText = "すべて選択";
                selectAllBtn.classList.remove('active');
            }
        });

        videoListEl.appendChild(item);
    });
}

function updateMergeButtonState() {
    const checkedCheckboxes = videoListEl.querySelectorAll('.video-select-checkbox:checked');
    mergeExportBtn.disabled = checkedCheckboxes.length < 2;
}

// Load Video & GPS to player
async function loadVideoData(v) {
    currentItem = v;
    currentInfo.innerText = v.title;
    
    videoPlayer.src = '';
    gpsData = [];
    routePolyline.setLatLngs([]);

    // Persist active camera view if available, otherwise fallback to front camera
    if (currentCamera === 'back' && v.back) {
        currentCamera = 'back';
        cameraLabel.innerText = 'REAR CAMERA';
    } else {
        currentCamera = 'front';
        cameraLabel.innerText = 'FRONT CAMERA';
    }

    if (v.isLocal) {
        if (currentCamera === 'front') {
            if (!v.front) {
                alert("フロントカメラの映像ファイルが見つかりません。");
                return;
            }
            videoPlayer.src = URL.createObjectURL(v.front);
        } else {
            if (!v.back) {
                alert("バックカメラの映像ファイルが見つかりません。");
                return;
            }
            videoPlayer.src = URL.createObjectURL(v.back);
        }
        toggleCameraBtn.disabled = !v.back;
        exportBtn.disabled = false;
        
        if (v.gps) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    gpsData = JSON.parse(e.target.result);
                    drawRoute();
                } catch (err) {
                    console.error("GPS JSONのパースエラー");
                }
            };
            reader.readAsText(v.gps);
        } else {
            clearDashboard();
        }
    } else {
        if (currentCamera === 'front') {
            if (!v.front) {
                alert("映像のロードに失敗しました。");
                return;
            }
            videoPlayer.src = v.front;
        } else {
            if (!v.back) {
                alert("映像のロードに失敗しました。");
                return;
            }
            videoPlayer.src = v.back;
        }
        toggleCameraBtn.disabled = !v.back;
        exportBtn.disabled = false;

        if (v.gps) {
            try {
                const res = await fetch(v.gps);
                gpsData = await res.json();
                drawRoute();
            } catch (err) {
                console.error("GPS JSONの読み込み失敗");
            }
        } else {
            clearDashboard();
        }
    }

    videoPlayer.play().catch(e => console.log(e));
}

function clearDashboard() {
    dashboardSpeed.innerHTML = `0.0<span class="unit">km/h</span>`;
    dashboardLocation.innerText = `--.----, --.----`;
    dashboardTime.innerText = `--:--:--`;
    speedOverlay.innerText = `-- km/h`;
    timeOverlay.innerText = `--:--:--`;
}

function drawRoute() {
    if (gpsData.length === 0) return;
    const latlngs = gpsData.map(p => [p.lat, p.lon]);
    routePolyline.setLatLngs(latlngs);
    map.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });
    carMarker.setLatLng(latlngs[0]);
}

// Camera Toggle (Restores time perfectly in real-time)
toggleCameraBtn.addEventListener('click', () => {
    if (!currentItem) return;
    
    const wasPlaying = !videoPlayer.paused;
    const targetTime = videoPlayer.currentTime;
    
    const onMetadataLoaded = () => {
        videoPlayer.currentTime = targetTime;
        if (wasPlaying) {
            videoPlayer.play().catch(e => console.log(e));
        }
        videoPlayer.removeEventListener('loadedmetadata', onMetadataLoaded);
    };
    
    videoPlayer.addEventListener('loadedmetadata', onMetadataLoaded);
    
    if (currentItem.isLocal) {
        if (currentCamera === 'front') {
            if (!currentItem.back) return;
            currentCamera = 'back';
            videoPlayer.src = URL.createObjectURL(currentItem.back);
            cameraLabel.innerText = 'REAR CAMERA';
        } else {
            currentCamera = 'front';
            videoPlayer.src = URL.createObjectURL(currentItem.front);
            cameraLabel.innerText = 'FRONT CAMERA';
        }
    } else {
        if (currentCamera === 'front') {
            if (!currentItem.back) return;
            currentCamera = 'back';
            videoPlayer.src = currentItem.back;
            cameraLabel.innerText = 'REAR CAMERA';
        } else {
            currentCamera = 'front';
            videoPlayer.src = currentItem.front;
            cameraLabel.innerText = 'FRONT CAMERA';
        }
    }
});

// Helper to trigger download
function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Final Cut Pro Export (Downloads BOTH Front & Rear MP4 together)
exportBtn.addEventListener('click', () => {
    if (!currentItem) return;
    
    if (currentItem.isLocal) {
        // Download Front
        if (currentItem.front) {
            triggerDownload(URL.createObjectURL(currentItem.front), currentItem.front.name);
        }
        // Download Rear
        setTimeout(() => {
            if (currentItem.back) {
                triggerDownload(URL.createObjectURL(currentItem.back), currentItem.back.name);
            }
        }, 300); // Tiny delay to prevent browser download grouping bugs
    } else {
        // Download Front
        if (currentItem.front) {
            const filenameFront = currentItem.front.split('/').pop();
            triggerDownload(currentItem.front, filenameFront);
        }
        // Download Rear
        setTimeout(() => {
            if (currentItem.back) {
                const filenameBack = currentItem.back.split('/').pop();
                triggerDownload(currentItem.back, filenameBack);
            }
        }, 300); // Tiny delay to prevent browser download grouping bugs
    }
});

// Native Video Seeking Events
videoPlayer.addEventListener('seeking', () => {
    isSeeking = true;
});

videoPlayer.addEventListener('seeked', () => {
    isSeeking = false;
});

// Sync Video to GPS & Native Controls
videoPlayer.addEventListener('loadedmetadata', () => {
    videoDuration = videoPlayer.duration;
    videoPlayer.playbackRate = currentSpeed;
});

videoPlayer.addEventListener('timeupdate', () => {
    if (gpsData.length === 0 || videoDuration === 0) return;

    const currentTime = videoPlayer.currentTime;
    const progress = currentTime / videoDuration;
    let index = Math.floor(progress * gpsData.length);
    
    if (index >= gpsData.length) index = gpsData.length - 1;
    if (index < 0) index = 0;

    const point = gpsData[index];
    
    // Smooth vs Instant Map movement based on seeking state
    if (isSeeking) {
        carMarker.setLatLng([point.lat, point.lon]);
        map.panTo([point.lat, point.lon], {animate: false});
    } else {
        carMarker.setLatLng([point.lat, point.lon]);
        map.panTo([point.lat, point.lon], {animate: true, duration: 0.5});
    }

    const speed = point.speed_kmh.toFixed(1);
    const jstTime = convertUTCToJST(point.time_str);
    
    speedOverlay.innerText = `${speed} km/h`;
    timeOverlay.innerText = jstTime;
    
    dashboardSpeed.innerHTML = `${speed}<span class="unit">km/h</span>`;
    dashboardLocation.innerText = `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
    dashboardTime.innerText = jstTime;
});

// Automatically play the next video in the list when the current one ends
videoPlayer.addEventListener('ended', () => {
    if (!currentItem) return;
    const keys = Object.keys(loadedItems).sort();
    const currentIndex = keys.indexOf(currentItem.id);
    if (currentIndex !== -1 && currentIndex + 1 < keys.length) {
        const nextKey = keys[currentIndex + 1];
        const nextItem = loadedItems[nextKey];
        
        // Find and highlight the next item in the sidebar list UI
        const items = videoListEl.querySelectorAll('.video-item');
        if (items.length > currentIndex + 1) {
            items.forEach(el => el.classList.remove('active'));
            items[currentIndex + 1].classList.add('active');
        }
        
        loadVideoData(nextItem);
    }
});

// Merge and export selected files
mergeExportBtn.addEventListener('click', async () => {
    const checkedCheckboxes = videoListEl.querySelectorAll('.video-select-checkbox:checked');
    const selectedIds = Array.from(checkedCheckboxes).map(cb => cb.getAttribute('data-id'));
    
    if (selectedIds.length < 2) return;
    
    loadingOverlay.style.display = 'flex';
    loadingMessage.innerText = "選択した複数の映像を結合中...";
    loadingProgress.innerText = `合計 ${selectedIds.length} 個のファイルをロスレス結合しています\n(この処理には通常1〜3秒かかります)`;
    
    try {
        const response = await fetch('/api/merge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: selectedIds })
        });
        
        if (!response.ok) throw new Error("Merge failed");
        
        const data = await response.json();
        if (data.success) {
            // Download Merged Front
            if (data.front) {
                triggerDownload(data.front, data.filename_front);
            }
            // Download Merged Back with a slight delay to prevent browser bugs
            setTimeout(() => {
                if (data.back) {
                    triggerDownload(data.back, data.filename_back);
                }
            }, 300);
        } else {
            alert("動画の結合処理に失敗しました。");
        }
    } catch (err) {
        console.error("Error during video merging:", err);
        alert("サーバーとの通信エラーが発生しました。");
    } finally {
        loadingOverlay.style.display = 'none';
    }
});

// Select All / Deselect All logic
selectAllBtn.addEventListener('click', () => {
    const checkboxes = videoListEl.querySelectorAll('.video-select-checkbox');
    if (checkboxes.length === 0) return;

    // Check if all are currently checked
    const checkedCount = videoListEl.querySelectorAll('.video-select-checkbox:checked').length;
    const allChecked = checkedCount === checkboxes.length;

    checkboxes.forEach(cb => {
        cb.checked = !allChecked;
    });

    // Update Select All button visual state
    if (!allChecked) {
        selectAllBtn.innerText = "選択を解除";
        selectAllBtn.classList.add('active');
    } else {
        selectAllBtn.innerText = "すべて選択";
        selectAllBtn.classList.remove('active');
    }

    updateMergeButtonState();
});

// Skip Back 5 Seconds
skipBackBtn.addEventListener('click', () => {
    if (!currentItem) return;
    videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5);
});

// Playback Speed Controls
document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const speed = parseFloat(btn.getAttribute('data-speed'));
        currentSpeed = speed;
        videoPlayer.playbackRate = speed;
        
        // Update active class state
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Map Style Switching Logic
function switchMapStyle(style) {
    if (!map || !mapTiles[style]) return;
    
    // Remove current layer
    if (currentTileLayer) {
        map.removeLayer(currentTileLayer);
    }
    
    // Add new layer
    currentTileLayer = L.tileLayer(mapTiles[style].url, mapTiles[style].options).addTo(map);
    
    // Update active button classes
    document.querySelectorAll('.map-style-btn').forEach(btn => {
        if (btn.getAttribute('data-style') === style) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Map Style Switch Controls
document.querySelectorAll('.map-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const style = btn.getAttribute('data-style');
        switchMapStyle(style);
    });
});

// Map Zoom Controls
const mapZoomIn = document.getElementById('mapZoomIn');
const mapZoomOut = document.getElementById('mapZoomOut');
const mapZoomReset = document.getElementById('mapZoomReset');

mapZoomIn.addEventListener('click', () => {
    map.zoomIn();
});

mapZoomOut.addEventListener('click', () => {
    map.zoomOut();
});

mapZoomReset.addEventListener('click', () => {
    if (gpsData.length > 0) {
        const latlngs = gpsData.map(p => [p.lat, p.lon]);
        routePolyline.setLatLngs(latlngs);
        map.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });
    } else {
        // Fallback to default Osaka view if no GPS data
        map.setView([34.6937, 135.5023], 13);
    }
});

// Init on load
document.addEventListener('DOMContentLoaded', () => {
    initMap();
});
