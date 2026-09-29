import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { reverseGeocode } from '../../lib/geocoding';
import 'leaflet/dist/leaflet.css';

export default function MapModal() {
    const { state, dispatch, updatePhoto, showToast } = useApp();
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    const previewPhoto = state.photos.find((p) => p.id === state.previewPhotoId);
    const initialLatitude = previewPhoto?.locationLatitude ?? state.settings.latitude;
    const initialLongitude = previewPhoto?.locationLongitude ?? state.settings.longitude;

    const [selectedLat, setSelectedLat] = useState<number | null>(initialLatitude);
    const [selectedLng, setSelectedLng] = useState<number | null>(initialLongitude);
    const [isLoading, setIsLoading] = useState(false);

    // Initialize map
    useEffect(() => {
        let isMounted = true;

        const initMap = async () => {
            if (!mapContainerRef.current || mapRef.current) return;

            // Dynamic import to avoid SSR issues
            const L = await import('leaflet');

            // Fix default marker icons
            delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
            L.Icon.Default.mergeOptions({
                iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
                iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            });

            if (!isMounted || !mapContainerRef.current) return;

            const initialLat = initialLatitude ?? 13.7563;
            const initialLng = initialLongitude ?? 100.5018;

            const map = L.map(mapContainerRef.current).setView([initialLat, initialLng], 15);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
            }).addTo(map);

            // Add marker if position exists
            if (initialLatitude !== null && initialLongitude !== null) {
                const marker = L.marker([initialLatitude, initialLongitude]).addTo(map);
                markerRef.current = marker;
            }

            // Click to select position
            map.on('click', (e: L.LeafletMouseEvent) => {
                const { lat, lng } = e.latlng;
                setSelectedLat(lat);
                setSelectedLng(lng);

                // Update or create marker
                if (markerRef.current) {
                    markerRef.current.setLatLng([lat, lng]);
                } else {
                    const marker = L.marker([lat, lng]).addTo(map);
                    markerRef.current = marker;
                }
            });

            mapRef.current = map;

            // Force resize after modal animation
            setTimeout(() => {
                map.invalidateSize();
            }, 300);
        };

        initMap();

        return () => {
            isMounted = false;
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);

    const handleConfirm = async () => {
        if (selectedLat === null || selectedLng === null) {
            showToast('กรุณาเลือกตำแหน่งบนแผนที่', 'error');
            return;
        }

        setIsLoading(true);

        // Reverse geocode to get address
        let address: string | null = null;
        if (state.settings.showAddress) {
            address = await reverseGeocode(selectedLat, selectedLng);
        }

        if (previewPhoto) {
            await updatePhoto(previewPhoto.id, {
                locationLatitude: selectedLat,
                locationLongitude: selectedLng,
                locationAddress: address,
            });
        } else {
            dispatch({
                type: 'SET_SETTINGS',
                payload: {
                    latitude: selectedLat,
                    longitude: selectedLng,
                    cachedAddress: address,
                },
            });
        }

        setIsLoading(false);
        showToast('บันทึกตำแหน่งแล้ว', 'success');
        dispatch({ type: 'SET_ACTIVE_MODAL', payload: previewPhoto ? 'preview' : 'settings' });
    };

    const handleCancel = () => {
        dispatch({ type: 'SET_ACTIVE_MODAL', payload: previewPhoto ? 'preview' : 'settings' });
    };

    return (
        <div className="modal-backdrop map-modal" onClick={handleCancel}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>🗺️ เลือกตำแหน่งบนแผนที่</h2>
                    <button className="icon-btn" onClick={handleCancel}>✕</button>
                </div>

                <div className="map-container" ref={mapContainerRef} />

                <div className="modal-footer">
                    {selectedLat !== null && selectedLng !== null && (
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>
                            📍 {selectedLat.toFixed(6)}, {selectedLng.toFixed(6)}
                        </span>
                    )}
                    <button className="btn btn-secondary" onClick={handleCancel}>
                        ยกเลิก
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleConfirm}
                        disabled={selectedLat === null || isLoading}
                    >
                        {isLoading ? '⏳' : '✓'} ยืนยัน
                    </button>
                </div>
            </div>
        </div>
    );
}
