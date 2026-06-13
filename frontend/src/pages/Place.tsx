import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  getMe, getAllPixels, validatePixelLocation, placePixel, cancelPixel,
  type Pixel,
} from '../api';
import Nav from '../components/Nav';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

type PixelType = 'person' | 'event';

const MALE_COLOR = '#6B9FD4';
const FEMALE_COLOR = '#E06878';
const NB_COLOR = '#B07FC8';
const EVENT_COLOR = '#F09840';

const DARK_STYLE  = 'mapbox://styles/mapbox/dark-v11';
const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v11';
const THEME_KEY   = 'pd_map_theme';

const MAP_THEME = {
  dark:  { water: '#1B2C3E', land: '#2A1F14', label: '#C0A080', labelMuted: '#907060' },
  light: { water: '#B8CCDE', land: '#EBE4D8', label: '#806050', labelMuted: '#A08060' },
} as const;

function applyMapTheme(map: mapboxgl.Map, dark: boolean) {
  const c = dark ? MAP_THEME.dark : MAP_THEME.light;
  const set = (id: string, prop: Parameters<mapboxgl.Map['setPaintProperty']>[1], val: string) => {
    try { if (map.getLayer(id)) map.setPaintProperty(id, prop, val); } catch { /* skip */ }
  };
  set('background',                   'background-color', c.water);
  set('land',                         'background-color', c.land);
  set('land',                         'fill-color',       c.land);
  set('water',                        'fill-color',       c.water);
  set('water-shadow',                 'fill-color',       c.water);
  set('country-label',                'text-color',       c.label);
  set('state-label',                  'text-color',       c.labelMuted);
  set('settlement-label',             'text-color',       c.label);
  set('settlement-subdivision-label', 'text-color',       c.labelMuted);
  set('road-label',                   'text-color',       c.labelMuted);
}

const COUNTRY_CENTERS: Record<string, [number, number]> = {
  ES: [-3.7, 40.4],
  CH: [8.2, 46.8],
  AR: [-58.4, -34.6],
  MX: [-99.1, 19.4],
};

function getPixelColor(p: Pixel): string {
  if (p.type === 'event') return EVENT_COLOR;
  if (p.gender === 'male') return MALE_COLOR;
  if (p.gender === 'female') return FEMALE_COLOR;
  return NB_COLOR;
}

function isoToday(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoMaxEventDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

export default function Place() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const validationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedType, setSelectedType] = useState<PixelType>('person');
  const selectedTypeRef = useRef<PixelType>(selectedType);
  const [eventText, setEventText] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventDate, setEventDate] = useState<string>(isoToday());
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; reason?: string } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);

  const { data: me, isError: notAuth } = useQuery({ queryKey: ['me'], queryFn: getMe, retry: false });
  const { data: pixelData } = useQuery({ queryKey: ['all-pixels'], queryFn: () => getAllPixels() });

  const cancelMutation = useMutation({
    mutationFn: cancelPixel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['my-pixel'] });
      queryClient.invalidateQueries({ queryKey: ['all-pixels'] });
    },
  });

  useEffect(() => {
    if (notAuth) navigate('/register?next=/place', { replace: true });
  }, [notAuth, navigate]);

  const isAuthenticated = !!me;
  const userCountry = me?.country_code ?? '';
  const activePixelId = me?.pixel?.id ?? null;

  const validateLocation = useCallback(async (lat: number, lng: number, type: PixelType, countryCode: string) => {
    setIsValidating(true);
    try {
      const result = await validatePixelLocation(lat, lng, type, countryCode);
      // Translate reason codes from server.
      const reason = result.reason ? t(`place.reasons.${result.reason}`, { defaultValue: t('place.reasons.invalid_location') }) : undefined;
      setValidation({ valid: result.valid, reason });
      const el = validationMarkerRef.current?.getElement();
      if (el) {
        el.style.background = result.valid ? '#22c55e' : '#ef4444';
        el.title = result.valid ? t('place.valid') : (reason ?? '');
      }
    } catch {
      setValidation({ valid: false, reason: t('place.reasons.invalid_location') });
    } finally {
      setIsValidating(false);
    }
  }, [t]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const savedDark = localStorage.getItem(THEME_KEY) !== 'light';
    const center = (userCountry && COUNTRY_CENTERS[userCountry]) || [0, 20];
    const zoom = userCountry ? 5 : 1.5;

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: savedDark ? DARK_STYLE : LIGHT_STYLE,
      center: center as [number, number],
      zoom,
    });
    mapInstance.current = map;
    map.getCanvas().style.cursor = 'crosshair';

    map.on('style.load', () => {
      const light = localStorage.getItem(THEME_KEY) === 'light';
      map.setFog({
        color: light ? '#D4C4A8' : '#0E0F11',
        'high-color': light ? '#D4C4A8' : '#0E0F11',
        'horizon-blend': 0.02,
        'space-color': light ? '#D4C4A8' : '#0E0F11',
        'star-intensity': 0,
      });
      if (light) applyMapTheme(map, false);
    });

    const paramLat = parseFloat(searchParams.get('lat') ?? '');
    const paramLng = parseFloat(searchParams.get('lng') ?? '');
    if (!isNaN(paramLat) && !isNaN(paramLng)) {
      map.on('load', () => {
        map.flyTo({ center: [paramLng, paramLat], zoom: 14, duration: 800 });
      });
    }

    map.on('click', e => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;

      setSelectedLat(lat);
      setSelectedLng(lng);
      setValidation(null);
      setPlaceError(null);

      if (validationMarkerRef.current) {
        validationMarkerRef.current.setLngLat([lng, lat]);
        const el = validationMarkerRef.current.getElement();
        el.style.background = '#A89070';
      } else {
        const el = createMarkerEl('#8fa8bc');
        validationMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
      }

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (userCountry) validateLocation(lat, lng, selectedTypeRef.current, userCountry);
      }, 300);
    });

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCountry]);

  // Existing pixels overlay
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !pixelData?.pixels) return;

    const addLayer = () => {
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: pixelData.pixels.map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] } as GeoJSON.Point,
          properties: { color: getPixelColor(p), is_dimmed: p.is_dimmed },
        })),
      };

      if (map.getSource('existing-pixels')) {
        (map.getSource('existing-pixels') as mapboxgl.GeoJSONSource).setData(geojson);
        return;
      }

      map.addSource('existing-pixels', { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'existing-pixels-layer',
        type: 'circle',
        source: 'existing-pixels',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 4, 14, 5],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['==', ['get', 'is_dimmed'], true], 0.25, 0.6],
          'circle-stroke-width': 0.5,
          'circle-stroke-color': localStorage.getItem(THEME_KEY) !== 'light' ? '#0E0F11' : '#EBE4D8',
        },
      });
    };

    if (map.isStyleLoaded()) addLayer();
    else map.on('load', addLayer);
  }, [pixelData]);

  useEffect(() => {
    selectedTypeRef.current = selectedType;
    if (selectedLat !== null && selectedLng !== null && userCountry) {
      validateLocation(selectedLat, selectedLng, selectedType, userCountry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  function createMarkerEl(color: string): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
      width: 16px; height: 16px; border-radius: 50%;
      background: ${color};
      border: 2px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      transition: background 0.2s;
    `;
    return el;
  }

  const priceLabel = selectedType === 'person' ? '€1.50' : '€3.00';
  const durationLabel = selectedType === 'person'
    ? t('place.durationPersonal')
    : t('place.eventDateLabel');

  const eventDateValid = selectedType !== 'event' || (eventDate >= isoToday() && eventDate <= isoMaxEventDate());

  const canPlace = !!validation?.valid
    && selectedLat !== null && selectedLng !== null
    && (selectedType === 'person' || (eventText.trim().length > 0 && eventDescription.trim().length > 0 && eventDateValid));

  const handlePlace = async () => {
    if (!canPlace || selectedLat === null || selectedLng === null || !userCountry) return;
    setIsPlacing(true);
    setPlaceError(null);

    try {
      const result = await placePixel({
        lat: selectedLat,
        lng: selectedLng,
        type: selectedType,
        country_code: userCountry,
        event_text: selectedType === 'event' ? eventText : undefined,
        event_description: selectedType === 'event' ? eventDescription : undefined,
        event_date: selectedType === 'event' ? eventDate : undefined,
      });
      window.location.href = result.stripe_checkout_url;
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const known: Record<string, string> = {
        event_weekly_limit: t('place.errors.eventWeeklyLimit'),
      };
      setPlaceError(code && known[code] ? known[code] : (code ?? t('place.placeError')));
      setIsPlacing(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Nav authenticated={isAuthenticated} />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', background: localStorage.getItem('pd_map_theme') === 'light' ? '#D4C4A8' : '#0E0F11' }} />

        <div style={{
          position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--nav-bg)', backdropFilter: 'blur(16px)',
          border: '1px solid var(--border)', borderRadius: '12px',
          padding: '16px 20px', minWidth: '320px', maxWidth: '420px',
          zIndex: 10,
        }}>
          {activePixelId && selectedType === 'person' && (
            <div style={{
              padding: '10px 12px', marginBottom: '12px',
              background: 'rgba(250,204,21,0.08)',
              border: '1px solid rgba(250,204,21,0.4)', borderRadius: '6px',
              fontSize: '12px', color: 'var(--text)',
            }}>
              <p style={{ color: EVENT_COLOR, fontWeight: 600, marginBottom: '4px' }}>
                {t('place.activePixelTitle')}
              </p>
              <p style={{ marginBottom: '8px' }}>{t('place.activePixelBody')}</p>
              <button
                onClick={() => activePixelId && cancelMutation.mutate(activePixelId)}
                disabled={cancelMutation.isPending}
                style={{
                  padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                  background: 'transparent', color: '#ef4444',
                  border: '1px solid #ef4444', borderRadius: '4px',
                }}
              >
                {cancelMutation.isPending ? t('place.cancelling') : t('place.cancelPixel')}
              </button>
            </div>
          )}

          <p style={{ color: 'var(--text)', fontSize: '12px', marginBottom: '12px', textAlign: 'center' }}>
            {t('place.helpClick')}
            {userCountry && <><br /><span style={{ color: '#8fa8bc' }}>{t('place.helpCountry', { cc: userCountry })}</span></>}
          </p>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            {(['person', 'event'] as const).map(type => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                style={{
                  flex: 1, padding: '10px', borderRadius: '6px', border: 'none',
                  fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                  background: selectedType === type
                    ? (type === 'person' ? FEMALE_COLOR : EVENT_COLOR)
                    : 'var(--surface)',
                  color: selectedType === type ? '#fff' : 'var(--text)',
                }}
              >
                {t(type === 'person' ? 'place.typePerson' : 'place.typeEvent')}
              </button>
            ))}
          </div>

          {selectedType === 'event' && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ position: 'relative', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder={t('place.eventTextPlaceholder')}
                  value={eventText}
                  maxLength={100}
                  onChange={e => setEventText(e.target.value)}
                  style={{ paddingRight: '48px' }}
                />
                <span style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text)', fontSize: '11px', fontFamily: 'var(--mono)',
                }}>
                  {100 - eventText.length}
                </span>
              </div>

              <div style={{ position: 'relative', marginBottom: '10px' }}>
                <textarea
                  placeholder={t('place.eventDescriptionPlaceholder')}
                  value={eventDescription}
                  maxLength={500}
                  onChange={e => setEventDescription(e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: '8px 12px', paddingRight: '52px', resize: 'vertical', fontFamily: 'inherit' }}
                />
                <span style={{
                  position: 'absolute', right: '12px', top: '8px',
                  color: 'var(--text)', fontSize: '11px', fontFamily: 'var(--mono)',
                }}>
                  {500 - eventDescription.length}
                </span>
              </div>

              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text)', marginBottom: '6px' }}>
                {t('place.eventDateLabel')}
              </label>
              <input
                type="date"
                value={eventDate}
                min={isoToday()}
                max={isoMaxEventDate()}
                onChange={e => setEventDate(e.target.value)}
                style={{ width: '100%' }}
              />
              <p style={{ fontSize: '11px', color: 'var(--text)', marginTop: '4px', opacity: 0.7 }}>
                {t('place.eventDateHint')}
              </p>
            </div>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', background: 'var(--surface)', borderRadius: '6px',
            marginBottom: '12px',
          }}>
            <span style={{ color: 'var(--text)', fontSize: '13px' }}>{durationLabel}</span>
            <span style={{ color: 'var(--text-bright)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '16px' }}>
              {priceLabel}
            </span>
          </div>

          {selectedLat !== null && (
            <div style={{
              padding: '8px 12px', borderRadius: '6px', marginBottom: '12px',
              background: isValidating
                ? 'rgba(143,168,188,0.1)'
                : validation?.valid
                  ? 'rgba(34,197,94,0.1)'
                  : 'rgba(239,68,68,0.1)',
              border: `1px solid ${isValidating ? 'var(--border)' : validation?.valid ? '#22c55e' : '#ef4444'}`,
              fontSize: '12px',
              color: isValidating ? 'var(--text)' : validation?.valid ? '#22c55e' : '#ef4444',
            }}>
              {isValidating
                ? t('place.validating')
                : validation?.valid
                  ? t('place.valid')
                  : t('place.invalid', { reason: validation?.reason ?? t('place.reasons.invalid_location') })}
            </div>
          )}

          {placeError && (
            <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '10px', textAlign: 'center' }}>
              {placeError}
            </p>
          )}

          <button
            onClick={handlePlace}
            disabled={!canPlace || isPlacing}
            style={{
              width: '100%', padding: '12px', borderRadius: '8px', border: 'none',
              background: canPlace ? (selectedType === 'person' ? FEMALE_COLOR : EVENT_COLOR) : 'var(--border)',
              color: canPlace ? '#fff' : 'var(--text)',
              fontWeight: 700, fontSize: '15px', cursor: canPlace ? 'pointer' : 'not-allowed',
            }}
          >
            {isPlacing ? t('place.creatingPayment') : t('place.confirmPay', { price: priceLabel })}
          </button>
        </div>

        {selectedLat !== null && selectedLng !== null && (
          <div style={{
            position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
            background: 'var(--nav-bg)', backdropFilter: 'blur(8px)',
            border: '1px solid var(--border)', borderRadius: '6px',
            padding: '6px 14px',
            color: 'var(--text)', fontSize: '11px', fontFamily: 'var(--mono)',
            zIndex: 10,
          }}>
            {selectedLat.toFixed(5)}°N, {selectedLng.toFixed(5)}°E
          </div>
        )}
      </div>
    </div>
  );
}
