// 🌸 CONFIGURASI
const CONFIG = {
    MAP_CENTER: [-0.5, 101.5],
    MAP_ZOOM: 10,
    DATA: [], // Akan diisi dari CSV
    COLORS: {
        rsud: '#FF2D95',
        puskesmas: '#9B7EBD',
        uptd: '#E5A937'
    },
    ICONS: {
        rsud: { color: '#FF2D95', icon: 'fa-hospital' },
        puskesmas: { color: '#9B7EBD', icon: 'fa-clinic-medical' },
        uptd: { color: '#E5A937', icon: 'fa-clinic-medical' }
    }
};

// 🌸 VARIABEL GLOBAL
let map;
let markers = [];
let selectedFacility = null;
let kecamatanLayer = null;
let facilitiesVisible = false; // default disembunyikan sesuai permintaan
const KECAMATAN_LAYERS_MAP = {}; // Store layer reference untuk setiap kecamatan
let selectedKecamatanLayer = null; // Track selected kecamatan layer
let selectedLegendItem = null; // Track selected legend item
let kabupatenLayer = null; // Layer untuk batas kabupaten
const KABUPATEN_LAYERS_MAP = {}; // Store layer reference untuk setiap kabupaten
let selectedKabupatenLayer = null;
let kabupatenVisible = true; // Track kabupaten layer visibility

// Palet warna kecamatan (looping bila lebih banyak nama)
const KECAMATAN_COLOR_MAP = {};
const KECAMATAN_COLOR_PALETTE = [
    '#ff6b6b', // merah pastel
    '#4dabf7', // biru muda
    '#63e6be', // hijau mint
    '#ffd43b', // kuning hangat
    '#b197fc', // ungu pastel
    '#ffa94d', // oranye lembut
    '#74c0fc', // biru lembut
    '#e599f7', // magenta pastel
    '#82c91e', // hijau terang
    '#fab005', // emas lembut
    '#ff8787', // salmon
    '#66d9e8', // toska
    '#d0bfff', // lavender
    '#f783ac', // pink
    '#94d82d'  // hijau limau
];

// 🌸 INISIALISASI
document.addEventListener('DOMContentLoaded', function() {
    console.log('🌸 Memuat WebGIS Kesehatan Kuansing...');
    
    // Inisialisasi peta
    initMap();
    
    // Load data dari CSV
    loadData();
    
    // Setup event listeners
    setupEventListeners();
    
    // Update statistics
    updateStatistics();
});

// 🌸 FUNGSI INISIALISASI PETA
function initMap() {
    // Buat peta dengan tema pink
    map = L.map('map', {
        center: CONFIG.MAP_CENTER,
        zoom: CONFIG.MAP_ZOOM,
        zoomControl: false,
        attributionControl: true
    });
    
    // Tunggu DOM fully rendered sebelum invalidate size
    setTimeout(() => {
        map.invalidateSize();
    }, 300);
    
    // Hilangkan prefix bawaan "Leaflet" (termasuk ikon bendera)
    if (map.attributionControl && map.attributionControl.setPrefix) {
        map.attributionControl.setPrefix('');
    }
    
    // Tambahkan basemap dengan tema pink
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: OpenStreetMap'
    }).addTo(map);

    // Tambahkan batas kecamatan (butuh file geojson)
    loadKecamatanBoundaries();
    loadKabupatenBoundaries();
    
    // Update info peta
    updateMapInfo();
    map.on('moveend', updateMapInfo);
    map.on('zoomend', updateMapInfo);
}

// 🌸 UTIL: Parser CSV mendukung tanda kutip
function parseCSV(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';
        if (ch === '"') {
            if (inQuotes && next === '"') {
                // Escaped quote
                field += '"';
                i++; // skip next
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            row.push(field);
            field = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            // End of row
            if (field.length > 0 || row.length > 0) {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            }
        } else {
            field += ch;
        }
    }
    // Push last field/row if any
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    // Trim whitespace around fields
    return rows.map(r => r.map(f => f != null ? f.trim() : ''));
}

// 🌸 LOAD DATA DARI CSV (mendeteksi skema baru/laman)
async function loadData() {
    try {
        const response = await fetch('data.csv');
        const csvText = await response.text();

        const rows = parseCSV(csvText).filter(r => r.length && r.some(v => (v || '').trim().length));
        if (rows.length === 0) throw new Error('CSV kosong');
        const headers = rows[0].map(h => h.trim());

        // Helper untuk ambil nilai per nama kolom
        const idxMap = Object.fromEntries(headers.map((h, i) => [h, i]));
        const getVal = (row, key) => {
            const i = idxMap[key];
            return i != null ? row[i] : '';
        };

        // Pemetaan baris ke skema aplikasi
        const facilities = rows.slice(1).map(row => {
            const name = getVal(row, 'name') || getVal(row, 'name_for_emails') || getVal(row, 'title') || getVal(row, 'query') || '';
            const phone = getVal(row, 'phone');
            const latStr = getVal(row, 'latitude');
            const lngStr = getVal(row, 'longitude');
            const lat = latStr ? parseFloat(latStr) : NaN;
            const lng = lngStr ? parseFloat(lngStr) : NaN;

            // Address prefer 'address', else gabungkan komponen
            let address = getVal(row, 'address');
            if (!address) {
                const parts = [getVal(row, 'street'), getVal(row, 'city'), getVal(row, 'county'), getVal(row, 'state'), getVal(row, 'postal_code')]
                    .filter(Boolean);
                address = parts.join(', ');
            }

            // Derivasi tipe lokal ('RSUD' atau 'Puskesmas')
            // Check category first, then type column
            const category = getVal(row, 'category') || '';
            const typeRaw = [getVal(row, 'type'), category, name]
                .join(' ').toLowerCase();
            // Only mark as RSUD if category is explicitly "Rumah Sakit" or name contains RSUD
            const isRSUD = category.toLowerCase().includes('rumah sakit') || /^rsud/i.test(getVal(row, 'name') || '');
            const type = isRSUD ? 'RSUD' : 'Puskesmas';

            // Tambahan atribut yang mungkin dipakai ke depan
            const ratingStr = getVal(row, 'rating');
            const reviewsStr = getVal(row, 'reviews');
            const rating = ratingStr ? parseFloat(ratingStr) : undefined;
            const reviews = reviewsStr ? parseInt(reviewsStr, 10) : undefined;
            const status = getVal(row, 'business_status') || getVal(row, 'status');
            const workingHours = getVal(row, 'working_hours_csv_compatible') || getVal(row, 'working_hours');

            return {
                name,
                type,
                address,
                latitude: lat,
                longitude: lng,
                phone,
                rating,
                reviews,
                working_hours: workingHours,
                status
            };
        }).filter(f => f.name && typeof f.latitude === 'number' && !isNaN(f.latitude) && typeof f.longitude === 'number' && !isNaN(f.longitude));

        // Override koordinat tertentu (kosong saat ini)
        const overrides = {};

        CONFIG.DATA = facilities.map(f => {
            const key = (f.name || '').trim().toLowerCase();
            if (overrides[key]) {
                return { ...f, latitude: overrides[key].lat, longitude: overrides[key].lng };
            }
            return f;
        });
        console.log('🌸 Data berhasil dimuat dari CSV (skema dinamis):', CONFIG.DATA.length, 'fasilitas');

        // Render data ke peta
        renderMarkers();

        // Update UI
        updateStatistics();
        showNotification('Data fasilitas kesehatan berhasil dimuat!', 'success');
        return;
    } catch (error) {
        console.error('Error loading CSV:', error);
        CONFIG.DATA = [];
        console.log('🌸 CSV gagal dimuat. Tidak ada data fallback.');
        showNotification('CSV gagal dimuat - tidak ada data', 'error');
    }
}

// 🌸 CREATE CUSTOM ICON WITH FONTAWESOME
function createCustomIcon(facilityType) {
    let iconType = 'puskesmas'; // default
    
    // Use facility type to determine icon
    if (facilityType && typeof facilityType === 'string') {
        if (facilityType === 'RSUD') {
            iconType = 'rsud';
        } else if (facilityType === 'Puskesmas') {
            iconType = 'puskesmas';
        } else {
            iconType = 'puskesmas';
        }
    }
    
    const config = CONFIG.ICONS[iconType];
    const html = `
        <div class="custom-marker" style="background-color: ${config.color}; width: 45px; height: 45px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.25);">
            <i class="fas ${config.icon}" style="color: white; font-size: 22px;"></i>
        </div>
    `;
    
    return L.divIcon({
        html: html,
        iconSize: [45, 45],
        iconAnchor: [22.5, 45],
        popupAnchor: [0, -45],
        className: 'custom-marker-wrapper'
    });
}

// 🌸 RENDER MARKER KE PETA
function renderMarkers() {
    // Clear existing markers
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    
    // Tambahkan marker untuk setiap fasilitas
    if (!facilitiesVisible) {
        console.log('🌸 Marker disembunyikan sesuai toggle fasilitas');
        return;
    }

    CONFIG.DATA.forEach((facility, index) => {
        const icon = createCustomIcon(facility.type);
        
        const marker = L.marker([facility.latitude, facility.longitude], {
            icon: icon,
            title: facility.name,
            facilityId: index
        });
        
        // Buat popup content yang cantik
        const getPopupIcon = () => {
            if (facility.type === 'RSUD') return 'fa-hospital';
            if (/uptd/i.test(facility.name)) return 'fa-clinic-medical';
            return 'fa-clinic-medical';
        };
        
        const popupContent = `
            <div class="facility-popup">
                <div class="popup-header ${facility.type === 'RSUD' ? 'hospital' : 'clinic'}">
                    <i class="fas ${getPopupIcon()}"></i>
                    <h4>${facility.name}</h4>
                </div>
                <div class="popup-body">
                    <p><strong><i class="fas fa-tag"></i> Tipe:</strong> ${facility.type}</p>
                    <p><strong><i class="fas fa-map-marker-alt"></i> Alamat:</strong> ${facility.address}</p>
                    ${facility.phone ? `<p><strong><i class="fas fa-phone"></i> Telepon:</strong> ${facility.phone}</p>` : ''}
                </div>
                <div class="popup-actions">
                    <button onclick="showFacilityDetail(${index})" class="popup-btn detail-btn">
                        <i class="fas fa-info-circle"></i> Detail
                    </button>
                </div>
            </div>
        `;
        
        marker.bindPopup(popupContent);
        
        // Tambahkan event click
        marker.on('click', function() {
            selectedFacility = facility;
            showFacilityDetail(index);
        });
        
        marker.addTo(map);
        markers.push(marker);
    });
    
    console.log('🌸 Marker berhasil dirender:', markers.length, 'marker');
}

// Dapatkan warna unik per kecamatan
function getKecamatanColor(name) {
    if (!name) return '#95a5a6';
    if (!KECAMATAN_COLOR_MAP[name]) {
        const idx = Object.keys(KECAMATAN_COLOR_MAP).length % KECAMATAN_COLOR_PALETTE.length;
        KECAMATAN_COLOR_MAP[name] = KECAMATAN_COLOR_PALETTE[idx];
    }
    return KECAMATAN_COLOR_MAP[name];
}

// Hitung estimasi jumlah fasilitas di dalam polygon via bounding box
function estimateFacilitiesInLayer(layer) {
    if (!layer || !layer.getBounds) return 0;
    const bounds = layer.getBounds();
    return CONFIG.DATA.filter(f => bounds.contains([f.latitude, f.longitude])).length;
}

// Render legenda dinamis kecamatan
function buildKecamatanLegend(names) {
    const container = document.getElementById('kecamatan-legend');
    if (!container) return;
    container.innerHTML = '';
    selectedLegendItem = null;
    names.forEach(name => {
        const color = getKecamatanColor(name);
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.kecamatanName = name;
        item.innerHTML = `
            <div class="legend-color" style="background:${color};"></div>
            <span>${name}</span>
        `;
        
        // Add click handler untuk select polygon kecamatan
        item.addEventListener('click', () => {
            if (selectedLegendItem && selectedLegendItem !== item) {
                selectedLegendItem.classList.remove('legend-selected');
            }
            selectedLegendItem = item;
            item.classList.add('legend-selected');

            const layer = KECAMATAN_LAYERS_MAP[name];
            if (layer) {
                // Reset semua layer ke style normal
                Object.values(KECAMATAN_LAYERS_MAP).forEach(l => {
                    l.setStyle({ weight: 2, fillOpacity: 0.3 });
                });
                
                // Highlight layer yang dipilih
                layer.setStyle({ 
                    weight: 4, 
                    fillOpacity: 0.5,
                    color: color
                });
                
                // Track selected layer
                selectedKecamatanLayer = layer;
                
                // Zoom ke layer
                if (layer.getBounds) {
                    map.fitBounds(layer.getBounds(), { padding: [50, 50] });
                }
                
                showNotification(`Pilih ${name}`, 'success');
            }
        });
        
        container.appendChild(item);
    });
}

// Muat batas kecamatan dari GeoJSON eksternal
async function loadKecamatanBoundaries() {
    try {
        const response = await fetch('kecamatan.geojson');
        if (!response.ok) throw new Error('File kecamatan.geojson tidak ditemukan');
        const data = await response.json();

        const names = new Set();
        const onEachFeature = (feature, layer) => {
            const name = feature?.properties?.kecamatan || feature?.properties?.name || feature?.properties?.NAMOBJ || 'Kecamatan';
            names.add(name);
            
            // Store layer reference untuk click handler di legend
            KECAMATAN_LAYERS_MAP[name] = layer;
            
            const color = getKecamatanColor(name);
            layer.setStyle({
                color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.3,
                dashArray: '4 2'
            });

            layer.bindTooltip(name, {
                permanent: true,
                direction: 'center',
                className: 'kecamatan-label',
                opacity: 0.9
            });

            layer.on('mouseover', () => {
                // Jangan ubah jika layer ini adalah selected layer
                if (layer !== selectedKecamatanLayer) {
                    layer.setStyle({ weight: 3, fillOpacity: 0.4 });
                }
            });
            layer.on('mouseout', () => {
                // Jangan ubah jika layer ini adalah selected layer
                if (layer !== selectedKecamatanLayer) {
                    layer.setStyle({ weight: 2, fillOpacity: 0.3 });
                }
            });
            layer.on('click', () => {
                layer.bindPopup(`
                    <div class="border-popup">
                        <h4><i class="fas fa-draw-polygon"></i> ${name}</h4>
                    </div>
                `).openPopup();
                map.fitBounds(layer.getBounds(), { padding: [30, 30] });
            });
        };

        kecamatanLayer = L.geoJSON(data, {
            onEachFeature
        }).addTo(map);

        // Urutkan ke belakang agar marker tetap di atas
        kecamatanLayer.eachLayer(layer => layer.bringToBack());

        buildKecamatanLegend(Array.from(names));
        showNotification('Batas kecamatan dimuat', 'success');
    } catch (err) {
        console.warn('Gagal memuat kecamatan:', err.message);
        showNotification('File batas kecamatan belum tersedia (kecamatan.geojson)', 'warning');
    }
}

// Muat batas kabupaten dari GeoJSON eksternal
async function loadKabupatenBoundaries() {
    try {
        const response = await fetch('kabupaten.geojson');
        if (!response.ok) throw new Error('File kabupaten.geojson tidak ditemukan');
        const data = await response.json();

        const names = new Set();
        const onEachFeature = (feature, layer) => {
            const name = feature?.properties?.kabupaten || feature?.properties?.name || feature?.properties?.NAMOBJ || 'Kabupaten';
            names.add(name);
            KABUPATEN_LAYERS_MAP[name] = layer;

            layer.setStyle({
                color: CONFIG.COLORS.rsud,
                weight: 2,
                fillColor: CONFIG.COLORS.rsud,
                fillOpacity: 0.08,
                dashArray: '5 4'
            });

            layer.on('mouseover', () => {
                if (layer !== selectedKabupatenLayer) {
                    layer.setStyle({ weight: 3, fillOpacity: 0.12 });
                }
            });
            layer.on('mouseout', () => {
                if (layer !== selectedKabupatenLayer) {
                    layer.setStyle({ weight: 2, fillOpacity: 0.08 });
                }
            });
            layer.on('click', () => {
                Object.values(KABUPATEN_LAYERS_MAP).forEach(l => l.setStyle({ weight: 2, fillOpacity: 0.08 }));
                layer.setStyle({ weight: 4, fillOpacity: 0.12 });
                selectedKabupatenLayer = layer;
                layer.bindPopup(`
                    <div class="border-popup">
                        <h4><i class="fas fa-map"></i> ${name}</h4>
                    </div>
                `).openPopup();
                map.fitBounds(layer.getBounds(), { padding: [40, 40] });
            });
        };

        kabupatenLayer = L.geoJSON(data, { onEachFeature }).addTo(map);
        kabupatenLayer.eachLayer(layer => layer.bringToBack());
        kabupatenVisible = true;
        showNotification('Batas kabupaten dimuat', 'success');
    } catch (err) {
        console.warn('Gagal memuat kabupaten:', err.message);
        showNotification('File batas kabupaten belum tersedia (kabupaten.geojson)', 'warning');
        kabupatenVisible = false;
    }
}

// 🌸 TAMPILKAN DETAIL FASILITAS
function showFacilityDetail(index) {
    const facility = CONFIG.DATA[index];
    const detailContent = document.getElementById('detail-content');
    
    const detailHTML = `
        <div class="facility-detail">
            <div class="facility-header ${facility.type === 'RSUD' ? 'hospital' : 'clinic'}">
                <div class="facility-icon">
                    <i class="fas ${facility.type === 'RSUD' ? 'fa-hospital' : 'fa-clinic-medical'}"></i>
                </div>
                <div class="facility-title">
                    <h4>${facility.name}</h4>
                    <span class="facility-type">${facility.type}</span>
                </div>
            </div>
            
            <div class="facility-info">
                <div class="info-section">
                    <h5><i class="fas fa-map-marker-alt"></i> Lokasi</h5>
                    <p class="address">${facility.address}</p>
                    <div class="coordinates">
                        <span><i class="fas fa-globe-asia"></i> ${facility.latitude.toFixed(6)}, ${facility.longitude.toFixed(6)}</span>
                    </div>
                </div>
                
                ${facility.phone ? `
                <div class="info-section">
                    <h5><i class="fas fa-phone"></i> Kontak</h5>
                    <p class="phone">${facility.phone}</p>
                </div>` : ''}
                
                <div class="info-section">
                    <h5><i class="fas fa-info-circle"></i> Informasi Tambahan</h5>
                    <div class="additional-info">
                        <div class="info-item">
                            <i class="fas fa-calendar-check"></i>
                            <span>Status: <strong>Operasional</strong></span>
                        </div>
                        <div class="info-item">
                            <i class="fas fa-clock"></i>
                            <span>Jam: <strong>24 Jam</strong></span>
                        </div>
                        <div class="info-item">
                            <i class="fas fa-map-pin"></i>
                            <span>Koordinat GPS tersedia</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    detailContent.innerHTML = detailHTML;
    
    // Enable action buttons
    document.getElementById('zoom-to-btn').disabled = false;
    document.getElementById('direction-btn').disabled = false;
    
    // Set event handlers
    document.getElementById('zoom-to-btn').onclick = () => zoomToFacility(index);
    document.getElementById('direction-btn').onclick = () => getDirections(facility.latitude, facility.longitude, facility.name);
    
    // Highlight marker
    markers[index].openPopup();
}

// 🌸 UPDATE STATISTIK
function updateStatistics() {
    const rsudCount = CONFIG.DATA.filter(f => f.type === 'RSUD').length;
    const puskesmasCount = CONFIG.DATA.filter(f => f.type === 'Puskesmas').length;
    const totalCount = CONFIG.DATA.length;
    
    // Update DOM elements
    document.getElementById('total-facilities').textContent = totalCount;
    document.getElementById('count-hospital').textContent = rsudCount;
    document.getElementById('count-clinic').textContent = puskesmasCount;
    document.getElementById('stat-hospital').textContent = rsudCount;
    document.getElementById('stat-clinic').textContent = puskesmasCount;
    document.getElementById('stat-total').textContent = totalCount;
}

// 🌸 UPDATE INFO PETA
function updateMapInfo() {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const scale = Math.round(591657550 / Math.pow(2, zoom));
    
    document.getElementById('coordinates').textContent = 
        `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
    const scaleEl = document.getElementById('scale');
    if (scaleEl) {
        scaleEl.textContent = `1:${scale.toLocaleString()}`;
    }
}

// 🌸 SETUP EVENT LISTENERS
function setupEventListeners() {
    console.log('🔧 Menyiapkan event listeners...');
    
    // Theme button
    document.getElementById('theme-btn').addEventListener('click', toggleTheme);
    
    // Map controls
    const zoomInBtn = document.getElementById('zoom-in');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            console.log('🔍 Zoom in clicked');
            map.zoomIn();
        });
    } else {
        console.warn('⚠️ zoom-in button tidak ditemukan!');
    }
    
    const zoomOutBtn = document.getElementById('zoom-out');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            console.log('🔍 Zoom out clicked');
            map.zoomOut();
        });
    } else {
        console.warn('⚠️ zoom-out button tidak ditemukan!');
    }
    
    const resetBtn = document.getElementById('reset-view');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            console.log('🏠 Reset view clicked');
            map.setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
            showNotification('Peta di-reset ke posisi awal', 'success');
        });
    } else {
        console.warn('⚠️ reset-view button tidak ditemukan!');
    }
    
    // Facilities toggle
    const facilitiesBtn = document.getElementById('facilities-toggle');
    if (facilitiesBtn) {
        facilitiesBtn.addEventListener('click', () => {
            console.log('📍 Facilities toggle clicked');
            toggleFacilities();
        });
    } else {
        console.warn('⚠️ facilities-toggle button tidak ditemukan!');
    }
    
    // Kecamatan toggle
    const kecamatanBtn = document.getElementById('kecamatan-toggle');
    if (kecamatanBtn) {
        kecamatanBtn.addEventListener('click', () => {
            console.log('🗺️ Kecamatan toggle clicked');
            toggleKecamatan();
        });
    } else {
        console.warn('⚠️ kecamatan-toggle button tidak ditemukan!');
    }

    // Kabupaten toggle
    const kabupatenBtn = document.getElementById('kabupaten-toggle');
    if (kabupatenBtn) {
        kabupatenBtn.addEventListener('click', () => {
            console.log('🗺️ Kabupaten toggle clicked');
            toggleKabupaten();
        });
    } else {
        console.warn('⚠️ kabupaten-toggle button tidak ditemukan!');
    }
    
    // Basemap button
    const basemapBtn = document.getElementById('basemap-btn');
    if (basemapBtn) {
        basemapBtn.addEventListener('click', () => {
            console.log('🗺️ Basemap button clicked');
            document.getElementById('basemap-modal').classList.add('show');
        });
    } else {
        console.warn('⚠️ basemap-btn button tidak ditemukan!');
    }
    
    // Search
    document.getElementById('search-input').addEventListener('input', debounce(searchFacilities, 300));
    document.getElementById('search-btn').addEventListener('click', searchFacilities);
    
    // Filter checkboxes
    document.getElementById('filter-hospital').addEventListener('change', filterMarkers);
    document.getElementById('filter-clinic').addEventListener('change', filterMarkers);
    
    // Modal controls
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function() {
            document.getElementById('basemap-modal').classList.remove('show');
        });
    });
    
    document.querySelector('.cancel-btn').addEventListener('click', function() {
        document.getElementById('basemap-modal').classList.remove('show');
    });
    
    document.querySelector('.confirm-btn').addEventListener('click', function() {
        const selected = document.querySelector('.basemap-option.active');
        const basemap = selected.dataset.basemap;
        changeBasemap(basemap);
        document.getElementById('basemap-modal').classList.remove('show');
        showNotification(`Peta dasar diubah ke ${getBasemapName(basemap)}`, 'success');
    });
    
    // Basemap selection
    document.querySelectorAll('.basemap-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelectorAll('.basemap-option').forEach(opt => opt.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // Close modal on outside click
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('basemap-modal');
        if (event.target === modal) {
            modal.classList.remove('show');
        }
    });
    
}


// 🌸 FUNGSI UTILITAS
function toggleTheme() {
    document.body.classList.toggle('light-pink');
    const icon = document.querySelector('#theme-btn i');
    if (document.body.classList.contains('light-pink')) {
        icon.className = 'fas fa-moon';
        showNotification('Tema light pink diaktifkan', 'success');
    } else {
        icon.className = 'fas fa-sun';
        showNotification('Tema soft pink diaktifkan', 'success');
    }
}

function toggleFacilities() {
    facilitiesVisible = !facilitiesVisible;
    if (!facilitiesVisible) {
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];
        showNotification('Titik fasilitas disembunyikan', 'info');
    } else {
        renderMarkers();
        showNotification('Titik fasilitas ditampilkan', 'success');
    }
}

function toggleKecamatan() {
    if (!kecamatanLayer) {
        showNotification('Memuat batas kecamatan...', 'info');
        loadKecamatanBoundaries();
        return;
    }
    if (map.hasLayer(kecamatanLayer)) {
        map.removeLayer(kecamatanLayer);
        showNotification('Batas kecamatan disembunyikan', 'info');
    } else {
        kecamatanLayer.addTo(map);
        kecamatanLayer.eachLayer(layer => layer.bringToBack());
        showNotification('Batas kecamatan ditampilkan', 'success');
    }
}

function toggleKabupaten() {
    if (!kabupatenLayer) {
        showNotification('Memuat batas kabupaten...', 'info');
        loadKabupatenBoundaries();
        return;
    }
    if (kabupatenVisible) {
        map.removeLayer(kabupatenLayer);
        kabupatenVisible = false;
        showNotification('Batas kabupaten disembunyikan', 'info');
    } else {
        kabupatenLayer.addTo(map);
        kabupatenLayer.eachLayer(layer => layer.bringToBack());
        kabupatenVisible = true;
        showNotification('Batas kabupaten ditampilkan', 'success');
    }
}

function changeBasemap(type) {
    // Remove existing basemap
    map.eachLayer(layer => {
        if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
        }
    });
    
    let basemap;
    
    switch(type) {
        case 'none':
            map.getContainer().style.background = '#fff7fb';
            basemap = null;
            break;

        case 'osmfr':
            basemap = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
                maxZoom: 20,
                attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: OpenStreetMap France'
            });
            break;

        case 'osmde':
            basemap = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: OpenStreetMap Germany'
            });
            break;

        case 'cyclosm':
            basemap = L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
                maxZoom: 20,
                attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: CyclOSM & OpenStreetMap'
            });
            break;

        case 'cartodb':
            basemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                maxZoom: 20,
                subdomains: 'abcd',
                attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: CartoDB Voyager & OpenStreetMap'
            });
            break;

        case 'watercolor':
            basemap = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.{ext}', {
                minZoom: 1,
                maxZoom: 16,
                ext: 'jpg',
                attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: Stamen Watercolor'
            });
            break;

        case 'terrain':
            basemap = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.{ext}', {
                minZoom: 0,
                maxZoom: 18,
                ext: 'png',
                attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: Stamen Terrain'
            });
            break;

        default: // OSM global
            basemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: 'Leaflet | Ermadina Mutiara 24611012 | Sumber: OpenStreetMap'
            });
    }
    
    if (basemap) {
        map.getContainer().style.background = '#fff';
        basemap.addTo(map);
    }
}

function getBasemapName(type) {
    const names = {
        'osm': 'OpenStreetMap',
        'osmfr': 'OSM France',
        'osmde': 'OSM Germany',
        'cyclosm': 'CyclOSM',
        'cartodb': 'CartoDB Voyager',
        'watercolor': 'Stamen Watercolor',
        'terrain': 'Stamen Terrain',
        'none': 'Tanpa Basemap'
    };
    return names[type] || type;
}

function searchFacilities() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();
    
    if (!query) {
        resetMarkers();
        return;
    }
    
    const results = CONFIG.DATA.filter(facility => 
        facility.name.toLowerCase().includes(query) ||
        facility.address.toLowerCase().includes(query) ||
        facility.type.toLowerCase().includes(query)
    );
    
    if (results.length > 0) {
        // Highlight results
        markers.forEach(marker => {
            const facility = CONFIG.DATA[marker.options.facilityId];
            if (results.includes(facility)) {
                marker.setZIndexOffset(1000);
                marker.openPopup();
            } else {
                marker.setZIndexOffset(0);
            }
        });
        
        showNotification(`Ditemukan ${results.length} hasil untuk "${query}"`, 'success');
    } else {
        showNotification(`Tidak ditemukan fasilitas untuk "${query}"`, 'info');
    }
}

function resetMarkers() {
    markers.forEach(marker => {
        marker.setZIndexOffset(0);
    });
}

function filterMarkers() {
    const showHospital = document.getElementById('filter-hospital').checked;
    const showClinic = document.getElementById('filter-clinic').checked;
    
    markers.forEach(marker => {
        const facility = CONFIG.DATA[marker.options.facilityId];
        
        if ((facility.type === 'RSUD' && !showHospital) ||
            (facility.type === 'Puskesmas' && !showClinic)) {
            marker.setOpacity(0.3);
        } else {
            marker.setOpacity(1);
        }
    });
}

function zoomToFacility(index) {
    const facility = CONFIG.DATA[index];
    map.setView([facility.latitude, facility.longitude], 15);
    markers[index].openPopup();
    showNotification(`Zoom ke ${facility.name}`, 'success');
}

function getDirections(lat, lng, name) {
    const dest = `${lat},${lng}`;
    // Paksa tujuan ke pin koordinat untuk menghindari salah pilih POI
    const url = `https://www.google.com/maps/dir/Current+Location/${encodeURIComponent(dest)}`;
    window.open(url, '_blank');
    showNotification(`Petunjuk arah ke ${name || 'tujuan'}`, 'success');
}

// ===== EDIT/ADJUST FACILITY LOCATION =====
function setFacilityLocation(index) {
    const facility = CONFIG.DATA[index];
    if (!facility) return;
    showNotification(`Mode atur titik untuk: ${facility.name}. Klik pada peta.`, 'success');
    
    const onClick = (e) => {
        // Update coordinates
        facility.latitude = e.latlng.lat;
        facility.longitude = e.latlng.lng;
        
        // Re-render markers to reflect the change
        renderMarkers();
        
        showNotification('Koordinat diperbarui dan marker dipindahkan.', 'success');
        
        // Clean up listener
        map.off('click', onClick);
    };
    
    // One-time click listener
    map.on('click', onClick);
}

// Export current CONFIG.DATA back to CSV for saving
function exportDataCSV() {
    if (!CONFIG.DATA || CONFIG.DATA.length === 0) {
        showNotification('Tidak ada data untuk diexport.', 'error');
        return;
    }
    const headers = ['name','type','address','latitude','longitude','phone','rating','reviews','working_hours','status'];
    const lines = [headers.join(',')];
    CONFIG.DATA.forEach(f => {
        const row = [
            (f.name || ''),
            (f.type || ''),
            (f.address || ''),
            (typeof f.latitude === 'number' ? f.latitude.toFixed(6) : (f.latitude || '')),
            (typeof f.longitude === 'number' ? f.longitude.toFixed(6) : (f.longitude || '')),
            (f.phone || ''),
            (f.rating || ''),
            (f.reviews || ''),
            (f.working_hours || ''),
            (f.status || '')
        ].map(v => `${v}`.replace(/,/g, ' ')); // avoid breaking CSV with commas in fields
        lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `data-updated-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showNotification('CSV berhasil diexport dengan koordinat terbaru.', 'success');
}

// Geocode facility address via Nominatim (OpenStreetMap)
async function geocodeFacility(index) {
    const facility = CONFIG.DATA[index];
    if (!facility) return;
    const query = facility.address || facility.name;
    showNotification(`Mencari koordinat: ${query}`, 'success');
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(query)}&email=example@domain.com`;
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error('Geocoding gagal');
        const results = await resp.json();
        if (!results || results.length === 0) {
            showNotification('Tidak menemukan koordinat untuk alamat tersebut.', 'error');
            return;
        }
        const best = results[0];
        facility.latitude = parseFloat(best.lat);
        facility.longitude = parseFloat(best.lon);
        renderMarkers();
        showNotification('Koordinat diperbarui dari geocoding dan marker dipindahkan.', 'success');
    } catch (err) {
        console.error('Geocode error:', err);
        showNotification('Gagal melakukan geocoding. Coba Atur Titik manual.', 'error');
    }
}


function showNotification(message, type) {
    // Create notification
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 🌸 INISIALISASI SELESAI
console.log('🌸 WebGIS Kesehatan Kuansing siap digunakan!');