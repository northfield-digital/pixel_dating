import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  getHeatmap, getAllPixels, getMe, getMyPixels, getPixelPreview,
  sendLike, getCountryOccupancy, participateInEvent, leaveEvent,
  type Pixel, type PixelPreview, type MyPixel, type Lang,
} from '../api';
import Nav from '../components/Nav';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MALE_COLOR = '#6B9FD4';
const FEMALE_COLOR = '#E06878';
const NB_COLOR = '#B07FC8';
const EVENT_COLOR = '#F09840';
const OWN_COLOR = '#4DAA78';

const COMPAT_KEY = 'pd_compat_only';
const THEME_KEY = 'pd_map_theme';

const DARK_STYLE = 'mapbox://styles/mapbox/dark-v11';
const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v11';

/** Map layer colour overrides applied after every style load. */
const MAP_THEME = {
  dark:  { water: '#1B2C3E', land: '#2A1F14', label: '#C0A080', labelMuted: '#907060' },
  light: { water: '#B8CCDE', land: '#EBE4D8', label: '#806050', labelMuted: '#A08060' },
} as const;

function applyMapTheme(map: mapboxgl.Map, dark: boolean) {
  const c = dark ? MAP_THEME.dark : MAP_THEME.light;
  const set = (id: string, prop: Parameters<mapboxgl.Map['setPaintProperty']>[1], val: string) => {
    try { if (map.getLayer(id)) map.setPaintProperty(id, prop, val); } catch { /* skip unknown layers */ }
  };
  set('background',                      'background-color', c.water);
  set('land',                            'background-color', c.land);
  set('land',                            'fill-color',       c.land);
  set('water',                           'fill-color',       c.water);
  set('water-shadow',                    'fill-color',       c.water);
  set('country-label',                   'text-color',       c.label);
  set('state-label',                     'text-color',       c.labelMuted);
  set('settlement-label',                'text-color',       c.label);
  set('settlement-subdivision-label',    'text-color',       c.labelMuted);
  set('road-label',                      'text-color',       c.labelMuted);
  set('waterway-label',                  'text-color',       c.water);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getPixelColor(p: Pixel, myUserId?: string): string {
  if (myUserId && p.user_id === myUserId) return OWN_COLOR;
  if (p.type === 'event') return EVENT_COLOR;
  if (p.gender === 'male') return MALE_COLOR;
  if (p.gender === 'female') return FEMALE_COLOR;
  return NB_COLOR;
}

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const pulseMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();

  const [likesRemaining, setLikesRemaining] = useState<number>(5);
  const [likesResetAt, setLikesResetAt] = useState<string | null>(null);

  const [compatOnly, setCompatOnly] = useState<boolean>(() => {
    return localStorage.getItem(COMPAT_KEY) === '1';
  });

  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem(THEME_KEY) !== 'light';
  });
  // Keep a ref so the map style.load closure always sees the current isDark value.
  const isDarkRef = useRef(isDark);
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);

  // Bumped on every style.load so data layers re-attach after a style swap.
  const [styleEpoch, setStyleEpoch] = useState(0);

  // Derived UI tokens so panels match the active map theme.
  const ui = isDark
    ? {
        panelBg: 'rgba(14,15,17,0.92)',
        panelBorder: 'rgba(255,255,255,0.10)',
        panelText: '#8fa8bc',
        panelTextBright: '#e8f4ff',
        panelSurface: 'rgba(255,255,255,0.06)',
        popupBg: 'rgba(14,15,17,0.97)',
        popupText: '#e8f4ff',
        popupTextMuted: '#6a8aa8',
        dotStroke: '#0E0F11',
      }
    : {
        panelBg: 'rgba(212,196,168,0.94)',
        panelBorder: 'rgba(0,0,0,0.12)',
        panelText: '#5A4A38',
        panelTextBright: '#2C1E12',
        panelSurface: 'rgba(0,0,0,0.06)',
        popupBg: 'rgba(212,196,168,0.97)',
        popupText: '#2C1E12',
        popupTextMuted: '#7A6450',
        dotStroke: '#D4C4A8',
      };

  const [bbox, setBbox] = useState<{ minLat: number; maxLat: number; minLng: number; maxLng: number } | null>(null);
  const bboxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [occupancy, setOccupancy] = useState<{ name: string; pct: number; count: number } | null>(null);

  const [likeModal, setLikeModal] = useState<{
    pixelId: number;
    preview: PixelPreview | null;
    loading: boolean;
    error: string | null;
    sending: boolean;
    sent: boolean;
  } | null>(null);

  const lang = (i18n.language?.slice(0, 2) ?? 'en') as Lang;

  const { data: heatmap } = useQuery({ queryKey: ['heatmap'], queryFn: getHeatmap });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe, retry: false });
  const { data: myPixelsData } = useQuery({
    queryKey: ['my-pixels'],
    queryFn: getMyPixels,
    enabled: !!me,
    retry: false,
  });

  // Round the bbox to 2 decimals so micro-pans don't invalidate the
  // query cache. ~1km granularity is plenty for the dot layer.
  const roundedBbox = bbox && {
    minLat: Math.floor(bbox.minLat * 100) / 100,
    maxLat: Math.ceil(bbox.maxLat * 100) / 100,
    minLng: Math.floor(bbox.minLng * 100) / 100,
    maxLng: Math.ceil(bbox.maxLng * 100) / 100,
  };

  const { data: pixelData } = useQuery({
    queryKey: ['all-pixels', compatOnly && me?.id ? 'compat' : 'all', roundedBbox],
    queryFn: () => getAllPixels({ compat: compatOnly && !!me, ...(roundedBbox ?? {}) }),
    // refetchIntervalInBackground defaults to false in TanStack Query v5,
    // so polling automatically pauses when the tab is hidden.
    refetchInterval: 30_000,
    enabled: roundedBbox !== null,
  });

  const isAuthenticated = !!me;
  const myUserId = me?.id;
  const myPixels: MyPixel[] = myPixelsData?.pixels ?? [];
  const ownPersonPixel = myPixels.find(p => p.type === 'person') ?? null;
  const myEvents = myPixels.filter(p => p.type === 'event');

  useEffect(() => {
    if (me) {
      setLikesRemaining(me.likes_remaining);
      setLikesResetAt(me.likes_reset_at);
    }
  }, [me]);

  const handleLikeSent = useCallback((remaining: number, resetAt: string | null) => {
    setLikesRemaining(remaining);
    setLikesResetAt(resetAt);
    queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const flyTo = useCallback((lng: number, lat: number, zoom = 17) => {
    if (!mapInstance.current) return;
    mapInstance.current.flyTo({
      center: [lng, lat],
      zoom,
      duration: 1500,
      essential: true,
    });

    pulseMarkerRef.current?.remove();
    const el = document.createElement('div');
    el.style.cssText = `
      width: 24px; height: 24px; border-radius: 50%;
      background: ${OWN_COLOR}; opacity: 0.8;
      animation: pixel-pulse 0.6s ease-out 3;
    `;
    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(mapInstance.current);
    pulseMarkerRef.current = marker;
    setTimeout(() => marker.remove(), 2200);
  }, []);

  const handleGoToMyPixel = useCallback(() => {
    if (!ownPersonPixel) return;
    flyTo(ownPersonPixel.lng, ownPersonPixel.lat);
  }, [flyTo, ownPersonPixel]);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      mapInstance.current?.setStyle(next ? DARK_STYLE : LIGHT_STYLE);
      return next;
    });
  }, []);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: isDark ? DARK_STYLE : LIGHT_STYLE,
      center: [0, 20],
      zoom: 1.5,
    });
    mapInstance.current = map;

    const captureBbox = () => {
      const b = map.getBounds();
      if (!b) return;
      const next = {
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLng: b.getWest(),
        maxLng: b.getEast(),
      };
      if (bboxDebounceRef.current) clearTimeout(bboxDebounceRef.current);
      bboxDebounceRef.current = setTimeout(() => setBbox(next), 400);
    };
    map.on('load', captureBbox);
    map.on('moveend', captureBbox);
    map.on('style.load', () => {
      setStyleEpoch(e => e + 1);
      const dark = isDarkRef.current;
      // Globe "space" — the area around the planet at low zoom. By default
      // Mapbox light-v11 renders this bright white.
      map.setFog({
        color: dark ? '#0E0F11' : '#D4C4A8',
        'high-color': dark ? '#0E0F11' : '#D4C4A8',
        'horizon-blend': 0.02,
        'space-color': dark ? '#0E0F11' : '#D4C4A8',
        'star-intensity': 0,
      });
      if (!dark) applyMapTheme(map, false);
    });

    // Apply the persisted theme on very first load.
    // (style.load fires before 'load', so this is covered by the epoch effect)

    const paramLat = parseFloat(searchParams.get('lat') ?? '');
    const paramLng = parseFloat(searchParams.get('lng') ?? '');
    const paramZoom = parseFloat(searchParams.get('zoom') ?? '');
    if (!isNaN(paramLat) && !isNaN(paramLng)) {
      map.on('load', () => {
        map.flyTo({
          center: [paramLng, paramLat],
          zoom: isNaN(paramZoom) ? 14 : paramZoom,
          duration: 1200,
        });
      });
    }

    return () => {
      if (bboxDebounceRef.current) clearTimeout(bboxDebounceRef.current);
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heatmap
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !heatmap?.pixels) return;

    const addHeatmap = () => {
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: heatmap.pixels.map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] } as GeoJSON.Point,
          properties: { type: p.type },
        })),
      };

      if (map.getSource('heatmap-source')) {
        (map.getSource('heatmap-source') as mapboxgl.GeoJSONSource).setData(geojson);
        return;
      }

      map.addSource('heatmap-source', { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'pixel-heat',
        type: 'heatmap',
        source: 'heatmap-source',
        paint: {
          'heatmap-weight': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(224,104,120,0.10)',
            0.5, 'rgba(224,104,120,0.28)',
            1, 'rgba(224,104,120,0.50)',
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 20, 6, 30, 10, 15],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 8, 0.25, 12, 0.0],
        },
      });
    };

    if (map.isStyleLoaded()) addHeatmap();
    else map.on('load', addHeatmap);
  }, [heatmap, styleEpoch]);

  // Pixel dots layer
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !pixelData?.pixels) return;

    const addPixelDots = () => {
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: pixelData.pixels.map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] } as GeoJSON.Point,
          properties: {
            id: p.id,
            type: p.type,
            is_dimmed: p.is_dimmed,
            color: getPixelColor(p, myUserId),
            event_text: p.event_text ?? '',
          },
        })),
      };

      if (map.getSource('pixel-dots')) {
        (map.getSource('pixel-dots') as mapboxgl.GeoJSONSource).setData(geojson);
        return;
      }

      map.addSource('pixel-dots', { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'pixel-dots-layer',
        type: 'circle',
        source: 'pixel-dots',
        minzoom: 5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 4, 14, 6],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['==', ['get', 'is_dimmed'], true], 0.35, 1.0],
          'circle-stroke-width': 1,
          'circle-stroke-color': ui.dotStroke,
        },
      });

      const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '240px' });

      map.on('mouseenter', 'pixel-dots-layer', async e => {
        if (!e.features?.[0]) return;
        map.getCanvas().style.cursor = 'pointer';
        const props = e.features[0].properties!;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];

        try {
          const preview = await getPixelPreview(props.id, lang);
          let html = '';
          if (preview.type === 'person') {
            const nameColor = props.color || FEMALE_COLOR;
            html = `<div style="color:${ui.popupText};font-family:sans-serif;font-size:13px;line-height:1.5">
              <strong style="color:${nameColor}">${escapeHtml(preview.first_name)}</strong>, ${preview.age}<br>
              ${escapeHtml(preview.country)}<br>
              <span style="color:${ui.popupTextMuted};font-size:11px">${escapeHtml(t('map.expiresIn', { days: preview.expires_in_days }))}</span>
            </div>`;
          } else {
            html = `<div style="color:${ui.popupText};font-family:sans-serif;font-size:13px;line-height:1.5">
              <strong style="color:${EVENT_COLOR}">${escapeHtml(preview.event_text)}</strong><br>
              <span style="color:${ui.popupTextMuted};font-size:11px">${escapeHtml(preview.country)} · ${escapeHtml(t('map.expiresIn', { days: preview.expires_in_days }))}</span>
            </div>`;
          }
          popup.setLngLat(coords).setHTML(html).addTo(map);
        } catch { /* ignore */ }
      });

      map.on('mouseleave', 'pixel-dots-layer', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });

      map.on('click', 'pixel-dots-layer', async e => {
        if (!e.features?.[0]) return;
        const props = e.features[0].properties!;
        const pixelId = props.id;

        if (!isAuthenticated) {
          navigate('/register');
          return;
        }
        if (props.color === OWN_COLOR) return;

        setLikeModal({ pixelId, preview: null, loading: true, error: null, sending: false, sent: false });
        try {
          const preview = await getPixelPreview(pixelId, lang);
          setLikeModal(prev => prev ? { ...prev, preview, loading: false } : null);
        } catch {
          setLikeModal(prev => prev ? { ...prev, loading: false, error: t('common.error') } : null);
        }
      });
    };

    if (map.isStyleLoaded()) addPixelDots();
    else map.on('load', addPixelDots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelData, myUserId, isAuthenticated, lang, styleEpoch, ui.dotStroke]);

  // Country click → occupancy
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const onMapClick = async (e: mapboxgl.MapMouseEvent) => {
      // Skip if click landed on a pixel dot
      const features = map.queryRenderedFeatures(e.point, { layers: ['pixel-dots-layer'] });
      if (features.length > 0) return;

      const country = map.queryRenderedFeatures(e.point).find(
        f => f.layer?.['source-layer'] === 'country_label' || f.layer?.['source-layer'] === 'country',
      );
      const cc = (country?.properties?.iso_3166_1 ?? country?.properties?.iso_3166_1_alpha_2) as string | undefined;
      if (!cc) return;

      try {
        const occ = await getCountryOccupancy(cc.toUpperCase(), lang);
        setOccupancy({ name: occ.name, pct: occ.occupancy_pct, count: occ.total_count });
      } catch {
        // Country probably unsupported; ignore.
      }
    };
    map.on('click', onMapClick);
    return () => { map.off('click', onMapClick); };
  }, [lang]);

  const handleSendLike = async () => {
    if (!likeModal) return;
    setLikeModal(prev => prev ? { ...prev, sending: true, error: null } : null);
    try {
      const result = await sendLike(likeModal.pixelId);
      handleLikeSent(result.likes_remaining, result.likes_reset_at);
      setLikeModal(prev => prev ? { ...prev, sending: false, sent: true } : null);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; likes_reset_at?: string } } };
      const msg = axiosErr?.response?.data?.error ?? t('common.error');
      if (axiosErr?.response?.data?.likes_reset_at) {
        setLikesResetAt(axiosErr.response.data.likes_reset_at);
      }
      setLikeModal(prev => prev ? { ...prev, sending: false, error: msg } : null);
    }
  };

  const handleToggleParticipate = async () => {
    if (!likeModal || likeModal.preview?.type !== 'event') return;
    const join = !likeModal.preview.is_participant;
    setLikeModal(prev => prev ? { ...prev, sending: true, error: null } : null);
    try {
      const result = join
        ? await participateInEvent(likeModal.pixelId)
        : await leaveEvent(likeModal.pixelId);
      setLikeModal(prev => {
        if (!prev || prev.preview?.type !== 'event') return prev;
        return {
          ...prev,
          sending: false,
          preview: {
            ...prev.preview,
            participants_count: result.participants_count,
            is_participant: result.is_participant,
          },
        };
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t('common.error');
      setLikeModal(prev => prev ? { ...prev, sending: false, error: msg } : null);
    }
  };

  const getResetCountdown = (): string => {
    if (!likesResetAt) return '';
    const diff = new Date(likesResetAt).getTime() - Date.now();
    if (diff <= 0) return '';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const onCompatToggle = () => {
    const next = !compatOnly;
    setCompatOnly(next);
    localStorage.setItem(COMPAT_KEY, next ? '1' : '0');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Nav authenticated={isAuthenticated} />

      <style>{`
        @keyframes pixel-pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(77,170,120,0.7); }
          70% { transform: scale(1.4); box-shadow: 0 0 0 20px rgba(77,170,120,0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(77,170,120,0); }
        }
        .mapboxgl-canvas-container, .mapboxgl-canvas {
          background: ${isDark ? '#0E0F11' : '#D4C4A8'} !important;
        }
        .mapboxgl-popup-content {
          background: ${ui.popupBg} !important;
          color: ${ui.popupText} !important;
          border: 1px solid ${ui.panelBorder};
          border-radius: 6px;
          padding: 10px 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        }
        .mapboxgl-popup-tip {
          border-top-color: ${ui.popupBg} !important;
          border-bottom-color: ${ui.popupBg} !important;
          border-left-color: ${ui.popupBg} !important;
          border-right-color: ${ui.popupBg} !important;
        }
      `}</style>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', background: isDark ? '#0E0F11' : '#D4C4A8' }} />

        {/* Legend — top right */}
        <div style={{
          position: 'absolute', top: '16px', right: isAuthenticated ? '200px' : '16px',
          background: ui.panelBg, backdropFilter: 'blur(12px)',
          border: `1px solid ${ui.panelBorder}`, borderRadius: '8px',
          padding: '10px 14px', zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: '5px',
          fontSize: '12px', color: ui.panelText,
        }}>
          {[
            { color: MALE_COLOR, label: t('map.legendMale') },
            { color: FEMALE_COLOR, label: t('map.legendFemale') },
            { color: NB_COLOR, label: t('map.legendNB') },
            { color: EVENT_COLOR, label: t('map.legendEvent') },
            { color: OWN_COLOR, label: t('map.legendOwn') },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: item.color, display: 'inline-block', flexShrink: 0,
              }} />
              <span>{item.label}</span>
            </div>
          ))}
          {isAuthenticated && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginTop: '6px', paddingTop: '6px', borderTop: `1px solid ${ui.panelBorder}`,
              cursor: 'pointer', userSelect: 'none',
            }} title={t('map.compatHint')}>
              <input
                type="checkbox"
                checked={compatOnly}
                onChange={onCompatToggle}
                style={{ accentColor: FEMALE_COLOR }}
              />
              <span>{t('map.compatOnly')}</span>
            </label>
          )}  
        </div>

        {/* Dark / light theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to light map' : 'Switch to dark map'}
          style={{
            position: 'absolute', bottom: '16px', left: '16px',
            background: ui.panelBg, backdropFilter: 'blur(12px)',
            border: `1px solid ${ui.panelBorder}`, borderRadius: '8px',
            padding: '8px 12px', zIndex: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '7px',
            fontFamily: 'var(--mono)', fontSize: '12px', color: ui.panelText,
          }}
        >
          {isDark ? '☀️' : '🌙'}
          {isDark ? 'Light' : 'Dark'}
        </button>

        {isAuthenticated && (
          <button
            onClick={ownPersonPixel ? handleGoToMyPixel : () => navigate('/place')}
            style={{
              position: 'absolute', top: '16px', right: '16px',
              background: ui.panelBg,
              backdropFilter: 'blur(12px)',
              border: `1px solid ${ownPersonPixel ? OWN_COLOR : ui.panelBorder}`,
              color: ownPersonPixel ? OWN_COLOR : ui.panelText,
              padding: '10px 18px', borderRadius: '8px',
              fontWeight: 600, fontSize: '13px', cursor: 'pointer',
              fontFamily: 'var(--mono)', zIndex: 10,
            }}
          >
            {ownPersonPixel ? t('map.goToMyPixel') : t('map.placeYourPixel')}
          </button>
        )}

        {/* My events legend — bottom left */}
        {isAuthenticated && myEvents.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '24px', left: '16px',
            background: ui.panelBg, backdropFilter: 'blur(12px)',
            border: `1px solid ${EVENT_COLOR}55`, borderRadius: '10px',
            padding: '12px 14px', zIndex: 10, maxWidth: '280px',
          }}>
            <p style={{ color: EVENT_COLOR, fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
              {t('map.myEventsTitle')}
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {myEvents.map(ev => (
                <li key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => flyTo(ev.lng, ev.lat, 16)}
                    style={{
                      flex: 1, textAlign: 'left',
                      background: 'transparent', border: 'none',
                      color: ui.panelTextBright, fontSize: '12px', cursor: 'pointer',
                      padding: 0,
                    }}
                    title={t('map.flyTo')}
                  >
                    <strong>{ev.event_text || t('map.legendEvent')}</strong>
                    <br />
                    <span style={{ fontSize: '11px', color: ui.panelText }}>
                      {new Date(ev.expires_at).toLocaleDateString(i18n.language)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Country occupancy panel */}
        {occupancy && (
          <div style={{
            position: 'absolute', bottom: '24px', right: '24px',
            background: ui.panelBg, backdropFilter: 'blur(12px)',
            border: `1px solid ${ui.panelBorder}`, borderRadius: '10px',
            padding: '12px 16px', zIndex: 10, maxWidth: '280px',
          }}>
            <p style={{ color: ui.panelTextBright, fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
              {t('map.occupancyTitle', { country: occupancy.name })}
            </p>
            <p style={{ color: ui.panelText, fontSize: '12px', marginBottom: '8px' }}>
              {t('map.occupancyBody', { pct: occupancy.pct.toFixed(2), count: occupancy.count })}
            </p>
            <div style={{ height: '6px', background: ui.panelSurface, borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, occupancy.pct)}%`, height: '100%',
                background: FEMALE_COLOR,
                transition: 'width 0.4s',
              }} />
            </div>
            <button
              onClick={() => setOccupancy(null)}
              style={{
                marginTop: '8px', padding: '4px 10px', fontSize: '11px',
                background: 'transparent', border: `1px solid ${ui.panelBorder}`,
                color: ui.panelText, borderRadius: '4px', cursor: 'pointer',
              }}
            >
              {t('map.occupancyClose')}
            </button>
          </div>
        )}

        {/* Place CTA */}
        <button
          onClick={() => navigate(isAuthenticated ? '/place' : '/register')}
          style={{
            position: 'absolute', bottom: '32px', right: '24px',
            background: FEMALE_COLOR, color: '#fff', fontWeight: 700,
            padding: '14px 28px', borderRadius: '8px', border: 'none',
            boxShadow: '0 0 32px rgba(224,104,120,0.45)',
            cursor: 'pointer', fontSize: '15px',
            zIndex: occupancy ? 5 : 10, // hide behind occupancy if open
            display: occupancy ? 'none' : 'block',
          }}
        >
          {t('map.placeMyPixel')}
        </button>

        {/* Like modal */}
        {likeModal && (
          <div
            onClick={() => setLikeModal(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 100,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--modal-bg)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '24px', width: '320px', maxWidth: '90vw',
              }}
            >
              {likeModal.loading ? (
                <p style={{ color: 'var(--text)', textAlign: 'center' }}>{t('common.loading')}</p>
              ) : likeModal.sent ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>💖</div>
                  <p style={{ color: '#fff', fontWeight: 600, marginBottom: '8px' }}>{t('map.likeModal.sentTitle')}</p>
                  <p style={{ color: 'var(--text)', fontSize: '13px', marginBottom: '16px' }}>
                    {t('map.likeModal.sentBody')}
                  </p>
                  <button
                    onClick={() => setLikeModal(null)}
                    style={{
                      padding: '10px 24px', borderRadius: '8px', border: 'none',
                      background: FEMALE_COLOR, color: '#fff', fontWeight: 700,
                      cursor: 'pointer', fontSize: '14px',
                    }}
                  >
                    {t('common.close')}
                  </button>
                </div>
              ) : (
                <>
                  {likeModal.preview?.type === 'person' ? (
                    <>
                      <div style={{ marginBottom: '16px' }}>
                        <p style={{ color: '#fff', fontWeight: 700, fontSize: '18px', marginBottom: '4px' }}>
                          {t('map.likeModal.personLabel', { name: likeModal.preview.first_name, age: likeModal.preview.age })}
                        </p>
                        <p style={{ color: 'var(--text)', fontSize: '13px' }}>{likeModal.preview.country}</p>
                      </div>

                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 0', marginBottom: '12px',
                        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                      }}>
                        <span style={{ color: 'var(--text)', fontSize: '13px' }}>{t('map.likeModal.remainingToday')}</span>
                        <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                          {t('map.likeModal.ratio', { n: likesRemaining, max: me?.daily_like_limit ?? 5 })}
                        </span>
                      </div>

                      {likesRemaining === 0 && (
                        <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px', textAlign: 'center' }}>
                          {t('map.likeModal.limitReached', { time: getResetCountdown() })}
                        </p>
                      )}

                      {likeModal.error && (
                        <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px', textAlign: 'center' }}>
                          {likeModal.error}
                        </p>
                      )}

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setLikeModal(null)}
                          style={{
                            flex: 1, padding: '10px', borderRadius: '8px',
                            border: '1px solid var(--border)', background: 'transparent',
                            color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
                          }}
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          onClick={handleSendLike}
                          disabled={likeModal.sending || likesRemaining === 0}
                          style={{
                            flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                            background: likesRemaining === 0 ? 'var(--border)' : FEMALE_COLOR,
                            color: '#fff', cursor: likesRemaining === 0 ? 'not-allowed' : 'pointer',
                            fontWeight: 700, fontSize: '14px',
                            opacity: likeModal.sending ? 0.6 : 1,
                          }}
                        >
                          {likeModal.sending ? t('map.likeModal.sending') : t('map.likeModal.send')}
                        </button>
                      </div>
                    </>
                  ) : likeModal.preview?.type === 'event' ? (
                    <>
                      <div style={{ marginBottom: '12px' }}>
                        <p style={{ color: EVENT_COLOR, fontWeight: 700, fontSize: '18px', marginBottom: '6px' }}>
                          {likeModal.preview.event_text}
                        </p>
                        {likeModal.preview.event_description && (
                          <p style={{ color: 'var(--text-bright)', fontSize: '13px', whiteSpace: 'pre-wrap', marginBottom: '6px' }}>
                            {likeModal.preview.event_description}
                          </p>
                        )}
                        <p style={{ color: 'var(--text)', fontSize: '12px' }}>{likeModal.preview.country}</p>
                      </div>

                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 0', marginBottom: '12px',
                        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                      }}>
                        <span style={{ color: 'var(--text)', fontSize: '13px' }}>{t('map.eventModal.participants')}</span>
                        <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                          {likeModal.preview.participants_count}
                        </span>
                      </div>

                      {likeModal.error && (
                        <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px', textAlign: 'center' }}>
                          {likeModal.error}
                        </p>
                      )}

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setLikeModal(null)}
                          style={{
                            flex: 1, padding: '10px', borderRadius: '8px',
                            border: '1px solid var(--border)', background: 'transparent',
                            color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
                          }}
                        >
                          {t('common.close')}
                        </button>
                        <button
                          onClick={handleToggleParticipate}
                          disabled={likeModal.sending}
                          style={{
                            flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                            background: likeModal.preview.is_participant ? 'var(--border)' : EVENT_COLOR,
                            color: likeModal.preview.is_participant ? 'var(--text)' : 'var(--text-bright)',
                            cursor: 'pointer', fontWeight: 700, fontSize: '14px',
                            opacity: likeModal.sending ? 0.6 : 1,
                          }}
                        >
                          {likeModal.sending
                            ? t('map.eventModal.sending')
                            : likeModal.preview.is_participant
                              ? t('map.eventModal.leave')
                              : t('map.eventModal.join')}
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
